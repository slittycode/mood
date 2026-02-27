import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    createCache,
    loadCache,
    saveCache,
    getCachedTodoCount,
    updateCache,
} from './cache.js';

function makeTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'mood-cache-test-'));
}

// ─── createCache ──────────────────────────────────────────────────────────────

describe('createCache', () => {
    it('creates an empty cache with the given commit hash', () => {
        const cache = createCache('abc123');
        expect(cache.commitHash).toBe('abc123');
        expect(cache.files.size).toBe(0);
        expect(cache.cachedAt).toBeGreaterThan(0);
    });
});

// ─── saveCache / loadCache round-trip ─────────────────────────────────────────

describe('saveCache / loadCache', () => {
    let tmpDir: string;

    beforeEach(() => { tmpDir = makeTempDir(); });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

    it('round-trips cache data to disk and back', () => {
        const cache = createCache('deadbeef');
        saveCache(tmpDir, cache);

        const loaded = loadCache(tmpDir);
        expect(loaded).not.toBeNull();
        expect(loaded!.commitHash).toBe('deadbeef');
        expect(loaded!.files.size).toBe(0);
    });

    it('returns null when no cache file exists', () => {
        expect(loadCache(tmpDir)).toBeNull();
    });

    it('returns null when the cache version does not match', () => {
        const cachePath = path.join(tmpDir, '.mood', 'cache.json');
        fs.mkdirSync(path.dirname(cachePath), { recursive: true });
        fs.writeFileSync(
            cachePath,
            JSON.stringify({ version: 999, commitHash: 'x', cachedAt: Date.now(), files: {} }),
        );
        expect(loadCache(tmpDir)).toBeNull();
    });

    it('returns null when the cache has exceeded its TTL', () => {
        const cachePath = path.join(tmpDir, '.mood', 'cache.json');
        fs.mkdirSync(path.dirname(cachePath), { recursive: true });
        // cachedAt = 2 days ago
        const staleTime = Date.now() - 2 * 24 * 60 * 60 * 1000;
        fs.writeFileSync(
            cachePath,
            JSON.stringify({ version: 1, commitHash: 'x', cachedAt: staleTime, files: {} }),
        );
        expect(loadCache(tmpDir)).toBeNull();
    });

    it('preserves file entries through a round-trip', () => {
        const cache = createCache('hash1');
        const filePath = path.join(tmpDir, 'foo.ts');
        fs.writeFileSync(filePath, 'hello');
        updateCache(cache, filePath, 'hello', 3);
        saveCache(tmpDir, cache);

        const loaded = loadCache(tmpDir);
        expect(loaded!.files.has(filePath)).toBe(true);
        expect(loaded!.files.get(filePath)!.todoCount).toBe(3);
    });

    it('silently ignores write errors (read-only dir)', () => {
        // Point saveCache at a path where we cannot write: pass an object that will
        // fail mkdirSync by using a non-directory as the base.
        const filePath = path.join(tmpDir, 'not-a-dir');
        fs.writeFileSync(filePath, 'block');
        // saveCache must not throw even if the directory cannot be created.
        expect(() => saveCache(filePath, createCache('x'))).not.toThrow();
    });
});

// ─── getCachedTodoCount ───────────────────────────────────────────────────────

describe('getCachedTodoCount', () => {
    let tmpDir: string;

    beforeEach(() => { tmpDir = makeTempDir(); });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

    it('returns null when cache is null', () => {
        expect(getCachedTodoCount(null, '/any/file.ts', 'content')).toBeNull();
    });

    it('returns null when the file has no entry in the cache', () => {
        const cache = createCache('h');
        expect(getCachedTodoCount(cache, '/nonexistent.ts', '')).toBeNull();
    });

    it('returns the cached count when mtime and size match', () => {
        const filePath = path.join(tmpDir, 'file.ts');
        const content = '// TODO fix\n';
        fs.writeFileSync(filePath, content);

        const cache = createCache('h');
        updateCache(cache, filePath, content, 1);

        expect(getCachedTodoCount(cache, filePath, content)).toBe(1);
    });

    it('returns null when the file mtime has changed', () => {
        const filePath = path.join(tmpDir, 'file.ts');
        fs.writeFileSync(filePath, 'old');

        const cache = createCache('h');
        updateCache(cache, filePath, 'old', 2);

        // Mutate the entry's mtime to simulate a changed file
        const entry = cache.files.get(filePath)!;
        cache.files.set(filePath, { ...entry, mtime: entry.mtime - 1000 });

        expect(getCachedTodoCount(cache, filePath, 'old')).toBeNull();
    });

    it('returns null when the file size has changed', () => {
        const filePath = path.join(tmpDir, 'file.ts');
        fs.writeFileSync(filePath, 'old');

        const cache = createCache('h');
        updateCache(cache, filePath, 'old', 0);

        const entry = cache.files.get(filePath)!;
        cache.files.set(filePath, { ...entry, size: entry.size + 99 });

        expect(getCachedTodoCount(cache, filePath, 'old')).toBeNull();
    });
});

// ─── updateCache ─────────────────────────────────────────────────────────────

describe('updateCache', () => {
    let tmpDir: string;

    beforeEach(() => { tmpDir = makeTempDir(); });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

    it('stores mtime, size and todoCount from the real file', () => {
        const filePath = path.join(tmpDir, 'src.ts');
        const content = '// FIXME\n';
        fs.writeFileSync(filePath, content);

        const stats = fs.statSync(filePath);
        const cache = createCache('h');
        updateCache(cache, filePath, content, 1);

        const entry = cache.files.get(filePath)!;
        expect(entry.todoCount).toBe(1);
        expect(entry.mtime).toBe(stats.mtimeMs);
        expect(entry.size).toBe(stats.size);
    });

    it('overwrites an existing entry', () => {
        const filePath = path.join(tmpDir, 'src.ts');
        fs.writeFileSync(filePath, '// TODO\n');

        const cache = createCache('h');
        updateCache(cache, filePath, '// TODO\n', 5);
        updateCache(cache, filePath, '// TODO\n', 1);

        expect(cache.files.get(filePath)!.todoCount).toBe(1);
    });
});
