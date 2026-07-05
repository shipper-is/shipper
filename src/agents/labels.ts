import type { AgentKind } from "./types.ts";

export const AGENT_LABELS: Record<AgentKind, string> = {
  claude: "Claude Code",
  cursor: "Cursor",
  opencode: "opencode",
};
