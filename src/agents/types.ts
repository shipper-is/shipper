export type AgentKind = "claude" | "cursor" | "opencode";

export type DetectedAgent = {
  kind: AgentKind;
  binary: string;
  version: string;
};
