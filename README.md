# Compressed Shell MCP Server

An MCP (Model Context Protocol) server that executes shell commands with automatic output compression for verbose commands like npm, docker, apt, make, and more.

## Features

- **Output Compression**: Automatically compresses verbose output (50-200+ lines) to ~15 lines using Claude Haiku
- **Permission System**: Granular command permissions with safe commands auto-allowed
- **Subcommand Permissions**: Allow specific subcommands like `npm install` without allowing all npm commands
- **One-time Permissions**: Allow commands once without permanent permission
- **Bash Permission Integration**: Honors existing Bash permissions from Claude Code settings

## The Problem

Terminal commands like `npm install`, `docker build`, `apt install`, etc. produce 50-200+ lines of output that:
- Pollutes the AI's context window
- Wastes tokens on progress bars, spinners, download speeds
- Buries important information (errors, counts) in noise

## Solution

This MCP server:
1. Checks command permissions (safe commands auto-allowed)
2. Runs the command and captures output
3. If output > 30 lines AND command is verbose type, compresses with Claude Haiku
4. Returns compressed summary preserving: errors, exit codes, file paths, counts, timing

## Results

| Metric | Before (Bash) | After (compressed-shell) |
|--------|---------------|--------------------------|
| docker-compose build | 143 lines | 10 lines |
| Preserved | Everything | Errors, status, images, timing |
| Removed | Progress, hashes, layers | N/A |

## Installation

### 1. Install the package

```bash
npm install -g compressed-shell-mcp-server
```

Or clone and install locally:

```bash
git clone https://github.com/daliovic/compressed-shell-mcp-server.git
cd compressed-shell-mcp-server
npm install
```

### 2. Add to Claude Code

```bash
# If installed globally
claude mcp add compressed-shell -- npx compressed-shell-mcp-server --scope user

# If installed locally
claude mcp add compressed-shell -- node /path/to/compressed-shell-mcp-server/index.js --scope user
```

## Tools

### `shell` - Execute commands

Execute shell commands with automatic compression.

**Parameters:**
- `command` (required): Shell command to execute
- `cwd` (optional): Working directory
- `compress` (optional): Force compression even for non-verbose commands

### `allow_once` - One-time permission

Allow a specific command to run once. Permission is consumed after execution.

```
allow_once(command: "npm install lodash")
```

### `allow_command` - Permanent permission

Add a command prefix to the project's allowed list (`.claude/settings.local.json`).

```
allow_command(command_prefix: "npm install")  # Allows all "npm install" commands
allow_command(command_prefix: "npm run")      # Allows all "npm run" commands
```

## Permission System

### Safe Commands (Auto-Allowed)

These read-only commands run without prompting:
- File operations: `ls`, `pwd`, `cat`, `head`, `tail`, `find`, `tree`
- Text processing: `grep`, `awk`, `sed`, `sort`, `uniq`, `wc`
- Git (read-only): `git status`, `git log`, `git branch`, `git diff`
- System info: `whoami`, `hostname`, `uname`, `date`, `env`
- Network (read-only): `ping`, `curl`, `wget`, `dig`
- Version checks: `node --version`, `npm --version`, etc.

### Permission Flow

1. **Safe command?** → Auto-allowed
2. **One-time permission?** → Allowed (permission consumed)
3. **In project settings?** → Allowed
4. **Has matching Bash permission?** → Allowed (e.g., `Bash(npm install:*)`)
5. **Otherwise** → Denied with prompt to allow

### Bash Permission Integration

If you have existing Bash permissions in your settings:
```json
{
  "permissions": {
    "allow": ["Bash(npm install:*)", "Bash(pnpm exec tsc:*)"]
  }
}
```

These are automatically honored - no double prompting!

## Compression

### Verbose Commands Auto-Detected

Commands that trigger compression when output exceeds 30 lines:
- Package managers: `npm`, `yarn`, `pnpm`, `pip`
- System packages: `apt`, `apt-get`, `brew`
- Containers: `docker`, `docker-compose`
- Build tools: `make`, `cargo`, `tsc`, `webpack`, `vite`
- Linters: `eslint`, `prettier`

### What Gets Preserved

- ALL errors and warnings
- Exit codes and final status
- File paths created/modified/deleted
- Counts (X packages installed, Y files compiled)
- Timing information
- Version numbers

### What Gets Removed

- Progress bars and spinners
- Download speeds/percentages
- Repeated similar lines (shows count instead)
- Verbose file listings
- ASCII art
- Redundant info logs

## Example

### Before (143 lines):
```
[+] Building 45.2s (18/18) FINISHED
 => [internal] load build definition from Dockerfile
 => => transferring dockerfile: 2.34kB
 => [internal] load .dockerignore
 => => transferring context: 2B
 => [internal] load metadata for docker.io/library/node:18
 => [auth] library/node:pull token for registry-1.docker.io
...140 more lines...
```

### After (10 lines):
```
[Compressed from 143 lines | Exit: 0 | Duration: 45.23s]

SUCCESS: Docker build completed
- Built image: myapp:latest
- Base image: node:18
- 18 layers processed
- Final size: 1.2GB
- Duration: 45.2s
```

## Project Structure

```
compressed-shell-mcp-server/
├── index.js              # Entry point
├── lib/
│   ├── constants.js      # Config, safe/verbose command lists
│   ├── permissions.js    # Permission checking logic
│   ├── compression.js    # Haiku compression
│   └── execution.js      # Command execution
└── tools/
    ├── shell.js          # Shell tool handler
    ├── allow-once.js     # One-time permission handler
    └── allow-command.js  # Permanent permission handler
```

## Requirements

- Node.js 14+
- Claude CLI installed (for compression)
- Anthropic API key configured

## License

MIT

## Author

Created by Daliovic

## Contributing

Issues and pull requests welcome at https://github.com/daliovic/compressed-shell-mcp-server
