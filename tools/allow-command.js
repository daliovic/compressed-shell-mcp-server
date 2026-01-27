import { addToProjectSettings } from "../lib/permissions.js";

export const allowCommandToolDefinition = {
  name: "allow_command",
  description: `Add a command PREFIX to the project's allowed list (.claude/settings.local.json).
Use when user wants to ALWAYS allow a type of command.

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
};

export async function handleAllowCommandTool(args) {
  const { command_prefix, cwd } = args;

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
        text: `PERMANENTLY ALLOWED: ${result.permission}\n\nAll "${command_prefix}" commands are now allowed in this project.\nYou can now retry the command.`,
      },
    ],
  };
}
