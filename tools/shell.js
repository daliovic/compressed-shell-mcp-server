import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { LOG_DIR, MIN_LINES, debugLog } from "../lib/constants.js";
import {
  isSafeCommand,
  isVerboseCommand,
  isAllowedOnce,
  isCommandAllowed,
  getCommandPrefix,
} from "../lib/permissions.js";
import { executeCommand } from "../lib/execution.js";
import { compressWithHaiku } from "../lib/compression.js";

export const shellToolDefinition = {
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
};

export async function handleShellTool(args) {
  const { command, cwd, compress } = args;

  // Permission check
  const safe = isSafeCommand(command);
  const allowedOnce = isAllowedOnce(command); // This also consumes the permission if found
  const allowedAlways = isCommandAllowed(command, cwd);
  debugLog(
    `Permission check: command="${command}" safe=${safe} allowedOnce=${allowedOnce} allowedAlways=${allowedAlways}`
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

To allow ALWAYS (will permanently allow ALL "${subcommandPrefix}" commands in this project):
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
      result.exitCode
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
}
