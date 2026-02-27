import {
  InvokeModelWithResponseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { formatSignalsMessage, type ProjectSignals } from './collect.js';
import { MAX_TOKENS } from './constants.js';

export interface BedrockClientLike {
  send(command: unknown, options?: { abortSignal?: AbortSignal }): Promise<unknown>;
}

export type BedrockErrorKind =
  | 'access_denied'
  | 'model_access_blocked'
  | 'throttled'
  | 'timeout'
  | 'credentials'
  | 'unknown';

export interface BedrockIssue {
  kind: BedrockErrorKind;
  signature: string;
  message: string;
  tips: string[];
}

export interface MoodSummaryResult {
  source: 'bedrock' | 'local';
  text: string;
  issue?: BedrockIssue;
}

export interface GenerateMoodSummaryInput {
  client: BedrockClientLike;
  model: string;
  signals: ProjectSignals;
  timeoutMs: number;
  systemPrompt: string;
}

export interface ProviderStatusInput {
  client: BedrockClientLike;
  model: string;
  region: string;
  profile: string;
  timeoutMs: number;
}

export interface ProviderStatus {
  provider: 'AWS Bedrock';
  readiness: 'ready' | 'blocked' | 'degraded' | 'unknown';
  model: string;
  region: string;
  profile: string;
  issue?: BedrockIssue;
}

interface BedrockStreamChunk {
  chunk?: {
    bytes?: Uint8Array;
  };
}

const STATUS_PROMPT = 'Reply with "ok".';
const STATUS_SYSTEM_PROMPT = 'You are a health check. Reply in one short word.';

const FALLBACK_ELIGIBLE_KINDS = new Set<BedrockErrorKind>([
  'access_denied',
  'model_access_blocked',
  'throttled',
  'timeout',
]);

type InjectedFailureMode =
  | 'access_denied'
  | 'model_access_blocked'
  | 'blocked'
  | 'throttled'
  | 'timeout';

function getInjectedFailureMode(): InjectedFailureMode | null {
  const value = process.env.MOOD_BEDROCK_TEST_ERROR?.trim().toLowerCase();
  if (
    value === 'access_denied' ||
    value === 'model_access_blocked' ||
    value === 'blocked' ||
    value === 'throttled' ||
    value === 'timeout'
  ) {
    return value;
  }
  return null;
}

function maybeInjectBedrockFailure(): void {
  const mode = getInjectedFailureMode();
  if (!mode) {
    return;
  }

  if (mode === 'access_denied') {
    throw Object.assign(new Error('User is not authorized to invoke model'), {
      name: 'AccessDeniedException',
    });
  }

  if (mode === 'model_access_blocked' || mode === 'blocked') {
    throw Object.assign(
      new Error('You do not have access to the model with the specified model ID.'),
      {
        name: 'ValidationException',
      },
    );
  }

  if (mode === 'throttled') {
    throw Object.assign(new Error('Rate exceeded for this model.'), {
      name: 'ThrottlingException',
    });
  }

  throw Object.assign(new Error('The operation was aborted'), {
    name: 'AbortError',
  });
}

function toErrorRecord(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: error.message || 'Unknown error',
    };
  }
  if (typeof error === 'object' && error !== null) {
    const candidate = error as { name?: unknown; message?: unknown };
    return {
      name: typeof candidate.name === 'string' ? candidate.name : 'Error',
      message:
        typeof candidate.message === 'string'
          ? candidate.message
          : JSON.stringify(candidate),
    };
  }
  return {
    name: 'Error',
    message: String(error),
  };
}

function getTips(kind: BedrockErrorKind): string[] {
  switch (kind) {
    case 'access_denied':
      return [
        'Confirm your IAM identity can call bedrock:InvokeModelWithResponseStream.',
        'Verify you are using the intended AWS profile and region for Bedrock.',
        'Open Bedrock Console > Model access and ensure the model is approved in this region.',
      ];
    case 'model_access_blocked':
      return [
        'Open Bedrock Console > Model access and request access for this model in the current region.',
        'Use a model ID that is enabled for your account and region.',
        'If AWS asks for a quota increase, submit the Bedrock service-limit request link from the error message.',
        'If access was recently granted, wait a minute and retry.',
      ];
    case 'throttled':
      return [
        'Retry after a short delay (exponential backoff helps).',
        'Try a different AWS region or model with available quota.',
        'Request a Bedrock quota increase if throttling persists.',
      ];
    case 'timeout':
      return [
        'Increase timeout via --timeout or MOOD_TIMEOUT.',
        'Check network connectivity and proxy/firewall settings.',
        'Retry when Bedrock service latency is lower.',
      ];
    case 'credentials':
      return [
        'Run aws configure or export AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY.',
        'If you use profiles, set AWS_PROFILE to the intended profile name.',
        'Confirm temporary credentials have not expired.',
      ];
    default:
      return [
        'Retry the command once to rule out transient errors.',
        'Validate AWS credentials, region, and model ID.',
      ];
  }
}

export function classifyBedrockIssue(error: unknown): BedrockIssue {
  const details = toErrorRecord(error);
  const lowerMessage = details.message.toLowerCase();

  let kind: BedrockErrorKind = 'unknown';

  if (
    details.name === 'ValidationException' &&
    (
      lowerMessage.includes('access to the model') ||
      lowerMessage.includes("don't have access to the model") ||
      lowerMessage.includes('do not have access to the model') ||
      lowerMessage.includes('model access') ||
      lowerMessage.includes('is not enabled') ||
      lowerMessage.includes('access to bedrock models is not allowed for this account') ||
      lowerMessage.includes('request a quota increase')
    )
  ) {
    kind = 'model_access_blocked';
  } else if (
    details.name === 'ThrottlingException' ||
    details.name === 'ServiceQuotaExceededException' ||
    lowerMessage.includes('throttl') ||
    lowerMessage.includes('rate exceeded') ||
    lowerMessage.includes('too many requests') ||
    lowerMessage.includes('quota exceeded')
  ) {
    kind = 'throttled';
  } else if (
    details.name === 'AbortError' ||
    lowerMessage.includes('timed out') ||
    lowerMessage.includes('timeout') ||
    lowerMessage.includes('aborted')
  ) {
    kind = 'timeout';
  } else if (
    details.name === 'AccessDeniedException' ||
    lowerMessage.includes('access denied') ||
    lowerMessage.includes('not authorized')
  ) {
    kind = 'access_denied';
  } else if (
    details.name === 'CredentialsProviderError' ||
    lowerMessage.includes('credential') ||
    lowerMessage.includes('security token included in the request is invalid')
  ) {
    kind = 'credentials';
  }

  return {
    kind,
    signature: `${details.name}: ${details.message}`,
    message: details.message,
    tips: getTips(kind),
  };
}

function createPayload(systemPrompt: string, userPrompt: string): string {
  return JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: userPrompt,
      },
    ],
  });
}

function extractDeltaText(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { type?: string; delta?: { text?: string } };
    if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
      return parsed.delta.text;
    }
    return '';
  } catch {
    return '';
  }
}

function withTimeout(signal: AbortController, timeoutMs: number): NodeJS.Timeout {
  return setTimeout(() => signal.abort(), timeoutMs);
}

async function invokeBedrockStream(
  client: BedrockClientLike,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  timeoutMs: number,
): Promise<string> {
  maybeInjectBedrockFailure();
  const command = new InvokeModelWithResponseStreamCommand({
    modelId: model,
    contentType: 'application/json',
    accept: 'application/json',
    body: createPayload(systemPrompt, userPrompt),
  });

  const abortController = new AbortController();
  const timeout = withTimeout(abortController, timeoutMs);

  try {
    const response = await client.send(command, { abortSignal: abortController.signal });
    const body = (response as { body?: AsyncIterable<BedrockStreamChunk> }).body;

    if (!body) {
      return '';
    }

    let output = '';
    for await (const part of body) {
      const bytes = part.chunk?.bytes;
      if (!bytes) {
        continue;
      }
      output += extractDeltaText(new TextDecoder().decode(bytes));
    }

    return output.trim();
  } finally {
    clearTimeout(timeout);
  }
}

async function invokeBedrockPing(
  client: BedrockClientLike,
  model: string,
  timeoutMs: number,
): Promise<void> {
  maybeInjectBedrockFailure();
  const command = new InvokeModelWithResponseStreamCommand({
    modelId: model,
    contentType: 'application/json',
    accept: 'application/json',
    body: createPayload(STATUS_SYSTEM_PROMPT, STATUS_PROMPT),
  });

  const abortController = new AbortController();
  const timeout = withTimeout(abortController, timeoutMs);

  try {
    const response = await client.send(command, { abortSignal: abortController.signal });
    const body = (response as { body?: AsyncIterable<BedrockStreamChunk> }).body;
    if (!body) {
      return;
    }
    for await (const _part of body) {
      break;
    }
  } finally {
    clearTimeout(timeout);
  }
}

export function createLocalFallbackSummary(signals: ProjectSignals): string {
  const statusLine =
    signals.branch === null
      ? 'Git status is currently unavailable.'
      : signals.isClean
        ? `Branch "${signals.branch}" has a clean working tree.`
        : `Branch "${signals.branch}" has ${signals.uncommittedCount ?? 0} uncommitted change${signals.uncommittedCount === 1 ? '' : 's'}.`;

  const commitLine =
    signals.lastCommitAge && signals.lastCommitMessage
      ? `Last commit ${signals.lastCommitAge}: "${signals.lastCommitMessage}".`
      : 'Recent commit details are unavailable.';

  const todoLine =
    signals.todoCount === null
      ? `${signals.projectType} project with TODO scan unavailable.`
      : `${signals.todoCount} TODO/FIXME/HACK marker${signals.todoCount === 1 ? '' : 's'} in this ${signals.projectType} project.`;

  return `${statusLine} ${commitLine} ${todoLine}`;
}

export async function generateMoodSummary(input: GenerateMoodSummaryInput): Promise<MoodSummaryResult> {
  const userPrompt = formatSignalsMessage(input.signals);

  try {
    const text = await invokeBedrockStream(
      input.client,
      input.model,
      input.systemPrompt,
      userPrompt,
      input.timeoutMs,
    );
    if (!text) {
      return {
        source: 'local',
        text: createLocalFallbackSummary(input.signals),
        issue: {
          kind: 'unknown',
          signature: 'EmptyBedrockResponse: Bedrock returned no text content',
          message: 'Bedrock returned no text content',
          tips: getTips('unknown'),
        },
      };
    }
    return {
      source: 'bedrock',
      text,
    };
  } catch (error) {
    const issue = classifyBedrockIssue(error);
    if (FALLBACK_ELIGIBLE_KINDS.has(issue.kind)) {
      return {
        source: 'local',
        text: createLocalFallbackSummary(input.signals),
        issue,
      };
    }
    throw error;
  }
}

function mapReadiness(kind: BedrockErrorKind): ProviderStatus['readiness'] {
  switch (kind) {
    case 'access_denied':
    case 'model_access_blocked':
    case 'credentials':
      return 'blocked';
    case 'throttled':
    case 'timeout':
      return 'degraded';
    default:
      return 'unknown';
  }
}

export async function checkProviderStatus(input: ProviderStatusInput): Promise<ProviderStatus> {
  try {
    await invokeBedrockPing(input.client, input.model, input.timeoutMs);
    return {
      provider: 'AWS Bedrock',
      readiness: 'ready',
      model: input.model,
      region: input.region,
      profile: input.profile,
    };
  } catch (error) {
    const issue = classifyBedrockIssue(error);
    return {
      provider: 'AWS Bedrock',
      readiness: mapReadiness(issue.kind),
      model: input.model,
      region: input.region,
      profile: input.profile,
      issue,
    };
  }
}

export function formatStatusReport(status: ProviderStatus): string {
  const lines = [
    `Provider: ${status.provider}`,
    `Provider readiness: ${status.readiness}`,
    `AWS profile: ${status.profile}`,
    `AWS region: ${status.region}`,
    `Model: ${status.model}`,
  ];

  if (status.issue) {
    lines.push(`Last provider error: ${status.issue.signature}`);
    lines.push('Remediation tips:');
    for (const tip of status.issue.tips) {
      lines.push(`- ${tip}`);
    }
  } else {
    lines.push('Remediation tips:');
    lines.push('- No action needed. Bedrock is reachable from this environment.');
  }

  return lines.join('\n');
}
