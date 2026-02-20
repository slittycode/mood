import { simpleGit } from 'simple-git';
import Anthropic from '@anthropic-ai/sdk';
import { collectSignals, formatSignalsMessage } from './collect.js';

const SYSTEM_PROMPT =
  'You are a terse, observant assistant. Describe the current state of a software ' +
  'project in 2-3 casual sentences based on signals provided. Write like a weatherman ' +
  'giving a quick forecast — direct, vivid, no bullet points, no headers, no technical ' +
  'jargon. Capture the feeling of the project, not a status report.';

async function main(): Promise<void> {
  const cwd = process.cwd();

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

  const signals = await collectSignals(cwd);
  const message = formatSignalsMessage(signals);

  const client = new Anthropic({ apiKey });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const stream = client.messages.stream(
      {
        model: 'claude-opus-4-6',
        max_tokens: 120,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: message }],
      },
      { signal: controller.signal },
    );

    for await (const text of stream.textStream) {
      process.stdout.write(text);
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
