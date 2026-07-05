import type { AgentAdapter, AgentKind } from "./types.ts";
import { ClaudeAdapter } from "./claude.ts";
import { CursorAdapter } from "./cursor.ts";
import { OpencodeAdapter } from "./opencode.ts";

export function createAdapter(kind: AgentKind): AgentAdapter {
  switch (kind) {
    case "claude":
      return new ClaudeAdapter();
    case "cursor":
      return new CursorAdapter();
    case "opencode":
      return new OpencodeAdapter();
  }
}

export { ClaudeAdapter } from "./claude.ts";
export { CursorAdapter } from "./cursor.ts";
export { OpencodeAdapter } from "./opencode.ts";
export { detectAgents, clearAgentDetectionCache } from "./detect.ts";
export type {
  AgentAdapter,
  AgentEvent,
  AgentKind,
  AgentQuestion,
  AgentStartOptions,
  DetectedAgent,
} from "./types.ts";
