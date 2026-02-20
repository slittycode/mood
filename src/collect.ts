import * as fs from 'node:fs';
import * as path from 'node:path';
import { simpleGit } from 'simple-git';

export interface ProjectSignals {
  branch: string | null;
  isClean: boolean | null;
  uncommittedCount: number | null;
  lastCommitAge: string | null;
  lastCommitMessage: string | null;
  todoCount: number | null;
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

  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 500));
  return Promise.race([op().catch(() => null), timeout]);
}

function getTodoCount(cwd: string): number | null {
  try {
    let count = 0;
    let scanned = 0;

    function walk(dir: string): void {
      if (scanned >= 1000) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (scanned >= 1000) return;
        if (ALWAYS_EXCLUDE.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          if (BINARY_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
          scanned++;
          try {
            const matches = fs.readFileSync(full, 'utf8').match(/\b(TODO|FIXME|HACK)\b/g);
            if (matches) count += matches.length;
          } catch {
            // skip unreadable files
          }
        }
      }
    }

    walk(cwd);
    return count;
  } catch {
    return null;
  }
}

function getProjectType(cwd: string): string {
  const types: string[] = [];
  if (fs.existsSync(path.join(cwd, 'package.json'))) types.push('Node');
  if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) types.push('Rust');
  if (fs.existsSync(path.join(cwd, 'pyproject.toml'))) types.push('Python');
  if (fs.existsSync(path.join(cwd, 'go.mod'))) types.push('Go');
  return types.length > 0 ? types.join(', ') : 'unknown';
}

export async function collectSignals(cwd: string): Promise<ProjectSignals> {
  const [git, todoCount] = await Promise.all([
    getGitSignals(cwd),
    Promise.resolve(getTodoCount(cwd)),
  ]);

  return {
    branch: git?.branch ?? null,
    isClean: git?.isClean ?? null,
    uncommittedCount: git?.uncommittedCount ?? null,
    lastCommitAge: git?.lastCommitAge ?? null,
    lastCommitMessage: git?.lastCommitMessage ?? null,
    todoCount,
    projectType: getProjectType(cwd),
  };
}

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
