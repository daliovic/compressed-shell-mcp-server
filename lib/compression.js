import { execSync } from "child_process";
import { writeFileSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";
import { LOG_DIR, CLAUDE_CLI, TIMEOUT_SECONDS } from "./constants.js";

export async function compressWithHaiku(output, command, exitCode) {
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
      }
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
