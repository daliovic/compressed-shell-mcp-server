#!/usr/bin/env node
/**
 * Compressed Shell MCP Server
 *
 * Provides shell command execution with automatic output compression
 * for verbose commands like npm, docker, apt, etc.
 *
 * Permission model:
 * - Safe commands (ls, pwd, cat, etc.) -> auto-allowed
 * - Commands in project's .claude/settings.local.json -> allowed
 * - Other commands -> denied with message to use allow_command tool
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Tool definitions and handlers
import { shellToolDefinition, handleShellTool } from "./tools/shell.js";
import {
  allowOnceToolDefinition,
  handleAllowOnceTool,
} from "./tools/allow-once.js";
import {
  allowCommandToolDefinition,
  handleAllowCommandTool,
} from "./tools/allow-command.js";

const server = new Server(
  { name: "compressed-shell", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      shellToolDefinition,
      allowCommandToolDefinition,
      allowOnceToolDefinition,
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;
  const args = request.params.arguments;

  switch (toolName) {
    case "allow_once":
      return handleAllowOnceTool(args);
    case "allow_command":
      return handleAllowCommandTool(args);
    case "shell":
      return handleShellTool(args);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Compressed Shell MCP Server running on stdio");
}

main().catch(console.error);
