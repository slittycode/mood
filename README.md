# mood

A CLI tool that generates AI-powered "weather reports" for your software projects. It analyzes git status, TODO counts, and project structure to give you a quick sense of your codebase's current state.

## Installation

```bash
# Install globally
npm install -g mood

# Or run with npx
npx mood
```

## Quick Start

1. Set your Anthropic API key:
   ```bash
   export ANTHROPIC_API_KEY="your-api-key-here"
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
  "model": "claude-3-5-sonnet-20241022",
  "timeout": 10000,
  "gitTimeout": 5000,
  "maxFiles": 1000,
  "maxConcurrent": 50,
  "excludePatterns": ["*.test.ts", "*.spec.js"]
}
```

### Config File Example (YAML)

```yaml
model: claude-3-5-sonnet-20241022
timeout: 10000
gitTimeout: 5000
maxFiles: 1000
maxConcurrent: 50
excludePatterns:
  - "*.test.ts"
  - "*.spec.js"
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | **Required.** Your Anthropic API key | - |
| `MOOD_MODEL` | AI model to use | `claude-3-5-sonnet-20241022` |
| `MOOD_TIMEOUT` | CLI timeout in milliseconds | `10000` |
| `MOOD_GIT_TIMEOUT` | Git operations timeout in milliseconds | `5000` |

### CLI Flags

```bash
mood [options]

Options:
  --config <path>      Path to config file
  --model <name>       Anthropic model to use
  --timeout <ms>       CLI timeout in milliseconds
  --git-timeout <ms>   Git operations timeout in milliseconds
  --help, -h           Show help message
  --version, -v        Show version
```

## How It Works

1. **Git Analysis**: Checks current branch, working tree status, last commit age and message
2. **File Scanning**: Recursively scans up to 1000 files for TODO/FIXME/HACK markers
3. **Project Detection**: Identifies project type based on configuration files
4. **AI Summary**: Sends collected signals to Claude for a natural language summary

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
- Anthropic API key

## License

MIT
