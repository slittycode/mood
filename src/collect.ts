import * as fs from 'node:fs';
import * as path from 'node:path';
import { simpleGit } from 'simple-git';
import pLimit from 'p-limit';
import { GIT_TIMEOUT_MS, MAX_FILES_TO_SCAN, MAX_CONCURRENT_FILES } from './constants.js';
import { loadCache, saveCache, getCachedTodoCount, updateCache, createCache } from './cache.js';

export class GitError extends Error { }
export class FileSystemError extends Error { }

/** Error thrown when Anthropic API operations fail. */
export class ApiError extends Error { }

/**
 * Signals collected about the current software project state.
 */
export interface ProjectSignals {
  /** Current git branch name, or null if unavailable. */
  branch: string | null;
  /** Whether the working tree has no uncommitted changes. */
  isClean: boolean | null;
  /** Number of uncommitted changes (modified, staged, deleted, etc.). */
  uncommittedCount: number | null;
  /** Human-readable age of the last commit (e.g., "2 hours ago"). */
  lastCommitAge: string | null;
  /** Message from the last commit. */
  lastCommitMessage: string | null;
  /** Count of TODO/FIXME/HACK markers found in project files. */
  todoCount: number | null;
  /** Detected project type(s) as comma-separated string. */
  projectType: string;
}

const ALWAYS_EXCLUDE = new Set([
  'node_modules', '.git', 'dist', 'build', '__pycache__', '.venv', 'venv', 'target',
]);

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.pdf', '.zip', '.tar', '.gz', '.bz2',
  '.woff', '.woff2', '.ttf', '.otf', '.mp3', '.mp4', '.wav', '.avi',
  '.exe', '.dll', '.so', '.dylib', '.pyc', '.class', '.db', '.sqlite',
]);

/**
 * Formats a date into a human-readable relative time string.
 * @param date - The date to format.
 * @returns A string like "just now", "5 minutes ago", "2 hours ago", "3 days ago", etc.
 * @example
 * formatAge(new Date(Date.now() - 60000)) // "1 minute ago"
 */
export function formatAge(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const secs = Math.floor(diffMs / 1000);
  const mins = Math.floor(secs / 60);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);

  if (secs < 60) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  if (weeks < 4) return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

async function getGitSignals(cwd: string): Promise<Pick<
  ProjectSignals,
  'branch' | 'isClean' | 'uncommittedCount' | 'lastCommitAge' | 'lastCommitMessage'
> | null> {
  const git = simpleGit(cwd);

  const op = async () => {
    const [branch, status, log] = await Promise.all([
      git.branchLocal(),
      git.status(),
      git.log({ maxCount: 1 }),
    ]);

    const uncommittedCount =
      status.modified.length +
      status.not_added.length +
      status.staged.length +
      status.deleted.length +
      status.renamed.length;

    const latest = log.latest;

    return {
      branch: branch.current ?? 'HEAD',
      isClean: status.isClean(),
      uncommittedCount,
      lastCommitAge: latest ? formatAge(new Date(latest.date)) : null,
      lastCommitMessage: latest?.message?.trim() ?? null,
    };
  };

  const gitTimeout = parseInt(process.env.MOOD_GIT_TIMEOUT || GIT_TIMEOUT_MS.toString(), 10);
  const timeout = new Promise<null>((resolve) => {
    setTimeout(() => {
      console.warn(`mood: git operations timed out after ${gitTimeout}ms`);
      resolve(null);
    }, gitTimeout);
  });
  return Promise.race([op().catch((e) => { throw new GitError(`git operations failed: ${e.message}`); }), timeout]);
}

async function getTodoCount(cwd: string, useCache: boolean = true): Promise<number | null> {
  try {
    let count = 0;
    let scanned = 0;
    const limit = pLimit(MAX_CONCURRENT_FILES);

    // Load cache if enabled
    let cache = useCache ? loadCache(cwd) : null;
    let cacheModified = false;

    // Get current commit hash for cache validation
    let commitHash = '';
    if (useCache) {
      try {
        const git = simpleGit(cwd);
        const log = await git.log({ maxCount: 1 });
        commitHash = log.latest?.hash ?? '';

        // Invalidate cache if commit changed
        if (cache && cache.commitHash !== commitHash) {
          cache = null;
        }
      } catch {
        // Git operations failed, continue without cache
        cache = null;
      }
    }

    // Create new cache if needed
    if (useCache && !cache && commitHash) {
      cache = createCache(commitHash);
      cacheModified = true;
    }

    async function walk(dir: string): Promise<void> {
      if (scanned >= MAX_FILES_TO_SCAN) return;
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (scanned >= MAX_FILES_TO_SCAN) return;
        if (ALWAYS_EXCLUDE.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) continue;
        const resolved = path.resolve(full);
        if (!resolved.startsWith(path.resolve(cwd) + path.sep)) continue;
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile()) {
          if (BINARY_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
          scanned++;
          await limit(async () => {
            try {
              const content = await fs.promises.readFile(full, 'utf8');
              if (content.includes('\0')) return; // skip binary files

              // Check cache first
              let fileCount: number;
              const cached = cache ? getCachedTodoCount(cache, full, content) : null;
              if (cached !== null) {
                fileCount = cached;
              } else {
                // Count TODOs in this file
                const matches = content.match(/\b(TODO|FIXME|HACK)(?::|\s|$)/g);
                fileCount = matches ? matches.length : 0;

                // Update cache
                if (cache) {
                  updateCache(cache, full, content, fileCount);
                  cacheModified = true;
                }
              }
              count += fileCount;
            } catch {
              // skip unreadable files
            }
          });
        }
      }
    }

    await walk(cwd);

    // Save cache if modified
    if (cacheModified && cache) {
      saveCache(cwd, cache);
    }

    return count;
  } catch (e) {
    throw new FileSystemError(`file system operations failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function getProjectType(cwd: string): string {
  const types: string[] = [];
  if (fs.existsSync(path.join(cwd, 'package.json'))) types.push('Node');
  if (fs.existsSync(path.join(cwd, 'deno.json')) || fs.existsSync(path.join(cwd, 'deno.jsonc'))) types.push('Deno');
  if (fs.existsSync(path.join(cwd, 'bun.lockb'))) types.push('Bun');
  if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) types.push('Rust');
  if (fs.existsSync(path.join(cwd, 'pyproject.toml'))) types.push('Python');
  if (fs.existsSync(path.join(cwd, 'go.mod'))) types.push('Go');
  if (fs.existsSync(path.join(cwd, 'pom.xml'))) types.push('Java/Maven');
  if (fs.existsSync(path.join(cwd, 'build.gradle')) || fs.existsSync(path.join(cwd, 'build.gradle.kts'))) types.push('Java/Gradle');
  if (fs.existsSync(path.join(cwd, 'Gemfile'))) types.push('Ruby');
  if (fs.existsSync(path.join(cwd, 'mix.exs'))) types.push('Elixir');
  if (fs.existsSync(path.join(cwd, 'composer.json'))) types.push('PHP');
  if (fs.existsSync(path.join(cwd, 'Package.swift'))) types.push('Swift');
  if (fs.existsSync(path.join(cwd, 'build.zig'))) types.push('Zig');
  return types.length > 0 ? types.join(', ') : 'unknown';
}

/**
 * Collects project signals from git status and file system scanning.
 * @param cwd - The current working directory to analyze.
 * @param useCache - Whether to use caching for TODO counts (default: true).
 * @returns A Promise resolving to the collected signals.
 * @throws {GitError} When git operations fail unexpectedly.
 * @throws {FileSystemError} When file system operations fail unexpectedly.
 * @example
 * const signals = await collectSignals(process.cwd());
 * console.log(signals.branch); // "main"
 * console.log(signals.todoCount); // 5
 */
export async function collectSignals(cwd: string, useCache: boolean = true): Promise<ProjectSignals> {
  let git = null;
  try {
    git = await getGitSignals(cwd);
  } catch (e) {
    if (e instanceof GitError) {
      git = null;
    } else {
      throw e;
    }
  }

  let todoCount = null;
  try {
    todoCount = await getTodoCount(cwd, useCache);
  } catch (e) {
    if (e instanceof FileSystemError) {
      todoCount = null;
    } else {
      throw e;
    }
  }

  const projectType = getProjectType(cwd);

  return {
    branch: git?.branch ?? null,
    isClean: git?.isClean ?? null,
    uncommittedCount: git?.uncommittedCount ?? null,
    lastCommitAge: git?.lastCommitAge ?? null,
    lastCommitMessage: git?.lastCommitMessage ?? null,
    todoCount,
    projectType,
  };
}

/**
 * Formats project signals into a human-readable message for AI processing.
 * @param signals - The project signals to format.
 * @returns A formatted string describing the project state.
 * @example
 * const message = formatSignalsMessage({
 *   branch: "main",
 *   isClean: true,
 *   uncommittedCount: 0,
 *   lastCommitAge: "2 hours ago",
 *   lastCommitMessage: "fix: bug",
 *   todoCount: 3,
 *   projectType: "Node"
 * });
 * // "Branch "main", clean working tree.\nLast commit 2 hours ago: "fix: bug".\n3 TODO/FIXME/HACK markers across tracked files. Node project."
 */
export function formatSignalsMessage(signals: ProjectSignals): string {
  const lines: string[] = [];

  if (signals.branch !== null) {
    const state =
      signals.isClean
        ? 'clean working tree'
        : `${signals.uncommittedCount ?? 0} uncommitted change${signals.uncommittedCount === 1 ? '' : 's'}`;
    lines.push(`Branch "${signals.branch}", ${state}.`);
  } else {
    lines.push('Git status unavailable.');
  }

  if (signals.lastCommitAge !== null && signals.lastCommitMessage !== null) {
    lines.push(`Last commit ${signals.lastCommitAge}: "${signals.lastCommitMessage}".`);
  }

  const parts: string[] = [];
  if (signals.todoCount !== null) {
    parts.push(`${signals.todoCount} TODO/FIXME/HACK marker${signals.todoCount === 1 ? '' : 's'} across tracked files.`);
  }
  parts.push(`${signals.projectType} project.`);
  lines.push(parts.join(' '));

  return lines.join('\n');
}
