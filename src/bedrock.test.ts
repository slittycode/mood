import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  generateMoodSummary,
  checkProviderStatus,
  formatStatusReport,
  type BedrockClientLike,
} from './bedrock.js';
import type { ProjectSignals } from './collect.js';

const SIGNALS: ProjectSignals = {
  branch: 'main',
  isClean: false,
  uncommittedCount: 3,
  lastCommitAge: '2 hours ago',
  lastCommitMessage: 'fix parser edge case',
  todoCount: 4,
  projectType: 'Node',
};

function streamResponse(chunks: string[]): AsyncIterable<{ chunk: { bytes: Uint8Array } }> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield {
          chunk: {
            bytes: new TextEncoder().encode(
              JSON.stringify({
                type: 'content_block_delta',
                delta: { text: chunk },
              }),
            ),
          },
        };
      }
    },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('generateMoodSummary', () => {
  it('supports deterministic local throttling simulation via env override', async () => {
    vi.stubEnv('MOOD_BEDROCK_TEST_ERROR', 'throttled');
    const send = vi.fn();

    const result = await generateMoodSummary({
      client: { send } as BedrockClientLike,
      model: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
      signals: SIGNALS,
      timeoutMs: 1000,
      systemPrompt: 'test prompt',
    });

    expect(send).not.toHaveBeenCalled();
    expect(result.source).toBe('local');
    expect(result.issue?.kind).toBe('throttled');
  });

  it('falls back to local summary when Bedrock model access is blocked', async () => {
    const send = vi.fn().mockRejectedValue(
      Object.assign(new Error('You do not have access to the model with the specified model ID.'), {
        name: 'ValidationException',
      }),
    );

    const result = await generateMoodSummary({
      client: { send } as BedrockClientLike,
      model: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
      signals: SIGNALS,
      timeoutMs: 1000,
      systemPrompt: 'test prompt',
    });

    expect(result.source).toBe('local');
    expect(result.issue?.kind).toBe('model_access_blocked');
    expect(result.issue?.signature).toContain('ValidationException');
    expect(result.text).toContain('main');
    expect(result.text).toContain('3 uncommitted changes');
  });

  it('falls back to local summary when Bedrock throttles requests', async () => {
    const send = vi.fn().mockRejectedValue(
      Object.assign(new Error('Rate exceeded for this model.'), {
        name: 'ThrottlingException',
      }),
    );

    const result = await generateMoodSummary({
      client: { send } as BedrockClientLike,
      model: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
      signals: SIGNALS,
      timeoutMs: 1000,
      systemPrompt: 'test prompt',
    });

    expect(result.source).toBe('local');
    expect(result.issue?.kind).toBe('throttled');
    expect(result.issue?.tips.join('\n')).toMatch(/retry|quota|region/i);
  });

  it('falls back to local summary on timeout', async () => {
    const send = vi.fn().mockRejectedValue(
      Object.assign(new Error('The operation was aborted'), {
        name: 'AbortError',
      }),
    );

    const result = await generateMoodSummary({
      client: { send } as BedrockClientLike,
      model: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
      signals: SIGNALS,
      timeoutMs: 10,
      systemPrompt: 'test prompt',
    });

    expect(result.source).toBe('local');
    expect(result.issue?.kind).toBe('timeout');
  });

  it('streams and returns Bedrock summary on success', async () => {
    const send = vi.fn().mockResolvedValue({
      body: streamResponse(['Ship ', 'shape']),
    });

    const result = await generateMoodSummary({
      client: { send } as BedrockClientLike,
      model: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
      signals: SIGNALS,
      timeoutMs: 1000,
      systemPrompt: 'test prompt',
    });

    expect(result.source).toBe('bedrock');
    expect(result.text).toBe('Ship shape');
    expect(result.issue).toBeUndefined();
  });
});

describe('provider status diagnostics', () => {
  it('supports deterministic local timeout simulation for status checks', async () => {
    vi.stubEnv('MOOD_BEDROCK_TEST_ERROR', 'timeout');
    const send = vi.fn();

    const status = await checkProviderStatus({
      client: { send } as BedrockClientLike,
      model: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
      region: 'us-east-1',
      profile: 'default',
      timeoutMs: 1000,
    });

    expect(send).not.toHaveBeenCalled();
    expect(status.readiness).toBe('degraded');
    expect(status.issue?.kind).toBe('timeout');
  });

  it('uses streaming invoke for status checks to match runtime call permissions', async () => {
    const send = vi.fn().mockResolvedValue({
      body: streamResponse(['ok']),
    });

    const status = await checkProviderStatus({
      client: { send } as BedrockClientLike,
      model: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
      region: 'us-east-1',
      profile: 'default',
      timeoutMs: 1000,
    });

    expect(status.readiness).toBe('ready');
    const [firstCommand] = send.mock.calls[0] ?? [];
    expect(firstCommand?.constructor?.name).toBe('InvokeModelWithResponseStreamCommand');
  });

  it('reports blocked readiness and prints remediation tips', async () => {
    const send = vi.fn().mockRejectedValue(
      Object.assign(new Error('User is not authorized to invoke model'), {
        name: 'AccessDeniedException',
      }),
    );

    const status = await checkProviderStatus({
      client: { send } as BedrockClientLike,
      model: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
      region: 'us-east-1',
      profile: 'default',
      timeoutMs: 1000,
    });

    expect(status.readiness).toBe('blocked');
    const rendered = formatStatusReport(status);
    expect(rendered).toContain('Provider readiness: blocked');
    expect(rendered).toContain('AWS profile: default');
    expect(rendered).toContain('AWS region: us-east-1');
    expect(rendered).toContain('AccessDeniedException');
    expect(rendered).toMatch(/model access|iam|permission/i);
  });

  it('treats Bedrock account access validation errors as blocked readiness', async () => {
    const send = vi.fn().mockRejectedValue(
      Object.assign(
        new Error(
          'Access to Bedrock models is not allowed for this account. Request a quota increase from support.',
        ),
        {
          name: 'ValidationException',
        },
      ),
    );

    const status = await checkProviderStatus({
      client: { send } as BedrockClientLike,
      model: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
      region: 'us-east-1',
      profile: 'default',
      timeoutMs: 1000,
    });

    expect(status.readiness).toBe('blocked');
    expect(status.issue?.kind).toBe('model_access_blocked');
    expect(status.issue?.tips.join('\n')).toMatch(/quota increase|model access/i);
  });
});
