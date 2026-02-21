import { simpleGit } from 'simple-git';
import { BedrockRuntimeClient, InvokeModelWithResponseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
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
  --model <name>       AWS Bedrock model to use (default: claude-3-5-sonnet-20241022)
  --timeout <ms>       CLI timeout in milliseconds (default: 10000)
  --git-timeout <ms>   Git operations timeout in milliseconds (default: 5000)
  --no-cache           Disable TODO count caching
  --help, -h           Show this help message
  --version, -v        Show version

Environment Variables:
  AWS_REGION           AWS region to use (default: us-east-1)
  BEDROCK_MODEL_ID     Bedrock model ID (default: us.anthropic.claude-3-5-sonnet-20241022-v2:0)
  MOOD_TIMEOUT         CLI timeout in milliseconds (default: 10000)
  MOOD_GIT_TIMEOUT     Git operations timeout in milliseconds (default: 5000)
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

  const signals = await collectSignals(cwd, !args.noCache);
  const message = formatSignalsMessage(signals);

  const client = new BedrockRuntimeClient({ region: config.awsRegion });
  const controller = new AbortController();
  const timeoutMs = args.timeout || config.timeout;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const model = args.model || config.model;

  try {
    const payload = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: message
        }
      ]
    };

    const command = new InvokeModelWithResponseStreamCommand({
      modelId: model,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(payload)
    });

    const response = await client.send(command);

    if (response.body) {
      for await (const chunk of response.body) {
        if (chunk.chunk?.bytes) {
          const chunkStr = new TextDecoder().decode(chunk.chunk.bytes);
          const chunkData = JSON.parse(chunkStr);

          if (chunkData.type === 'content_block_delta' && chunkData.delta?.text) {
            process.stdout.write(chunkData.delta.text);
          }
        }
      }
      process.stdout.write('\n');
    }
  } catch (error: any) {
    if (error.name === 'AbortError') {
      process.stderr.write('mood: request timed out\n');
      process.exit(1);
    }
    if (error.message?.includes('credentials')) {
      process.stderr.write('mood: AWS credentials not configured\n');
      process.exit(1);
    }
    if (error.message?.includes('Access Denied')) {
      process.stderr.write('mood: AWS Bedrock access denied\n');
      process.exit(1);
    }
    process.stderr.write(`mood: ${error.message}\n`);
    process.exit(1);
  } finally {
    clearTimeout(timeout);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`mood: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
