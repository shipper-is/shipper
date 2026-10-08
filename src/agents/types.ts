import type { AgentKind } from "../shared/config-schema.ts";

export type { AgentKind };

export type DetectedAgent = {
  kind: AgentKind;
  binary: string;
  version: string;
};
