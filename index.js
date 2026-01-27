#!/usr/bin/env node
/**
 * Compressed Shell MCP Server
 *
 * Provides shell command execution with automatic output compression
 * for verbose commands like npm, docker, apt, etc.
 *
 * Permission model:
 * - Safe commands (ls, pwd, cat, etc.) → auto-allowed
 * - Commands in project's .claude/settings.local.json → allowed
 * - Other commands → denied with message to use allow_command tool
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { spawn, execSync } from "child_process";
import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  existsSync,
  unlinkSync,
  appendFileSync,
} from "fs";
import { join } from "path";
import { tmpdir, homedir } from "os";

const LOG_DIR = join(tmpdir(), "compressed-shell-logs");
const DEBUG_LOG = join(tmpdir(), "compressed-shell-debug.log");
const ALLOW_ONCE_FILE = join(tmpdir(), "compressed-shell-allow-once.json");

function debugLog(msg) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}\n`;
  appendFileSync(DEBUG_LOG, line);
  console.error(msg);
}

// Find claude CLI - check common locations since MCP doesn't inherit shell config
function findClaudeCli() {
  const home = process.env.HOME || homedir();
  const locations = [
    join(home, ".local", "share", "claude", "versions", "2.0.64"),
    join(home, ".local", "bin", "claude"),
    "/usr/local/bin/claude",
  ];
  for (const loc of locations) {
    if (existsSync(loc)) return loc;
  }
  return "claude";
}

const CLAUDE_CLI = findClaudeCli();
const MIN_LINES = 30;
const TIMEOUT_SECONDS = 30;

// Safe commands that should be auto-allowed (read-only, non-destructive)
const SAFE_COMMANDS = [
  "cd",
  "ls",
  "pwd",
  "tree",
  "find",
  "locate",
  "which",
  "whereis",
  "type",
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "file",
  "stat",
  "wc",
  "diff",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "ag",
  "awk",
  "sed",
  "sort",
  "uniq",
  "cut",
  "tr",
  "whoami",
  "hostname",
  "uname",
  "date",
  "uptime",
  "env",
  "printenv",
  "id",
  "git status",
  "git log",
  "git branch",
  "git diff",
  "git show",
  "git remote",
  "git config --get",
  "git config --list",
  "git rev-parse",
  "git describe",
  "ps",
  "top",
  "htop",
  "df",
  "du",
  "free",
  "lsof",
  "ping",
  "curl",
  "wget",
  "nslookup",
  "dig",
  "host",
  "node --version",
  "npm --version",
  "pnpm --version",
  "yarn --version",
  "python --version",
  "python3 --version",
  "pip --version",
  "go version",
  "rustc --version",
  "cargo --version",
  "java -version",
  "javac -version",
];

// Commands that typically produce verbose output
const VERBOSE_COMMANDS = [
  "npm",
  "yarn",
  "pnpm",
  "pip",
  "apt",
  "apt-get",
  "brew",
  "docker",
  "docker-compose",
  "make",
  "cargo",
  "tsc",
  "webpack",
  "vite",
  "eslint",
  "prettier",
  "npx",
];

function isSafeCommand(command) {
  const firstWord = command.trim().split(/\s+/)[0];
  for (const safe of SAFE_COMMANDS) {
    if (command === safe || command.startsWith(safe + " ")) return true;
    if (firstWord === safe) return true;
  }
  return false;
}

function isVerboseCommand(command) {
  const commands = command.split(/\s*(?:&&|\|\||;|\|)\s*/);
  for (const cmd of commands) {
    const firstWord = cmd.trim().split(/\s+/)[0];
    if (
      VERBOSE_COMMANDS.some(
        (vc) => firstWord === vc || firstWord.startsWith(vc + "-"),
      )
    ) {
      return true;
    }
  }
  return false;
}

// Allow-once mechanism: check and consume one-time permissions
function isAllowedOnce(command) {
  if (!existsSync(ALLOW_ONCE_FILE)) return false;

  try {
    const data = JSON.parse(readFileSync(ALLOW_ONCE_FILE, "utf-8"));
    const commands = data.commands || [];
    const index = commands.indexOf(command);

    if (index !== -1) {
      // Found! Remove it (consume the permission)
      commands.splice(index, 1);
      writeFileSync(ALLOW_ONCE_FILE, JSON.stringify({ commands }));
      debugLog(`Allow-once consumed for: ${command}`);
      return true;
    }
  } catch (e) {}
  return false;
}

function addAllowOnce(command) {
  let data = { commands: [] };

  if (existsSync(ALLOW_ONCE_FILE)) {
    try {
      data = JSON.parse(readFileSync(ALLOW_ONCE_FILE, "utf-8"));
      if (!data.commands) data.commands = [];
    } catch (e) {}
  }

  if (!data.commands.includes(command)) {
    data.commands.push(command);
    writeFileSync(ALLOW_ONCE_FILE, JSON.stringify(data));
  }

  return true;
}

// Check if command is allowed in project settings
// Note: Only checks command-specific patterns, NOT the blanket "mcp__compressed-shell__shell" permission
// (the blanket permission is for Claude Code, our internal logic needs specific patterns)
function getCommandPrefix(command) {
  const words = command.trim().split(/\s+/);
  // Use first two words for subcommand (e.g., "npm install", "docker build")
  // Fall back to first word only if no subcommand
  return words.length >= 2 ? `${words[0]} ${words[1]}` : words[0];
}

function isCommandAllowed(command, cwd) {
  const projectDir = cwd || process.cwd();
  const settingsFile = join(projectDir, ".claude", "settings.local.json");

  debugLog(`isCommandAllowed: checking "${command}" in ${settingsFile}`);

  if (!existsSync(settingsFile)) {
    debugLog(`Settings file not found: ${settingsFile}`);
    return false;
  }

  try {
    const settings = JSON.parse(readFileSync(settingsFile, "utf-8"));
    const allowList = settings?.permissions?.allow || [];
    const firstWord = command.trim().split(/\s+/)[0];
    const subcommandPrefix = getCommandPrefix(command);

    debugLog(`Checking ${allowList.length} rules for command="${command}"`);

    for (const rule of allowList) {
      // Only match command-specific patterns, not blanket permissions
      if (rule === `mcp__compressed-shell__shell(command:${command})`)
        return true;
      // Match subcommand pattern (e.g., "npm install *")
      if (rule === `mcp__compressed-shell__shell(command:${subcommandPrefix} *)`)
        return true;
      // Also still match first-word-only pattern for backwards compatibility
      if (rule === `mcp__compressed-shell__shell(command:${firstWord} *)`)
        return true;
      // DO NOT match 'mcp__compressed-shell__shell' - that's for Claude Code level

      // Check existing Bash permissions (e.g., "Bash(npm install:*)")
      // This honors permissions already granted at Claude Code level
      const bashMatch = rule.match(/^Bash\((.+?):\*\)$/);
      if (bashMatch) {
        const bashPrefix = bashMatch[1];
        debugLog(`Bash rule found: "${rule}" -> prefix="${bashPrefix}"`);
        if (command === bashPrefix || command.startsWith(bashPrefix + " ")) {
          debugLog(`MATCH! command="${command}" starts with "${bashPrefix} "`);
          return true;
        }
      }
    }
    debugLog(`No matching rules found`);
  } catch (e) {
    debugLog(`Error reading settings: ${e.message}`);
  }
  return false;
}

// Add command pattern to project's settings.local.json
function addToProjectSettings(commandPrefix, cwd) {
  const projectDir = cwd || process.cwd();
  const settingsDir = join(projectDir, ".claude");
  const settingsFile = join(settingsDir, "settings.local.json");

  const permission = `mcp__compressed-shell__shell(command:${commandPrefix} *)`;

  mkdirSync(settingsDir, { recursive: true });

  let settings = { permissions: { allow: [] } };
  if (existsSync(settingsFile)) {
    try {
      settings = JSON.parse(readFileSync(settingsFile, "utf-8"));
      if (!settings.permissions) settings.permissions = { allow: [] };
      if (!settings.permissions.allow) settings.permissions.allow = [];
    } catch (e) {}
  }

  if (settings.permissions.allow.includes(permission)) {
    return { alreadyExists: true, permission };
  }

  settings.permissions.allow.push(permission);
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
  return { added: true, permission };
}

async function compressWithHaiku(output, command, exitCode) {
  const prompt = `You are a terminal output compressor for an AI coding agent. Reduce verbose output while preserving critical information.

COMMAND: ${command}
EXIT CODE: ${exitCode}
ORIGINAL LINES: ${output.split("\n").length}

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

  const timestamp = Date.now();
  const promptFile = join(LOG_DIR, `prompt-${timestamp}.txt`);

  try {
    mkdirSync(LOG_DIR, { recursive: true });
    writeFileSync(promptFile, prompt);

    const result = execSync(
      `cat "${promptFile}" | ${CLAUDE_CLI} -p --model haiku --output-format text`,
      {
        timeout: TIMEOUT_SECONDS * 1000,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    try {
      unlinkSync(promptFile);
    } catch {}
    return result.trim();
  } catch (error) {
    try {
      unlinkSync(promptFile);
    } catch {}
    console.error(`[compressed-shell] Compression failed: ${error.message}`);
    return { error: error.message };
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
      resolve({
        exitCode: code ?? 0,
        stdout,
        stderr,
        duration: ((Date.now() - startTime) / 1000).toFixed(2),
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
  { name: "compressed-shell", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "shell",
        description: `Execute shell commands with automatic output compression.

Safe commands (ls, pwd, cat, git status, etc.) are auto-allowed.
Other commands must be allowed via the allow_command tool first.

Commands like npm, docker, apt, etc. will have output compressed if >30 lines.`,
        inputSchema: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "The shell command to execute",
            },
            cwd: {
              type: "string",
              description: "Working directory (optional)",
            },
            compress: {
              type: "boolean",
              description: "Force compression (default: auto-detect)",
            },
          },
          required: ["command"],
        },
      },
      {
        name: "allow_command",
        description: `Add a command PREFIX to the project's allowed list (.claude/settings.local.json).
⚠️ Use when user wants to ALWAYS allow a type of command.

Example: allow_command(command_prefix: "npm install") allows ALL "npm install" commands permanently.
Example: allow_command(command_prefix: "npm run") allows ALL "npm run" commands permanently.`,
        inputSchema: {
          type: "object",
          properties: {
            command_prefix: {
              type: "string",
              description:
                "The command prefix to allow (e.g., 'npm', 'pnpm', 'docker')",
            },
            cwd: {
              type: "string",
              description: "Project directory (optional, defaults to current)",
            },
          },
          required: ["command_prefix"],
        },
      },
      {
        name: "allow_once",
        description: `Allow a specific command to run ONCE. The permission is consumed after execution.
Use when user wants to run a command just this one time without permanent permission.

Example: allow_once(command: "npm install lodash") allows that exact command once.`,
        inputSchema: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "The exact command to allow once",
            },
          },
          required: ["command"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;

  // Handle allow_once tool
  if (toolName === "allow_once") {
    const { command } = request.params.arguments;

    if (!command || command.trim() === "") {
      return {
        content: [{ type: "text", text: "Error: command is required" }],
        isError: true,
      };
    }

    addAllowOnce(command.trim());
    debugLog(`Added allow-once for: ${command}`);

    return {
      content: [
        {
          type: "text",
          text: `Allowed once: "${command}"\n\nYou can now retry the command. This permission will be consumed after execution.`,
        },
      ],
    };
  }

  // Handle allow_command tool
  if (toolName === "allow_command") {
    const { command_prefix, cwd } = request.params.arguments;

    if (!command_prefix || command_prefix.trim() === "") {
      return {
        content: [{ type: "text", text: "Error: command_prefix is required" }],
        isError: true,
      };
    }

    const result = addToProjectSettings(command_prefix.trim(), cwd);

    if (result.alreadyExists) {
      return {
        content: [
          {
            type: "text",
            text: `Permission already exists: ${result.permission}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `⚠️ PERMANENTLY ALLOWED: ${result.permission}\n\nAll "${command_prefix}" commands are now allowed in this project.\nYou can now retry the command.`,
        },
      ],
    };
  }

  // Handle shell tool
  if (toolName !== "shell") {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  const { command, cwd, compress } = request.params.arguments;

  // Permission check
  const safe = isSafeCommand(command);
  const allowedOnce = isAllowedOnce(command); // This also consumes the permission if found
  const allowedAlways = isCommandAllowed(command, cwd);
  debugLog(
    `Permission check: command="${command}" safe=${safe} allowedOnce=${allowedOnce} allowedAlways=${allowedAlways}`,
  );

  if (!safe && !allowedOnce && !allowedAlways) {
    const subcommandPrefix = getCommandPrefix(command);
    debugLog(`DENIED - returning error for: ${command}`);
    return {
      content: [
        {
          type: "text",
          text: `Command not allowed: "${command}"

Ask the user if they want to allow this command. DEFAULT to "once" unless user explicitly says "always".

To allow ONCE (recommended):
  allow_once(command: "${command}")

To allow ALWAYS (⚠️ will permanently allow ALL "${subcommandPrefix}" commands in this project):
  allow_command(command_prefix: "${subcommandPrefix}")

Then retry the original command.`,
        },
      ],
      isError: true,
    };
  }
  debugLog(`ALLOWED - executing: ${command}`);

  // Execute the command
  const result = await executeCommand(command, cwd);
  const fullOutput =
    result.stdout + (result.stderr ? "\n" + result.stderr : "");
  const lineCount = fullOutput.split("\n").length;

  const shouldCompress =
    compress === true ||
    (compress !== false && isVerboseCommand(command) && lineCount >= MIN_LINES);

  let finalOutput;

  if (shouldCompress) {
    mkdirSync(LOG_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const logFile = join(LOG_DIR, `${timestamp}.log`);
    writeFileSync(logFile, fullOutput);

    const compressed = await compressWithHaiku(
      fullOutput,
      command,
      result.exitCode,
    );
    if (typeof compressed === "string" && compressed.length > 10) {
      finalOutput = `[Compressed from ${lineCount} lines | Exit: ${result.exitCode} | Duration: ${result.duration}s]\n[Full output: ${logFile}]\n\n${compressed}`;
    } else if (compressed?.error) {
      finalOutput = `[Compression failed: ${compressed.error}]\n[Full output: ${logFile}]\n\n${fullOutput}`;
    } else {
      finalOutput = fullOutput;
    }
  } else {
    finalOutput = fullOutput;
  }

  return {
    content: [{ type: "text", text: finalOutput }],
    isError: result.exitCode !== 0,
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Compressed Shell MCP Server running on stdio");
}

main().catch(console.error);
