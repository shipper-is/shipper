import type { AgentKind } from "../shared/config-schema.ts";

export const AGENT_LABELS: Record<AgentKind, string> = {
  claude: "Claude",
  cursor: "Cursor",
  opencode: "OpenCode",
};

export function formatTimestamp(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
