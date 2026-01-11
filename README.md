# Compressed Shell MCP Server

An MCP (Model Context Protocol) server that executes shell commands with automatic output compression for verbose commands like npm, docker, apt, make, and more.

## The Problem

Terminal commands like `npm install`, `docker build`, `apt install`, etc. produce 50-200+ lines of output that:
- Pollutes the AI's context window
- Wastes tokens on progress bars, spinners, download speeds
- Buries important information (errors, counts) in noise

## Solution

This MCP server:
1. Runs the command and captures output
2. If output > 30 lines AND command is a verbose type, sends to Claude Haiku for compression
3. Returns compressed summary preserving: errors, exit codes, file paths, counts, timing

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
claude mcp add compressed-shell npx compressed-shell-mcp --scope user

# If installed locally
claude mcp add compressed-shell node /path/to/compressed-shell-mcp-server/index.js --scope user
```

## Usage

The server provides a `shell` tool that can be used instead of regular Bash commands:

### Parameters
- `command` (required): Shell command to execute
- `cwd` (optional): Working directory
- `compress` (optional): Force compression even for non-verbose commands

### Verbose Commands Auto-Detected

The following commands automatically trigger compression when output exceeds 30 lines:
- npm, yarn, pnpm
- pip
- apt, apt-get, brew
- docker, docker-compose
- make, cargo
- tsc, webpack, vite
- eslint, prettier

### What Gets Preserved

The compression intelligently preserves:
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
