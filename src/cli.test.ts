import { describe, expect, it, vi } from 'vitest';
import { runCli } from './cli.js';
import type { BedrockClientLike } from './bedrock.js';
import type { ProjectSignals } from './collect.js';

const TEST_CONFIG = {
  model: 'test-model',
  timeout: 1000,
  gitTimeout: 5000,
  awsRegion: 'us-east-1',
  maxFiles: 1000,
  maxConcurrent: 50,
  excludePatterns: [],
};

function makeWriter() {
  let content = '';
  return {
    write: (chunk: string) => {
      content += chunk;
    },
    text: () => content,
  };
}

function makeSignals(): ProjectSignals {
  return {
    branch: 'main',
    isClean: false,
    uncommittedCount: 2,
    lastCommitAge: '1 hour ago',
    lastCommitMessage: 'wip',
    todoCount: 5,
    projectType: 'Node',
  };
}

describe('runCli --status', () => {
  it('prints status report and returns non-zero when provider is blocked', async () => {
    const stdout = makeWriter();
    const stderr = makeWriter();
    const createClient = vi.fn(() => ({ send: vi.fn() }) as BedrockClientLike);
    const checkProviderStatus = vi.fn().mockResolvedValue({
      provider: 'AWS Bedrock',
      readiness: 'blocked',
      model: TEST_CONFIG.model,
      region: TEST_CONFIG.awsRegion,
      profile: 'default',
      issue: {
        kind: 'access_denied',
        signature: 'AccessDeniedException: denied',
        message: 'denied',
        tips: ['fix iam'],
      },
    });
    const formatStatusReport = vi.fn().mockReturnValue('status report');
    const isRepo = vi.fn();
    const collectSignals = vi.fn();

    const code = await runCli(['--status'], {
      cwd: () => '/tmp/test-repo',
      stdout,
      stderr,
      awsProfile: 'default',
      loadConfig: () => TEST_CONFIG,
      createClient,
      checkProviderStatus,
      formatStatusReport,
      isRepo,
      collectSignals,
    });

    expect(code).toBe(1);
    expect(stdout.text()).toBe('status report\n');
    expect(stderr.text()).toBe('');
    expect(isRepo).not.toHaveBeenCalled();
    expect(collectSignals).not.toHaveBeenCalled();
  });

  it('returns zero when provider readiness is ready', async () => {
    const stdout = makeWriter();
    const code = await runCli(['--status'], {
      cwd: () => '/tmp/test-repo',
      stdout,
      stderr: makeWriter(),
      loadConfig: () => TEST_CONFIG,
      createClient: () => ({ send: vi.fn() }) as BedrockClientLike,
      checkProviderStatus: vi.fn().mockResolvedValue({
        provider: 'AWS Bedrock',
        readiness: 'ready',
        model: TEST_CONFIG.model,
        region: TEST_CONFIG.awsRegion,
        profile: 'default',
      }),
      formatStatusReport: vi.fn().mockReturnValue('ready report'),
    });

    expect(code).toBe(0);
    expect(stdout.text()).toBe('ready report\n');
  });
});

describe('runCli fallback mode', () => {
  it('returns local summary with remediation tips when Bedrock is blocked', async () => {
    const stdout = makeWriter();
    const stderr = makeWriter();

    const code = await runCli([], {
      cwd: () => '/tmp/test-repo',
      stdout,
      stderr,
      loadConfig: () => TEST_CONFIG,
      createClient: () => ({ send: vi.fn() }) as BedrockClientLike,
      isRepo: vi.fn().mockResolvedValue(true),
      collectSignals: vi.fn().mockResolvedValue(makeSignals()),
      generateMoodSummary: vi.fn().mockResolvedValue({
        source: 'local',
        text: 'local summary',
        issue: {
          kind: 'model_access_blocked',
          signature: 'ValidationException: model access blocked',
          message: 'model access blocked',
          tips: ['enable model access', 'retry later'],
        },
      }),
    });

    expect(code).toBe(0);
    expect(stdout.text()).toBe('local summary\n');
    expect(stderr.text()).toContain('mood: Bedrock unavailable');
    expect(stderr.text()).toContain('mood: using local summary fallback');
    expect(stderr.text()).toContain('mood: tip: enable model access');
    expect(stderr.text()).toContain('mood: tip: retry later');
  });
});

// ─── --help / --version ───────────────────────────────────────────────────────

describe('runCli --help', () => {
  it('prints help text and exits 0', async () => {
    const stdout = makeWriter();
    const code = await runCli(['--help'], { stdout, stderr: makeWriter() });
    expect(code).toBe(0);
    expect(stdout.text()).toContain('mood');
    expect(stdout.text()).toContain('--config');
    expect(stdout.text()).toContain('--model');
  });

  it('-h is an alias for --help', async () => {
    const stdout = makeWriter();
    const code = await runCli(['-h'], { stdout, stderr: makeWriter() });
    expect(code).toBe(0);
    expect(stdout.text()).toContain('--help');
  });
});

describe('runCli --version', () => {
  it('emits the version string to stdout and exits 0', async () => {
    const stdout = makeWriter();
    const code = await runCli(['--version'], { stdout, stderr: makeWriter() });
    expect(code).toBe(0);
    // vitest.config.ts defines __VERSION__ as '0.0.0-test'
    expect(stdout.text().trim()).toBe('0.0.0-test');
  });
});

// ─── not a git repo ───────────────────────────────────────────────────────────

describe('runCli — not a git repo', () => {
  it('exits 1 with a clear message when the cwd is not a git repo', async () => {
    const stderr = makeWriter();
    const code = await runCli([], {
      cwd: () => '/tmp/not-a-repo',
      stdout: makeWriter(),
      stderr,
      loadConfig: () => TEST_CONFIG,
      createClient: () => ({ send: vi.fn() }) as BedrockClientLike,
      isRepo: vi.fn().mockResolvedValue(false),
    });
    expect(code).toBe(1);
    expect(stderr.text()).toBe('mood: not a git repository\n');
  });
});

// ─── happy path ───────────────────────────────────────────────────────────────

describe('runCli — happy path', () => {
  it('prints Bedrock summary to stdout and exits 0', async () => {
    const stdout = makeWriter();
    const stderr = makeWriter();

    const code = await runCli([], {
      cwd: () => '/tmp/test-repo',
      stdout,
      stderr,
      loadConfig: () => TEST_CONFIG,
      createClient: () => ({ send: vi.fn() }) as BedrockClientLike,
      isRepo: vi.fn().mockResolvedValue(true),
      collectSignals: vi.fn().mockResolvedValue(makeSignals()),
      generateMoodSummary: vi.fn().mockResolvedValue({
        source: 'bedrock',
        text: 'all good out here',
      }),
    });

    expect(code).toBe(0);
    expect(stdout.text()).toBe('all good out here\n');
    expect(stderr.text()).toBe('');
  });
});

// ─── --no-cache propagation ───────────────────────────────────────────────────

describe('runCli --no-cache', () => {
  it('passes useCache=false to collectSignals', async () => {
    const collectSignals = vi.fn().mockResolvedValue(makeSignals());

    await runCli(['--no-cache'], {
      cwd: () => '/tmp/test-repo',
      stdout: makeWriter(),
      stderr: makeWriter(),
      loadConfig: () => TEST_CONFIG,
      createClient: () => ({ send: vi.fn() }) as BedrockClientLike,
      isRepo: vi.fn().mockResolvedValue(true),
      collectSignals,
      generateMoodSummary: vi.fn().mockResolvedValue({ source: 'bedrock', text: 'ok' }),
    });

    expect(collectSignals).toHaveBeenCalledWith(
      '/tmp/test-repo',
      false,
      expect.objectContaining({ gitTimeout: TEST_CONFIG.gitTimeout }),
    );
  });
});

// ─── non-fallback Bedrock error ───────────────────────────────────────────────

describe('runCli — non-fallback Bedrock error', () => {
  it('exits 1 and prints the error signature + tips to stderr (credentials kind)', async () => {
    const stderr = makeWriter();

    const code = await runCli([], {
      cwd: () => '/tmp/test-repo',
      stdout: makeWriter(),
      stderr,
      loadConfig: () => TEST_CONFIG,
      createClient: () => ({ send: vi.fn() }) as BedrockClientLike,
      isRepo: vi.fn().mockResolvedValue(true),
      collectSignals: vi.fn().mockResolvedValue(makeSignals()),
      generateMoodSummary: vi.fn().mockRejectedValue(
        Object.assign(new Error('Could not load credentials'), {
          name: 'CredentialsProviderError',
        }),
      ),
    });

    expect(code).toBe(1);
    expect(stderr.text()).toContain('CredentialsProviderError');
    expect(stderr.text()).toContain('mood: tip:');
  });
});
