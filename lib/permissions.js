import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import {
  SAFE_COMMANDS,
  VERBOSE_COMMANDS,
  ALLOW_ONCE_FILE,
  debugLog,
} from "./constants.js";

export function isSafeCommand(command) {
  const firstWord = command.trim().split(/\s+/)[0];
  for (const safe of SAFE_COMMANDS) {
    if (command === safe || command.startsWith(safe + " ")) return true;
    if (firstWord === safe) return true;
  }
  return false;
}

export function isVerboseCommand(command) {
  const commands = command.split(/\s*(?:&&|\|\||;|\|)\s*/);
  for (const cmd of commands) {
    const firstWord = cmd.trim().split(/\s+/)[0];
    if (
      VERBOSE_COMMANDS.some(
        (vc) => firstWord === vc || firstWord.startsWith(vc + "-")
      )
    ) {
      return true;
    }
  }
  return false;
}

export function getCommandPrefix(command) {
  const words = command.trim().split(/\s+/);
  // Use first two words for subcommand (e.g., "npm install", "docker build")
  // Fall back to first word only if no subcommand
  return words.length >= 2 ? `${words[0]} ${words[1]}` : words[0];
}

// Allow-once mechanism: check and consume one-time permissions
export function isAllowedOnce(command) {
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

export function addAllowOnce(command) {
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
export function isCommandAllowed(command, cwd) {
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
      if (
        rule === `mcp__compressed-shell__shell(command:${subcommandPrefix} *)`
      )
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
export function addToProjectSettings(commandPrefix, cwd) {
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
