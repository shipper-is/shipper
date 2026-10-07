import { z } from "zod";
import {
  AGENT_KINDS,
  CONFIG_LAYERS,
  type AgentKind,
  type ArtifactType,
  type ConfigLayer,
  type ConfigSource,
  type EffectiveConfig,
  type SkillName,
} from "./config-schema.ts";

export type ModelVariantDto = {
  id: string;
  label: string;
};

export type ModelFamilyDto = {
  id: string;
  label: string;
  variants: ModelVariantDto[];
};

export type LayerStateDto = {
  layer: ConfigLayer;
  path: string;
  exists: boolean;
  value: Record<string, unknown> | null;
  error: string | null;
  ignoredKeys: string[];
};

export type SetupSnapshot = {
  repoRoot: string;
  version: string;
  update: { latest: string; installCommand: string } | null;
  config: {
    layers: Record<ConfigLayer, LayerStateDto>;
    effective: EffectiveConfig;
    sources: Record<string, ConfigSource>;
    pathErrors: string[];
  };
  artifacts: Array<{
    type: ArtifactType;
    dir: string;
    exists: boolean;
    open: number | null;
    done: number | null;
    total: number;
  }>;
  strayArtifacts: Array<{ type: ArtifactType; dir: string; count: number }>;
  modules: Array<{ id: string; name: string; version: string | null }>;
  agents: Array<{
    kind: AgentKind;
    detected: boolean;
    version: string | null;
    binary: string | null;
  }>;
  skills: Array<{
    agent: AgentKind;
    root: string;
    skills: Array<{ name: SkillName; state: "current" | "outdated" | "missing" }>;
  }>;
  mcp: Array<{
    agent: AgentKind;
    state: "registered" | "outdated" | "missing" | "manual" | "unknown";
    detail: string;
  }>;
  search: {
    index: {
      path: string;
      exists: boolean;
      files: number;
      chunks: number;
      updatedAt: string | null;
      modelId: string | null;
      stale: boolean;
    };
    embed: {
      running: boolean;
      port: number | null;
      idleMinutes: number;
      lastUsedAt: string | null;
      assets: { serverBinary: boolean; model: boolean };
      cacheDir: string;
    };
  };
  collectedAt: string;
};

export type SetupAction =
  | { kind: "refresh-skills" }
  | { kind: "install-mcp"; agent?: AgentKind }
  | { kind: "uninstall-mcp"; agent?: AgentKind }
  | { kind: "sync-index"; force: boolean }
  | { kind: "start-embed" }
  | { kind: "stop-embed" };

export type ActionStatus = {
  id: string;
  action: SetupAction;
  state: "running" | "done" | "error";
  message: string;
  progress: string | null;
};

export type ServerMessage =
  | { type: "setup"; setup: SetupSnapshot; action: ActionStatus | null }
  | { type: "action-status"; action: ActionStatus }
  | { type: "models-list"; agent: AgentKind; families: ModelFamilyDto[] }
  | { type: "save-result"; layer: ConfigLayer; ok: boolean; error: string | null }
  | { type: "notice"; text: string };

export type ClientMessage =
  | { type: "refresh" }
  | { type: "save-config"; layer: ConfigLayer; value: unknown }
  | { type: "run-action"; action: SetupAction }
  | { type: "list-models"; agent: AgentKind };

const agentSchema = z.enum(AGENT_KINDS);
const layerSchema = z.enum(CONFIG_LAYERS);

const setupActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("refresh-skills") }),
  z.object({ kind: z.literal("install-mcp"), agent: agentSchema.optional() }),
  z.object({ kind: z.literal("uninstall-mcp"), agent: agentSchema.optional() }),
  z.object({ kind: z.literal("sync-index"), force: z.boolean() }),
  z.object({ kind: z.literal("start-embed") }),
  z.object({ kind: z.literal("stop-embed") }),
]);

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("refresh") }),
  z.object({
    type: z.literal("save-config"),
    layer: layerSchema,
    value: z.unknown(),
  }),
  z.object({ type: z.literal("run-action"), action: setupActionSchema }),
  z.object({ type: z.literal("list-models"), agent: agentSchema }),
]);

export function parseClientMessage(raw: unknown): ClientMessage | null {
  const result = clientMessageSchema.safeParse(raw);
  if (!result.success) {
    return null;
  }
  return result.data;
}
