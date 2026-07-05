import React from "react";
import { Box, Text } from "ink";
import type { AgentKind } from "../agents/types.ts";

const AGENT_LABELS: Record<AgentKind, string> = {
  claude: "Claude Code",
  cursor: "Cursor CLI",
  opencode: "opencode",
};

const INSTALL_COMMANDS: Record<AgentKind, string> = {
  claude: "curl -fsSL https://claude.ai/install.sh | bash",
  cursor: "curl -fsSL https://cursor.com/install | bash",
  opencode: "curl -fsSL https://opencode.ai/install | bash",
};

const INSTALL_URLS: Record<AgentKind, string> = {
  claude: "https://docs.anthropic.com/en/docs/claude-code",
  cursor: "https://cursor.com/docs/cli",
  opencode: "https://opencode.ai",
};

export function NoAgentsScreen() {
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Text bold color="yellow">
        No coding agents detected
      </Text>
      <Box marginTop={1}>
        <Text>
          Shipper needs at least one of Claude Code, Cursor CLI, or opencode installed and on your
          PATH.
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        {(Object.keys(AGENT_LABELS) as AgentKind[]).map((kind) => (
          <Box key={kind} flexDirection="column" marginBottom={1}>
            <Text bold>{AGENT_LABELS[kind]}</Text>
            <Text dimColor>{INSTALL_URLS[kind]}</Text>
            <Text color="cyan">{INSTALL_COMMANDS[kind]}</Text>
          </Box>
        ))}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          After installing, press <Text color="cyan">r</Text> to rescan or{" "}
          <Text color="cyan">s</Text> for settings.
        </Text>
      </Box>
    </Box>
  );
}

export { AGENT_LABELS, INSTALL_COMMANDS, INSTALL_URLS };
