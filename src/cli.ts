import { pathToFileURL } from 'node:url';
import { simpleGit } from 'simple-git';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { collectSignals } from './collect.js';
import { loadConfig } from './config.js';
import {
  type BedrockClientLike,
  checkProviderStatus,
  classifyBedrockIssue,
  formatStatusReport,
  generateMoodSummary,
} from './bedrock.js';

const SYSTEM_PROMPT =
  'You are a terse, observant assistant. Describe the current state of a software ' +
  'project in 2-3 casual sentences based on signals provided. Write like a weatherman ' +
  'giving a quick forecast — direct, vivid, no bullet points, no headers, no technical ' +
  'jargon. Capture the feeling of the project, not a status report.';

// Injected at build time by tsup; falls back to a literal for typecheck/test environments.
declare const __VERSION__: string;

interface CliArgs {
  config?: string;
  model?: string;
  timeout?: number;
  gitTimeout?: number;
  status: boolean;
  noCache: boolean;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { help: false, version: false, noCache: false, status: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--config':
        args.config = argv[++i] ?? '';
        break;
      case '--model':
        args.model = argv[++i] ?? '';
        break;
      case '--timeout':
        args.timeout = parseInt(argv[++i] ?? '', 10);
        break;
      case '--git-timeout':
        args.gitTimeout = parseInt(argv[++i] ?? '', 10);
        break;
      case '--no-cache':
        args.noCache = true;
        break;
      case '--status':
        args.status = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--version':
      case '-v':
        args.version = true;
        break;
    }
  }
  return args;
}

function getHelpText(): string {
  return `mood v${__VERSION__} - Project weather report

Usage: mood [options]

Options:
  --config <path>      Path to config file (.moodrc, .moodrc.json, .moodrc.yaml)
  --model <name>       AWS Bedrock model to use (default: claude-3-5-sonnet-20241022)
  --timeout <ms>       CLI timeout in milliseconds (default: 10000)
  --git-timeout <ms>   Git operations timeout in milliseconds (default: 5000)
  --no-cache           Disable TODO count caching
  --status             Show AWS Bedrock provider diagnostics
  --help, -h           Show this help message
  --version, -v        Show version

Environment Variables:
  AWS_PROFILE          AWS profile to use (default: default credential chain)
  AWS_REGION           AWS region to use (default: us-east-1)
  BEDROCK_MODEL_ID     Bedrock model ID (default: us.anthropic.claude-3-5-sonnet-20241022-v2:0)
  MOOD_TIMEOUT         CLI timeout in milliseconds (default: 10000)
  MOOD_GIT_TIMEOUT     Git operations timeout in milliseconds (default: 5000)`;
}

interface CliRuntime {
  cwd?: () => string;
  stdout?: { write: (chunk: string) => unknown };
  stderr?: { write: (chunk: string) => unknown };
  awsProfile?: string;
  createClient?: (region: string) => BedrockClientLike;
  isRepo?: (cwd: string) => Promise<boolean>;
  collectSignals?: typeof collectSignals;
  loadConfig?: typeof loadConfig;
  checkProviderStatus?: typeof checkProviderStatus;
  formatStatusReport?: typeof formatStatusReport;
  generateMoodSummary?: typeof generateMoodSummary;
  classifyBedrockIssue?: typeof classifyBedrockIssue;
}

function getAwsProfileName(explicitProfile?: string): string {
  return explicitProfile || process.env.AWS_PROFILE || 'default credential chain';
}

export async function runCli(argv: string[], runtime: CliRuntime = {}): Promise<number> {
  const args = parseArgs(argv);
  const stdout = runtime.stdout ?? process.stdout;
  const stderr = runtime.stderr ?? process.stderr;
  const cwd = runtime.cwd?.() ?? process.cwd();
  const loadConfigFn = runtime.loadConfig ?? loadConfig;
  const createClient = runtime.createClient ?? ((region: string) => new BedrockRuntimeClient({ region }));
  const checkProviderStatusFn = runtime.checkProviderStatus ?? checkProviderStatus;
  const formatStatusReportFn = runtime.formatStatusReport ?? formatStatusReport;
  const collectSignalsFn = runtime.collectSignals ?? collectSignals;
  const generateMoodSummaryFn = runtime.generateMoodSummary ?? generateMoodSummary;
  const classifyBedrockIssueFn = runtime.classifyBedrockIssue ?? classifyBedrockIssue;
  const isRepoFn =
    runtime.isRepo ??
    (async (repoCwd: string) => simpleGit(repoCwd).checkIsRepo().catch(() => false));

  if (args.help) {
    stdout.write(`${getHelpText()}\n`);
    return 0;
  }

  if (args.version) {
    stdout.write(`${__VERSION__}\n`);
    return 0;
  }

  const config = loadConfigFn(cwd, args.config);
  const model = args.model || config.model;
  const timeoutMs = args.timeout || config.timeout;

  if (args.status) {
    const client = createClient(config.awsRegion);
    const status = await checkProviderStatusFn({
      client,
      model,
      timeoutMs,
      region: config.awsRegion,
      profile: getAwsProfileName(runtime.awsProfile),
    });
    stdout.write(`${formatStatusReportFn(status)}\n`);
    return status.readiness === 'ready' ? 0 : 1;
  }

  const isRepo = await isRepoFn(cwd);
  if (!isRepo) {
    stderr.write('mood: not a git repository\n');
    return 1;
  }

  const signals = await collectSignalsFn(cwd, !args.noCache, {
    gitTimeout: config.gitTimeout,
    warn: (msg) => stderr.write(`${msg}\n`),
  });
  const client = createClient(config.awsRegion);
  try {
    const result = await generateMoodSummaryFn({
      client,
      model,
      signals,
      timeoutMs,
      systemPrompt: SYSTEM_PROMPT,
    });

    if (result.source === 'local' && result.issue) {
      stderr.write(`mood: Bedrock unavailable (${result.issue.signature})\n`);
      stderr.write('mood: using local summary fallback\n');
      for (const tip of result.issue.tips) {
        stderr.write(`mood: tip: ${tip}\n`);
      }
    }

    stdout.write(`${result.text}\n`);
    return 0;
  } catch (error) {
    const issue = classifyBedrockIssueFn(error);
    stderr.write(`mood: ${issue.signature}\n`);
    for (const tip of issue.tips) {
      stderr.write(`mood: tip: ${tip}\n`);
    }
    return 1;
  }
}

function isMainModule(): boolean {
  const entryPath = process.argv[1];
  if (!entryPath) {
    return false;
  }
  return import.meta.url === pathToFileURL(entryPath).href;
}

async function main(): Promise<void> {
  const code = await runCli(process.argv.slice(2));
  process.exit(code);
}

if (isMainModule()) {
  main().catch((err: unknown) => {
    process.stderr.write(`mood: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
