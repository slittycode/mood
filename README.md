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
  --help, -h           Show help
  --version, -v        Show version
```

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
