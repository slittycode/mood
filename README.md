# mood

Project weather report — AI-powered git repository insights.

## Installation

```bash
npm install -g mood
```

## Prerequisites

- Node.js >= 22.0.0
- AWS Account with Bedrock access
- Claude 3.5 Sonnet model enabled in your AWS region
- AWS credentials configured

## AWS Setup

### 1. Configure AWS Credentials

Choose one of these methods:

**Environment Variables:**

```bash
export AWS_ACCESS_KEY_ID=your_access_key
export AWS_SECRET_ACCESS_KEY=your_secret_key
export AWS_REGION=us-east-1
```

**AWS Profile:**

```bash
export AWS_PROFILE=your_profile_name
```

**AWS CLI:**

```bash
aws configure
```

### 2. Enable Bedrock Model

In the AWS Console:

1. Navigate to Amazon Bedrock
2. Go to "Model access"
3. Request access for "Claude 3.5 Sonnet"
4. Wait for approval (usually instant)

### 3. IAM Permissions

Your AWS credentials need `bedrock:InvokeModelWithResponseStream` permission:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModelWithResponseStream"],
      "Resource": [
        "arn:aws:bedrock:*::foundation-model/anthropic.claude-3-5-sonnet-*"
      ]
    }
  ]
}
```

## Quick Start

1. Set your AWS credentials:

   ```bash
   export AWS_ACCESS_KEY_ID=your_access_key
   export AWS_SECRET_ACCESS_KEY=your_secret_key
   export AWS_REGION=us-east-1
   ```

2. Run mood in any git repository:

   ```bash
   cd my-project
   mood
   ```

   Example output:

   ```
   Things are pretty chill on main with a clean working tree. Last commit 
   2 hours ago was all about fixing that header alignment. You've got 3 
   TODOs floating around in this Node project—nothing too wild.
   ```

## Features

- **Git Integration**: Detects branch, commit age, uncommitted changes
- **TODO Tracking**: Scans for TODO, FIXME, and HACK markers
- **Project Detection**: Automatically identifies project type (Node, Rust, Python, Go, Deno, Bun, Java, Ruby, Elixir, PHP, Swift, Zig)
- **AI-Powered Summaries**: Uses Claude to generate human-readable project status
- **Graceful Fallbacks**: Automatically falls back to a local summary when Bedrock access/quota/timeout issues occur
- **Provider Diagnostics**: `mood --status` checks Bedrock readiness and prints remediation tips
- **Configurable**: Supports config files and environment variables
- **Performance**: Concurrent file scanning with configurable limits
- **Security**: Path traversal protection, symlink skipping, binary file detection

## Configuration

mood can be configured via:

1. Config file (`.moodrc`, `.moodrc.json`, `.moodrc.yaml`)
2. Environment variables
3. CLI flags

Priority: defaults < config file < environment variables < CLI flags

### Config File Example (JSON)

```json
{
  "model": "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
  "timeout": 10000,
  "gitTimeout": 5000,
  "awsRegion": "us-east-1"
}
```

### Config File Example (YAML)

```yaml
model: us.anthropic.claude-3-5-sonnet-20241022-v2:0
timeout: 10000
gitTimeout: 5000
awsRegion: us-east-1
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AWS_PROFILE` | AWS shared credentials profile | _(unset, uses default credential chain)_ |
| `AWS_REGION` | AWS region to use | `us-east-1` |
| `BEDROCK_MODEL_ID` | Bedrock model ID | `us.anthropic.claude-3-5-sonnet-20241022-v2:0` |
| `MOOD_TIMEOUT` | CLI timeout in milliseconds | `10000` |
| `MOOD_GIT_TIMEOUT` | Git operations timeout in milliseconds | `5000` |

### CLI Options

```bash
mood [options]

Options:
  --config <path>      Path to config file
  --model <name>       AWS Bedrock model ID
  --timeout <ms>       CLI timeout in milliseconds
  --git-timeout <ms>   Git operations timeout in milliseconds
  --no-cache           Disable TODO count caching
  --status             Show AWS Bedrock provider diagnostics
  --help, -h           Show help
  --version, -v        Show version
```

## Troubleshooting

Use `mood --status` to quickly check Bedrock readiness:

```bash
mood --status
```

Example output:

```text
Provider: AWS Bedrock
Provider readiness: blocked
AWS profile: default
AWS region: us-east-1
Model: us.anthropic.claude-3-5-sonnet-20241022-v2:0
Last provider error: AccessDeniedException: User is not authorized to invoke model
Remediation tips:
- Confirm your IAM identity can call bedrock:InvokeModelWithResponseStream.
- Verify you are using the intended AWS profile and region for Bedrock.
- Open Bedrock Console > Model access and ensure the model is approved in this region.
```

When `mood` cannot use Bedrock because access or quota is blocked, it now prints a local summary instead of failing hard.

Common error signatures and fixes:

- `AccessDeniedException: ... not authorized ...`
  - Fix: Add `bedrock:InvokeModelWithResponseStream` permission for the active IAM identity.
  - Fix: Confirm the right `AWS_PROFILE` and `AWS_REGION` are being used.
- `ValidationException: You do not have access to the model with the specified model ID.`
  - Fix: In Bedrock Console, request/enable model access for the selected model in the selected region.
  - Fix: Use a model ID that is enabled in that region.
- `ThrottlingException: Rate exceeded ...` (or quota exceeded messages)
  - Fix: Retry with backoff, or switch to a region/model with available quota.
  - Fix: Request a Bedrock quota increase if this persists.
- `AbortError: The operation was aborted` (timeout path)
  - Fix: Increase timeout with `--timeout` or `MOOD_TIMEOUT`.
  - Fix: Verify network/proxy connectivity to Bedrock endpoints.

Deterministic local verification (no live AWS failure required):

```bash
# Simulate throttling fallback
MOOD_BEDROCK_TEST_ERROR=throttled mood

# Simulate timeout fallback
MOOD_BEDROCK_TEST_ERROR=timeout mood

# Simulate model-access blocked status/fallback
MOOD_BEDROCK_TEST_ERROR=blocked mood --status
MOOD_BEDROCK_TEST_ERROR=blocked mood
```

Supported test values: `access_denied`, `blocked` (alias: `model_access_blocked`), `throttled`, `timeout`.
Unset `MOOD_BEDROCK_TEST_ERROR` after validation.

## How It Works

1. **Git Analysis** - Scans your git repository for:
   - Current branch and working tree status
   - Recent commit activity and age
   - Uncommitted changes count

2. **File Scanning** - Searches for TODO/FIXME/HACK markers:
   - Concurrent file processing for performance
   - Binary file detection and exclusion
   - Path traversal and symlink protection
   - Cached results for repeated runs

3. **Project Detection** - Identifies project types from:
   - `package.json` (Node.js)
   - `deno.json` (Deno)
   - `bun.lockb` (Bun)
   - `pom.xml` (Java/Maven)
   - `build.gradle` (Java/Gradle)
   - `Gemfile` (Ruby)
   - `mix.exs` (Elixir)
   - `composer.json` (PHP)
   - `Package.swift` (Swift)
   - `build.zig` (Zig)

4. **AI Generation** - Sends signals to AWS Bedrock:
   - Uses Claude 3.5 Sonnet via Bedrock
   - Streaming responses for immediate output
   - Configurable timeouts and error handling

## Security

- Path traversal protection prevents scanning outside the project directory
- Symlinks are skipped to prevent directory traversal attacks
- Binary files are detected and skipped (null byte check)
- File extensions filter for known binary types

## Performance

- Asynchronous file operations with `p-limit` concurrency control (default: 50 concurrent reads)
- 1000 file scan limit to prevent excessive resource usage
- 5 second default timeout for git operations (configurable)
- Binary file detection avoids reading large binary files

## Requirements

- Node.js >= 22.0.0
- Git repository
- AWS account with Bedrock access and Claude 3.5 Sonnet enabled

## License

MIT
