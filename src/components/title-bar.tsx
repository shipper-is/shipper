import React from "react";
import { Box, Text } from "ink";
import type { AgentKind } from "../agents/types.ts";

const AGENT_LABELS: Record<AgentKind, string> = {
  claude: "Claude Code",
  cursor: "Cursor",
  opencode: "opencode",
};

type TitleBarProps = {
  repoPath: string;
  agent: AgentKind | null;
};

export function TitleBar({ repoPath, agent }: TitleBarProps) {
  const agentLabel = agent ? AGENT_LABELS[agent] : "no agent";

  return (
    <Box borderStyle="single" paddingX={1}>
      <Text bold color="cyan">
        Shipper
      </Text>
      <Text> · {repoPath}</Text>
      <Text dimColor> · {agentLabel}</Text>
    </Box>
  );
}
