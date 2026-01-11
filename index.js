#!/usr/bin/env node
/**
 * Compressed Shell MCP Server
 *
 * Provides shell command execution with automatic output compression
 * for verbose commands like npm, docker, apt, etc.
 *
 * Uses Claude Haiku to intelligently summarize long outputs.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { spawn, execSync } from "child_process";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const LOG_DIR = join(tmpdir(), "compressed-shell-logs");

const MIN_LINES = 30;
const TIMEOUT_SECONDS = 30;

// Commands that typically produce verbose output
const VERBOSE_COMMANDS = [
  "npm", "yarn", "pnpm", "pip", "apt", "apt-get", "brew",
  "docker", "docker-compose", "make", "cargo", "tsc",
  "webpack", "vite", "eslint", "prettier"
];

function isVerboseCommand(command) {
  const firstWord = command.trim().split(/\s+/)[0];
  return VERBOSE_COMMANDS.some(vc => firstWord === vc || firstWord.startsWith(vc + "-"));
}

async function compressWithHaiku(output, command, exitCode) {
  const prompt = `You are a terminal output compressor for an AI coding agent. Reduce verbose output while preserving critical information.

COMMAND: ${command}
EXIT CODE: ${exitCode}
ORIGINAL LINES: ${output.split('\n').length}

ALWAYS PRESERVE:
- ALL errors and warnings (error, ERR, warn, fail, FATAL)
- Exit code and final status
- File paths created/modified/deleted
- Counts (X packages installed, Y files compiled)
- Timing info (took Xs, duration)
- Version numbers

REMOVE:
- Progress bars/spinners
- Download speeds/percentages
- Repeated similar lines (show count instead)
- Verbose file listings
- ASCII art
- Redundant info logs

FORMAT: Bullet points, max 15 lines, start with SUCCESS/FAILED/WARNING

Compress this output:

${output}`;

  try {
    const result = execSync(
      `echo ${JSON.stringify(output)} | claude -p --model haiku --output-format text ${JSON.stringify(prompt)}`,
      {
        timeout: TIMEOUT_SECONDS * 1000,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024
      }
    );
    return result.trim();
  } catch (error) {
    // If compression fails, return original
    return null;
  }
}

async function executeCommand(command, cwd) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let stdout = "";
    let stderr = "";

    const proc = spawn("bash", ["-c", command], {
      cwd: cwd || process.cwd(),
      env: process.env,
    });

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      resolve({
        exitCode: code ?? 0,
        stdout,
        stderr,
        duration,
      });
    });

    proc.on("error", (error) => {
      resolve({
        exitCode: 1,
        stdout: "",
        stderr: error.message,
        duration: ((Date.now() - startTime) / 1000).toFixed(2),
      });
    });
  });
}

const server = new Server(
  {
    name: "compressed-shell",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "shell",
        description: `Execute shell commands with automatic output compression for verbose commands.

Commands like npm, docker, apt, make, cargo, tsc, etc. will have their output
automatically compressed by AI if it exceeds ${MIN_LINES} lines, preserving only
critical information (errors, counts, file paths, timing).

Use this instead of Bash for package installations, builds, and other verbose operations.`,
        inputSchema: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "The shell command to execute",
            },
            cwd: {
              type: "string",
              description: "Working directory (optional, defaults to current)",
            },
            compress: {
              type: "boolean",
              description: "Force compression even for non-verbose commands (default: auto-detect)",
            },
          },
          required: ["command"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "shell") {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const { command, cwd, compress } = request.params.arguments;

  // Execute the command
  const result = await executeCommand(command, cwd);

  // Combine stdout and stderr
  const fullOutput = result.stdout + (result.stderr ? "\n" + result.stderr : "");
  const lineCount = fullOutput.split('\n').length;

  // Determine if we should compress
  const shouldCompress = compress === true ||
    (compress !== false && isVerboseCommand(command) && lineCount >= MIN_LINES);

  let finalOutput;

  if (shouldCompress) {
    // Write full output to unique log file
    mkdirSync(LOG_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const logFile = join(LOG_DIR, `${timestamp}.log`);
    writeFileSync(logFile, fullOutput);

    const compressed = await compressWithHaiku(fullOutput, command, result.exitCode);
    if (compressed && compressed.length > 10) {
      finalOutput = `[Compressed from ${lineCount} lines | Exit: ${result.exitCode} | Duration: ${result.duration}s]\n[Full output: ${logFile}]\n\n${compressed}`;
    } else {
      // Compression failed, use original
      finalOutput = fullOutput;
    }
  } else {
    finalOutput = fullOutput;
  }

  return {
    content: [
      {
        type: "text",
        text: finalOutput,
      },
    ],
    isError: result.exitCode !== 0,
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Compressed Shell MCP Server running on stdio");
}

main().catch(console.error);
