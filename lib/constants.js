import { join } from "path";
import { tmpdir, homedir } from "os";
import { existsSync, appendFileSync } from "fs";

export const LOG_DIR = join(tmpdir(), "compressed-shell-logs");
export const DEBUG_LOG = join(tmpdir(), "compressed-shell-debug.log");
export const ALLOW_ONCE_FILE = join(tmpdir(), "compressed-shell-allow-once.json");

export const MIN_LINES = 30;
export const TIMEOUT_SECONDS = 30;

export function debugLog(msg) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}\n`;
  appendFileSync(DEBUG_LOG, line);
  console.error(msg);
}

// Find claude CLI - check common locations since MCP doesn't inherit shell config
export function findClaudeCli() {
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

export const CLAUDE_CLI = findClaudeCli();

// Safe commands that should be auto-allowed (read-only, non-destructive)
export const SAFE_COMMANDS = [
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
export const VERBOSE_COMMANDS = [
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
