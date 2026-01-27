import { debugLog } from "../lib/constants.js";
import { addAllowOnce } from "../lib/permissions.js";

export const allowOnceToolDefinition = {
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
};

export async function handleAllowOnceTool(args) {
  const { command } = args;

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
