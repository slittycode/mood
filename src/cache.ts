import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

interface CacheEntry {
  todoCount: number;
  mtime: number;
  size: number;
}

interface CacheData {
  commitHash: string;
  cachedAt: number;
  files: Map<string, CacheEntry>;
}

const CACHE_VERSION = 1;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getCacheDir(cwd: string): string {
  // Prefer .mood/ in the repo, fallback to ~/.cache/mood/
  const repoCache = path.join(cwd, '.mood');
  if (fs.existsSync(repoCache) || canWrite(repoCache)) {
    return repoCache;
  }
  
  const homeCache = path.join(process.env.HOME || process.env.USERPROFILE || cwd, '.cache', 'mood');
  return homeCache;
}

function canWrite(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const testFile = path.join(dir, '.test');
    fs.writeFileSync(testFile, '');
    fs.unlinkSync(testFile);
    return true;
  } catch {
    return false;
  }
}

function getCacheFilePath(cwd: string): string {
  return path.join(getCacheDir(cwd), 'cache.json');
}

function hashFile(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Loads the cache from disk.
 * @param cwd - The current working directory.
 * @returns The cached data or null if not found/stale.
 */
export function loadCache(cwd: string): CacheData | null {
  const cachePath = getCacheFilePath(cwd);
  
  try {
    if (!fs.existsSync(cachePath)) return null;
    
    const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    
    // Check version
    if (data.version !== CACHE_VERSION) return null;
    
    // Check TTL
    if (Date.now() - data.cachedAt > CACHE_TTL_MS) return null;
    
    return {
      commitHash: data.commitHash,
      cachedAt: data.cachedAt,
      files: new Map(Object.entries(data.files)),
    };
  } catch {
    return null;
  }
}

/**
 * Saves the cache to disk.
 * @param cwd - The current working directory.
 * @param data - The cache data to save.
 */
export function saveCache(cwd: string, data: CacheData): void {
  const cachePath = getCacheFilePath(cwd);
  
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    
    const serializable = {
      version: CACHE_VERSION,
      commitHash: data.commitHash,
      cachedAt: data.cachedAt,
      files: Object.fromEntries(data.files),
    };
    
    fs.writeFileSync(cachePath, JSON.stringify(serializable, null, 2));
  } catch {
    // Silently fail if we can't write cache
  }
}

/**
 * Gets cached TODO count for a file if valid.
 * @param cache - The cache data.
 * @param filePath - Absolute path to the file.
 * @param content - Current file content.
 * @returns Cached count or null if stale.
 */
export function getCachedTodoCount(
  cache: CacheData | null,
  filePath: string,
  content: string
): number | null {
  if (!cache) return null;
  
  const entry = cache.files.get(filePath);
  if (!entry) return null;
  
  const currentHash = hashFile(content);
  const entryHash = hashFile(entry.todoCount.toString()); // Simple validation
  
  // Check if file changed by comparing content hash indirectly through mtime/size
  const stats = fs.statSync(filePath);
  if (stats.mtimeMs !== entry.mtime || stats.size !== entry.size) return null;
  
  return entry.todoCount;
}

/**
 * Updates the cache with a file's TODO count.
 * @param cache - The cache data to update.
 * @param filePath - Absolute path to the file.
 * @param content - File content.
 * @param todoCount - The TODO count for this file.
 */
export function updateCache(
  cache: CacheData,
  filePath: string,
  content: string,
  todoCount: number
): void {
  const stats = fs.statSync(filePath);
  
  cache.files.set(filePath, {
    todoCount,
    mtime: stats.mtimeMs,
    size: stats.size,
  });
}

/**
 * Creates a new empty cache for a commit.
 * @param commitHash - The current git commit hash.
 * @returns Empty cache data structure.
 */
export function createCache(commitHash: string): CacheData {
  return {
    commitHash,
    cachedAt: Date.now(),
    files: new Map(),
  };
}
