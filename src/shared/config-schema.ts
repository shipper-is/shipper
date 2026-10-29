import { z } from "zod";

export const AGENT_KINDS = ["claude", "cursor", "opencode"] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

export const SKILL_NAMES = [
  "shipper-plan",
  "shipper-build",
  "shipper-loop",
  "shipper-spike",
  "shipper-ship",
  "shipper-bug",
] as const;
export type SkillName = (typeof SKILL_NAMES)[number];

export const ARTIFACT_TYPES = ["plans", "spikes", "bugs", "reviews"] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export const CONFIG_LAYERS = ["global", "repo", "local"] as const;
export type ConfigLayer = (typeof CONFIG_LAYERS)[number];

export const DEFAULT_ARTIFACT_PATHS = {
  plans: ".shipper/plans",
  spikes: ".shipper/spikes",
  bugs: ".shipper/bugs",
  reviews: ".shipper/reviews",
} as const satisfies Record<ArtifactType, string>;

/** Semantic checks live in `validateArtifactDir` in this file. */
const relativeDir = z.string().min(1);

function perSkill<T extends z.ZodType>(value: T) {
  return z.looseObject({
    "shipper-plan": value.optional(),
    "shipper-build": value.optional(),
    "shipper-loop": value.optional(),
    "shipper-spike": value.optional(),
    "shipper-ship": value.optional(),
    "shipper-bug": value.optional(),
  });
}

const modelIdSchema = z.string().trim().min(1);

const skillModelSchema = z.union([
  modelIdSchema,
  z.looseObject({
    model: modelIdSchema.optional(),
    research: modelIdSchema.optional(),
    investigate: modelIdSchema.optional(),
    phase: modelIdSchema.optional(),
  }),
]);

const modelListSchema = z.union([modelIdSchema, z.array(modelIdSchema).min(1)]);

const reviewModelSchema = z.looseObject({
  triage: modelIdSchema.optional(),
  light: modelListSchema.optional(),
  heavy: modelListSchema.optional(),
});

const agentModelsSchema = z.looseObject({
  "shipper-plan": skillModelSchema.optional(),
  "shipper-build": skillModelSchema.optional(),
  "shipper-loop": skillModelSchema.optional(),
  "shipper-spike": skillModelSchema.optional(),
  "shipper-ship": skillModelSchema.optional(),
  "shipper-bug": skillModelSchema.optional(),
  "shipper-review": reviewModelSchema.optional(),
});

const modelsSchema = z.looseObject({
  claude: agentModelsSchema.optional(),
  cursor: agentModelsSchema.optional(),
  opencode: agentModelsSchema.optional(),
});

const instructionsSchema = perSkill(z.string()).extend({
  all: z.string().optional(),
});

const gitSchema = z.looseObject({
  branchMode: z.enum(["current", "feature"]).optional(),
  commitEachPhase: z.boolean().optional(),
  branchPrefix: z
    .string()
    .regex(/^[A-Za-z0-9._/-]*$/)
    .optional(),
});

const searchSchema = z.looseObject({
  enabled: z.boolean().optional(),
  extraDirs: z.array(relativeDir).optional(),
});

const pathsSchema = z.looseObject({
  plans: relativeDir.optional(),
  spikes: relativeDir.optional(),
  bugs: relativeDir.optional(),
  reviews: relativeDir.optional(),
});

export const settingsSchema = z.looseObject({
  models: modelsSchema.optional(),
  instructions: instructionsSchema.optional(),
  git: gitSchema.optional(),
  search: searchSchema.optional(),
});

export const repoConfigSchema = settingsSchema.extend({
  paths: pathsSchema.optional(),
});

export const localConfigSchema = settingsSchema;

export const globalConfigSchema = settingsSchema.extend({
  embeddings: z
    .looseObject({
      idleMinutes: z.number().int().positive().optional(),
    })
    .optional(),
  state: z
    .looseObject({
      lastUpdateCheckAt: z.number().optional(),
      latestKnownVersion: z.string().optional(),
    })
    .optional(),
});

export type Settings = z.infer<typeof settingsSchema>;
export type RepoConfig = z.infer<typeof repoConfigSchema>;
export type LocalConfig = z.infer<typeof localConfigSchema>;
export type GlobalConfig = z.infer<typeof globalConfigSchema>;

export type InstructionEntry = {
  layer: ConfigLayer;
  scope: "all" | SkillName;
  text: string;
};

export type SkillModelConfig = {
  model?: string;
  research?: string;
  investigate?: string;
  phase?: string;
};

export type ReviewModelConfig = {
  triage?: string;
  light?: string[];
  heavy?: string[];
};

/**
 * A string becomes a one-element list. Arrays keep order, drop empties, and drop duplicates.
 * Config merge and the setup form both use this so a saved list has one shape.
 */
export function normalizeModelList(value: unknown): string[] | undefined {
  const items = typeof value === "string" ? [value] : Array.isArray(value) ? value : null;
  if (!items) return undefined;
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of items) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids.length > 0 ? ids : undefined;
}

export type EffectiveConfig = {
  paths: Record<ArtifactType, string>;
  models: Partial<
    Record<
      AgentKind,
      Partial<Record<SkillName, SkillModelConfig>> & { "shipper-review"?: ReviewModelConfig }
    >
  >;
  instructions: InstructionEntry[];
  git: {
    branchMode: "current" | "feature" | null;
    commitEachPhase: boolean;
    branchPrefix: string;
  };
  search: { enabled: boolean; extraDirs: string[] };
};

export type ConfigSource = ConfigLayer | "default";

export const DEFAULT_GIT: EffectiveConfig["git"] = {
  branchMode: null,
  commitEachPhase: true,
  branchPrefix: "shipper/",
};

export const DEFAULT_SEARCH: EffectiveConfig["search"] = {
  enabled: true,
  extraDirs: [],
};

const BLOCKED_SEGMENTS = new Set([".git", "node_modules"]);

/**
 * Normalize a repo-relative artifact directory.
 * No Node imports: the setup console validates the same way in the browser.
 */
export function validateArtifactDir(
  value: string,
): { ok: true; dir: string } | { ok: false; error: string } {
  if (value.includes("\\")) {
    return { ok: false, error: `"${value}" contains a backslash` };
  }
  if (value.startsWith("/")) {
    return { ok: false, error: `"${value}" is an absolute path` };
  }

  let stripped = value;
  while (stripped.endsWith("/")) {
    stripped = stripped.slice(0, -1);
  }
  if (stripped.length === 0) {
    return { ok: false, error: "path is empty" };
  }

  const resolved: string[] = [];
  for (const part of stripped.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (resolved.length === 0) {
        return { ok: false, error: `"${value}" escapes the repository` };
      }
      resolved.pop();
      continue;
    }
    if (BLOCKED_SEGMENTS.has(part)) {
      return { ok: false, error: `"${value}" must not contain a ${part} segment` };
    }
    resolved.push(part);
  }

  if (resolved.length === 0) {
    return { ok: false, error: "path is empty" };
  }
  return { ok: true, dir: resolved.join("/") };
}
