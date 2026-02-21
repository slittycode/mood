import { simpleGit } from 'simple-git';
import Anthropic from '@anthropic-ai/sdk';
import { collectSignals, formatSignalsMessage } from './collect.js';
import { loadConfig } from './config.js';
import { CLI_TIMEOUT_MS, MAX_TOKENS } from './constants.js';

const SYSTEM_PROMPT =
  'You are a terse, observant assistant. Describe the current state of a software ' +
  'project in 2-3 casual sentences based on signals provided. Write like a weatherman ' +
  'giving a quick forecast — direct, vivid, no bullet points, no headers, no technical ' +
  'jargon. Capture the feeling of the project, not a status report.';

const VERSION = '0.1.0';

interface CliArgs {
  config?: string;
  model?: string;
  timeout?: number;
  gitTimeout?: number;
  noCache: boolean;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { help: false, version: false, noCache: false };
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

function showHelp(): void {
  console.log(`mood v${VERSION} - Project weather report

Usage: mood [options]

Options:
  --config <path>      Path to config file (.moodrc, .moodrc.json, .moodrc.yaml)
  --model <name>       Anthropic model to use (default: claude-3-5-sonnet-20241022)
  --timeout <ms>       CLI timeout in milliseconds (default: 10000)
  --git-timeout <ms>   Git operations timeout in milliseconds (default: 5000)
  --no-cache           Disable TODO count caching
  --help, -h           Show this help message
  --version, -v        Show version

Environment Variables:
  ANTHROPIC_API_KEY    Required. Your Anthropic API key.
  MOOD_MODEL           Override the AI model.
  MOOD_TIMEOUT         Override CLI timeout.
  MOOD_GIT_TIMEOUT     Override git timeout.
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  if (args.version) {
    console.log(VERSION);
    process.exit(0);
  }

  const cwd = process.cwd();
  const config = loadConfig(cwd, args.config);

  const isRepo = await simpleGit(cwd).checkIsRepo().catch(() => false);
  if (!isRepo) {
    process.stderr.write('mood: not a git repository\n');
    process.exit(1);
  }

  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    process.stderr.write('mood: ANTHROPIC_API_KEY not set\n');
    process.exit(1);
  }

  const signals = await collectSignals(cwd, !args.noCache);
  const message = formatSignalsMessage(signals);

  const client = new Anthropic({ apiKey });
  const controller = new AbortController();
  const timeoutMs = args.timeout || config.timeout;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const model = args.model || config.model;

  try {
    const stream = client.messages.stream(
      {
        model,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: message }],
      },
      { signal: controller.signal },
    );

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        process.stdout.write(event.delta.text);
      }
    }
    process.stdout.write('\n');
  } finally {
    clearTimeout(timeout);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`mood: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
