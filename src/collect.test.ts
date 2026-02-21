import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { formatAge, collectSignals, formatSignalsMessage } from './collect.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mood-test-'));
}

function initRepo(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'pipe' });
}

function gitAdd(dir: string): void {
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'pipe' });
}

function gitCommit(dir: string, message: string): void {
  execFileSync('git', ['commit', '-m', message], { cwd: dir, stdio: 'pipe' });
}

// ─── formatAge ────────────────────────────────────────────────────────────────

describe('formatAge', () => {
  it('returns "just now" under a minute', () => {
    expect(formatAge(new Date(Date.now() - 30_000))).toBe('just now');
  });

  it('returns singular minute', () => {
    expect(formatAge(new Date(Date.now() - 60_000))).toBe('1 minute ago');
  });

  it('returns plural minutes', () => {
    expect(formatAge(new Date(Date.now() - 5 * 60_000))).toBe('5 minutes ago');
  });

  it('returns singular hour', () => {
    expect(formatAge(new Date(Date.now() - 3600_000))).toBe('1 hour ago');
  });

  it('returns plural hours', () => {
    expect(formatAge(new Date(Date.now() - 3 * 3600_000))).toBe('3 hours ago');
  });

  it('returns singular day', () => {
    expect(formatAge(new Date(Date.now() - 86400_000))).toBe('1 day ago');
  });

  it('returns plural days', () => {
    expect(formatAge(new Date(Date.now() - 3 * 86400_000))).toBe('3 days ago');
  });

  it('returns weeks', () => {
    expect(formatAge(new Date(Date.now() - 14 * 86400_000))).toBe('2 weeks ago');
  });

  it('returns months', () => {
    expect(formatAge(new Date(Date.now() - 60 * 86400_000))).toBe('2 months ago');
  });
});

// ─── collectSignals ───────────────────────────────────────────────────────────

describe('collectSignals', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('collects git + project signals from a real repo', async () => {
    initRepo(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"test"}');
    fs.writeFileSync(
      path.join(tmpDir, 'index.ts'),
      '// TODO fix this\n// FIXME and this\nconst x = 1;\n',
    );
    gitAdd(tmpDir);
    gitCommit(tmpDir, 'initial commit');

    const signals = await collectSignals(tmpDir);

    expect(signals.branch).toBeTruthy();
    expect(signals.isClean).toBe(true);
    expect(signals.uncommittedCount).toBe(0);
    expect(signals.lastCommitAge).toBe('just now');
    expect(signals.lastCommitMessage).toBe('initial commit');
    expect(signals.todoCount).toBe(2);
    expect(signals.projectType).toBe('Node');
  });

  it('reflects dirty working tree', async () => {
    initRepo(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'hello');
    gitAdd(tmpDir);
    gitCommit(tmpDir, 'init');
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'changed');

    const signals = await collectSignals(tmpDir);
    expect(signals.isClean).toBe(false);
    expect(signals.uncommittedCount).toBeGreaterThan(0);
  });

  it('returns null git fields for a non-git directory', async () => {
    const signals = await collectSignals(tmpDir);
    expect(signals.branch).toBeNull();
  });
});

// ─── git repo detection ───────────────────────────────────────────────────────

describe('git repo detection', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns false for a non-git directory', async () => {
    const { simpleGit } = await import('simple-git');
    const isRepo = await simpleGit(tmpDir).checkIsRepo().catch(() => false);
    expect(isRepo).toBe(false);
  });

  it('returns true for an initialized repo', async () => {
    initRepo(tmpDir);
    const { simpleGit } = await import('simple-git');
    const isRepo = await simpleGit(tmpDir).checkIsRepo().catch(() => false);
    expect(isRepo).toBe(true);
  });
});

// ─── formatSignalsMessage ─────────────────────────────────────────────────────

describe('formatSignalsMessage', () => {
  it('formats a clean repo', () => {
    const msg = formatSignalsMessage({
      branch: 'main',
      isClean: true,
      uncommittedCount: 0,
      lastCommitAge: '2 hours ago',
      lastCommitMessage: 'fix: align header',
      todoCount: 3,
      projectType: 'Node',
    });
    expect(msg).toContain('Branch "main", clean working tree.');
    expect(msg).toContain('Last commit 2 hours ago: "fix: align header".');
    expect(msg).toContain('3 TODO/FIXME/HACK markers');
    expect(msg).toContain('Node project.');
  });

  it('formats a dirty repo with singular change', () => {
    const msg = formatSignalsMessage({
      branch: 'feature/x',
      isClean: false,
      uncommittedCount: 1,
      lastCommitAge: '1 day ago',
      lastCommitMessage: 'wip',
      todoCount: 0,
      projectType: 'Rust',
    });
    expect(msg).toContain('1 uncommitted change.');
    expect(msg).not.toContain('changes.');
    expect(msg).toContain('Rust project.');
  });

  it('handles null git signals gracefully', () => {
    const msg = formatSignalsMessage({
      branch: null,
      isClean: null,
      uncommittedCount: null,
      lastCommitAge: null,
      lastCommitMessage: null,
      todoCount: null,
      projectType: 'Go',
    });
    expect(msg).toContain('Git status unavailable.');
    expect(msg).toContain('Go project.');
  });

  it('handles singular TODO marker', () => {
    const msg = formatSignalsMessage({
      branch: 'main',
      isClean: true,
      uncommittedCount: 0,
      lastCommitAge: 'just now',
      lastCommitMessage: 'init',
      todoCount: 1,
      projectType: 'Node',
    });
    expect(msg).toContain('1 TODO/FIXME/HACK marker ');
    expect(msg).not.toContain('markers');
  });
});

// ─── project type detection ───────────────────────────────────────────────────

describe('project type detection', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('detects Deno project', async () => {
    initRepo(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'deno.json'), '{}');
    gitAdd(tmpDir);
    gitCommit(tmpDir, 'init');

    const signals = await collectSignals(tmpDir);
    expect(signals.projectType).toContain('Deno');
  });

  it('detects Java/Maven project', async () => {
    initRepo(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'pom.xml'), '<project></project>');
    gitAdd(tmpDir);
    gitCommit(tmpDir, 'init');

    const signals = await collectSignals(tmpDir);
    expect(signals.projectType).toContain('Java/Maven');
  });

  it('detects Ruby project', async () => {
    initRepo(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'Gemfile'), "source 'https://rubygems.org'");
    gitAdd(tmpDir);
    gitCommit(tmpDir, 'init');

    const signals = await collectSignals(tmpDir);
    expect(signals.projectType).toContain('Ruby');
  });

  it('detects multiple project types', async () => {
    initRepo(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'Cargo.toml'), '[package]');
    gitAdd(tmpDir);
    gitCommit(tmpDir, 'init');

    const signals = await collectSignals(tmpDir);
    expect(signals.projectType).toContain('Node');
    expect(signals.projectType).toContain('Rust');
  });
});

// ─── performance & security tests ────────────────────────────────────────────

describe('performance and security', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('respects file scan limit (1000 files)', async () => {
    initRepo(tmpDir);
    // Create 1500 small files
    for (let i = 0; i < 1500; i++) {
      fs.writeFileSync(path.join(tmpDir, `file${i}.txt`), `// TODO ${i}\n`);
    }
    gitAdd(tmpDir);
    gitCommit(tmpDir, 'init');

    const start = Date.now();
    const signals = await collectSignals(tmpDir);
    const duration = Date.now() - start;

    // Should complete quickly despite 1500 files
    expect(duration).toBeLessThan(5000);
    // TODO count should be capped at 1000 files worth
    expect(signals.todoCount).toBeLessThanOrEqual(1000);
  });

  it('skips symlinks to prevent traversal attacks', async () => {
    initRepo(tmpDir);
    const targetDir = makeTempDir();

    try {
      // Create a file outside the repo
      fs.writeFileSync(path.join(targetDir, 'outside.txt'), '// TODO outside\n');

      // Create a symlink pointing outside
      fs.symlinkSync(targetDir, path.join(tmpDir, 'link'), 'dir');

      fs.writeFileSync(path.join(tmpDir, 'inside.txt'), '// TODO inside\n');
      gitAdd(tmpDir);
      gitCommit(tmpDir, 'init');

      const signals = await collectSignals(tmpDir);
      // Should only count TODO in inside.txt, not the symlinked directory
      expect(signals.todoCount).toBe(1);
    } finally {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
  });

  it('handles deeply nested directory structures', async () => {
    initRepo(tmpDir);

    // Create 10 levels deep
    let currentDir = tmpDir;
    for (let i = 0; i < 10; i++) {
      currentDir = path.join(currentDir, `level${i}`);
      fs.mkdirSync(currentDir);
      fs.writeFileSync(path.join(currentDir, `file${i}.txt`), `// TODO at level ${i}\n`);
    }

    gitAdd(tmpDir);
    gitCommit(tmpDir, 'init');

    const signals = await collectSignals(tmpDir);
    expect(signals.todoCount).toBe(10);
  });

  it('skips binary files', async () => {
    initRepo(tmpDir);

    // Create a file with null bytes (binary)
    fs.writeFileSync(path.join(tmpDir, 'binary.txt'), Buffer.from([0x00, 0x01, 0x02, 0x03]));
    fs.writeFileSync(path.join(tmpDir, 'text.txt'), '// TODO in text\n');

    gitAdd(tmpDir);
    gitCommit(tmpDir, 'init');

    const signals = await collectSignals(tmpDir);
    // Should only count TODO in text.txt, not binary
    expect(signals.todoCount).toBe(1);
  });
});
