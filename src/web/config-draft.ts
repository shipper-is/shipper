import {
  ARTIFACT_TYPES,
  DEFAULT_ARTIFACT_PATHS,
  validateArtifactDir,
  type AgentKind,
  type ArtifactType,
  type ConfigLayer,
  type SkillName,
} from "../shared/config-schema.ts";

/**
 * Draft helpers for the setup config form.
 * `writeLayer` replaces known settings keys, so a save must send the whole
 * draft (unknown keys included). It does not deep-merge `models`, `git`,
 * `search`, `instructions`, or repo `paths`.
 */

const PREFIX_RE = /^[A-Za-z0-9._/-]*$/;

export type DraftIssue = { path: string; message: string };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function cloneDraft(value: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!value) return {};
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

export function draftsEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function withoutKey(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const next = { ...record };
  delete next[key];
  return next;
}

function withChild(
  draft: Record<string, unknown>,
  key: string,
  child: Record<string, unknown>,
): Record<string, unknown> {
  if (Object.keys(child).length === 0) return withoutKey(draft, key);
  return { ...draft, [key]: child };
}

export function readGit(draft: Record<string, unknown>): {
  branchMode: "" | "current" | "feature";
  commitEachPhase: "" | "yes" | "no";
  branchPrefix: string;
} {
  const git = isRecord(draft.git) ? draft.git : {};
  const branchMode = git.branchMode === "current" || git.branchMode === "feature" ? git.branchMode : "";
  const commitEachPhase =
    git.commitEachPhase === true ? "yes" : git.commitEachPhase === false ? "no" : "";
  const branchPrefix = typeof git.branchPrefix === "string" ? git.branchPrefix : "";
  return { branchMode, commitEachPhase, branchPrefix };
}

export function setGitField(
  draft: Record<string, unknown>,
  field: "branchMode" | "commitEachPhase" | "branchPrefix",
  value: unknown,
): Record<string, unknown> {
  const git = isRecord(draft.git) ? { ...draft.git } : {};
  if (value === undefined) delete git[field];
  else git[field] = value;
  return withChild(draft, "git", git);
}

export function pathValue(draft: Record<string, unknown>, type: ArtifactType): string {
  if (!isRecord(draft.paths)) return "";
  const raw = draft.paths[type];
  return typeof raw === "string" ? raw : "";
}

export function setPath(
  draft: Record<string, unknown>,
  type: ArtifactType,
  value: string,
): Record<string, unknown> {
  const paths = isRecord(draft.paths) ? { ...draft.paths } : {};
  if (value === "") delete paths[type];
  else paths[type] = value;
  return withChild(draft, "paths", paths);
}

export function instructionValue(draft: Record<string, unknown>, scope: "all" | SkillName): string {
  if (!isRecord(draft.instructions)) return "";
  const raw = draft.instructions[scope];
  return typeof raw === "string" ? raw : "";
}

export function setInstruction(
  draft: Record<string, unknown>,
  scope: "all" | SkillName,
  text: string,
): Record<string, unknown> {
  const instructions = isRecord(draft.instructions) ? { ...draft.instructions } : {};
  if (text === "") delete instructions[scope];
  else instructions[scope] = text;
  return withChild(draft, "instructions", instructions);
}

export function modelValue(
  draft: Record<string, unknown>,
  agent: AgentKind,
  skill: SkillName,
): string | undefined {
  if (!isRecord(draft.models)) return undefined;
  const perAgent = draft.models[agent];
  if (!isRecord(perAgent)) return undefined;
  const model = perAgent[skill];
  return typeof model === "string" && model.length > 0 ? model : undefined;
}

export function setModel(
  draft: Record<string, unknown>,
  agent: AgentKind,
  skill: SkillName,
  model: string | undefined,
): Record<string, unknown> {
  const models = isRecord(draft.models) ? { ...draft.models } : {};
  const perAgent = isRecord(models[agent]) ? { ...models[agent] } : {};
  if (model === undefined || model === "") delete perAgent[skill];
  else perAgent[skill] = model;
  if (Object.keys(perAgent).length === 0) delete models[agent];
  else models[agent] = perAgent;
  return withChild(draft, "models", models);
}

export function readSearchEnabled(draft: Record<string, unknown>): boolean | undefined {
  if (!isRecord(draft.search)) return undefined;
  return typeof draft.search.enabled === "boolean" ? draft.search.enabled : undefined;
}

export function setSearchEnabled(
  draft: Record<string, unknown>,
  enabled: boolean | undefined,
): Record<string, unknown> {
  const search = isRecord(draft.search) ? { ...draft.search } : {};
  if (enabled === undefined) delete search.enabled;
  else search.enabled = enabled;
  return withChild(draft, "search", search);
}

/** `null` means this layer does not set the key, so a lower layer still applies. */
export function readExtraDirs(draft: Record<string, unknown>): string[] | null {
  if (!isRecord(draft.search) || !Object.prototype.hasOwnProperty.call(draft.search, "extraDirs")) {
    return null;
  }
  if (!Array.isArray(draft.search.extraDirs)) return null;
  return draft.search.extraDirs.map((entry) => (typeof entry === "string" ? entry : ""));
}

export function setExtraDirs(
  draft: Record<string, unknown>,
  dirs: string[] | undefined,
): Record<string, unknown> {
  const search = isRecord(draft.search) ? { ...draft.search } : {};
  if (dirs === undefined) delete search.extraDirs;
  else search.extraDirs = dirs;
  return withChild(draft, "search", search);
}

export function draftIssues(layer: ConfigLayer, draft: Record<string, unknown>): DraftIssue[] {
  const issues: DraftIssue[] = [];

  if (layer === "repo" && isRecord(draft.paths)) {
    const effective: Record<ArtifactType, string> = { ...DEFAULT_ARTIFACT_PATHS };
    const owner = new Map<string, ArtifactType>();
    for (const type of ARTIFACT_TYPES) owner.set(effective[type], type);

    for (const type of ARTIFACT_TYPES) {
      if (!Object.prototype.hasOwnProperty.call(draft.paths, type)) continue;
      const raw = draft.paths[type];
      if (typeof raw !== "string") {
        issues.push({ path: `paths.${type}`, message: "Expected a string." });
        continue;
      }
      const result = validateArtifactDir(raw);
      if (!result.ok) {
        issues.push({ path: `paths.${type}`, message: result.error });
        continue;
      }
      const takenBy = owner.get(result.dir);
      if (takenBy !== undefined && takenBy !== type) {
        issues.push({
          path: `paths.${type}`,
          message: `Resolves to "${result.dir}", the same directory as ${takenBy}.`,
        });
        continue;
      }
      const previous = effective[type];
      if (previous !== result.dir && owner.get(previous) === type) owner.delete(previous);
      effective[type] = result.dir;
      owner.set(result.dir, type);
    }
  }

  if (
    isRecord(draft.git) &&
    typeof draft.git.branchPrefix === "string" &&
    !PREFIX_RE.test(draft.git.branchPrefix)
  ) {
    issues.push({
      path: "git.branchPrefix",
      message: "Use only letters, digits, and . _ / -",
    });
  }

  if (isRecord(draft.search) && Array.isArray(draft.search.extraDirs)) {
    draft.search.extraDirs.forEach((entry, index) => {
      if (typeof entry !== "string" || entry.trim() === "") {
        issues.push({
          path: `search.extraDirs.${index}`,
          message: "Enter a directory or remove this row.",
        });
        return;
      }
      const result = validateArtifactDir(entry);
      if (!result.ok) {
        issues.push({ path: `search.extraDirs.${index}`, message: result.error });
      }
    });
  }

  return issues;
}

/**
 * Full settings draft for `writeLayer`.
 * Global saves omit `embeddings` and `state` so the server keeps the copies on disk.
 * Local and global saves omit `paths` so the server does not reject the write;
 * an existing `paths` key stays on disk because it is not a known settings key there.
 */
export function payloadForSave(
  layer: ConfigLayer,
  draft: Record<string, unknown>,
): Record<string, unknown> {
  const payload = cloneDraft(draft);
  if (layer !== "repo") delete payload.paths;
  if (layer === "global") {
    delete payload.embeddings;
    delete payload.state;
  }
  if (layer === "repo" && isRecord(payload.paths)) {
    const paths = { ...payload.paths };
    for (const type of ARTIFACT_TYPES) {
      const raw = paths[type];
      if (typeof raw !== "string") continue;
      const result = validateArtifactDir(raw);
      if (result.ok) paths[type] = result.dir;
    }
    payload.paths = paths;
  }
  if (isRecord(payload.search) && Array.isArray(payload.search.extraDirs)) {
    payload.search = {
      ...payload.search,
      extraDirs: payload.search.extraDirs.map((entry) => {
        if (typeof entry !== "string") return entry;
        const result = validateArtifactDir(entry);
        return result.ok ? result.dir : entry;
      }),
    };
  }
  return payload;
}
