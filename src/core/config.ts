import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { DEFAULT_EMBED_IDLE_MINUTES } from "../constants.ts";
import {
  AGENT_KINDS,
  ARTIFACT_TYPES,
  CONFIG_LAYERS,
  DEFAULT_ARTIFACT_PATHS,
  DEFAULT_GIT,
  DEFAULT_SEARCH,
  SKILL_NAMES,
  globalConfigSchema,
  localConfigSchema,
  repoConfigSchema,
  validateArtifactDir,
  type ArtifactType,
  type ConfigLayer,
  type ConfigSource,
  type EffectiveConfig,
  type InstructionEntry,
} from "../shared/config-schema.ts";

export type LayerState = {
  layer: ConfigLayer;
  path: string;
  exists: boolean;
  value: Record<string, unknown> | null;
  error: string | null;
  ignoredKeys: string[];
};

export type LoadedConfig = {
  layers: Record<ConfigLayer, LayerState>;
  effective: EffectiveConfig;
  sources: Record<string, ConfigSource>;
  pathErrors: string[];
};

export type UpdateCheckState = {
  lastCheckAt?: number;
  latestKnown?: string;
};

const SETTINGS_KEYS = new Set(["models", "instructions", "git", "search"]);

const KNOWN_KEYS: Record<ConfigLayer, ReadonlySet<string>> = {
  global: new Set([...SETTINGS_KEYS, "embeddings", "state"]),
  repo: new Set([...SETTINGS_KEYS, "paths"]),
  local: new Set(SETTINGS_KEYS),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEnoent(err: unknown): boolean {
  return err instanceof Error && "code" in err && (err as { code?: string }).code === "ENOENT";
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function schemaFor(layer: ConfigLayer): z.ZodType {
  switch (layer) {
    case "global":
      return globalConfigSchema;
    case "repo":
      return repoConfigSchema;
    case "local":
      return localConfigSchema;
    default: {
      const exhaustive: never = layer;
      throw new Error(`Unknown config layer: ${String(exhaustive)}`);
    }
  }
}

function schemaErrorMessage(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) return "Invalid config";
  const pretty = z.prettifyError({ issues: [first] });
  return pretty.replaceAll("\n", " ").replace(/\s+/g, " ").trim();
}

export function configDir(): string {
  const xdg = process.env["XDG_CONFIG_HOME"];
  if (xdg) {
    return join(xdg, "shipper");
  }
  // os.homedir() caches the first lookup, so a test that sets HOME later would
  // still write the real config file. Read the live environment first.
  const home = process.env["HOME"];
  if (home) {
    return join(home, ".config", "shipper");
  }
  return join(homedir(), ".config", "shipper");
}

export function globalConfigPath(): string {
  return join(configDir(), "config.json");
}

export function repoConfigPath(repoRoot: string): string {
  return join(repoRoot, ".shipper", "config.json");
}

export function localConfigPath(repoRoot: string): string {
  return join(repoRoot, ".shipper", "config.local.json");
}

export function layerPath(layer: ConfigLayer, repoRoot: string): string {
  switch (layer) {
    case "global":
      return globalConfigPath();
    case "repo":
      return repoConfigPath(repoRoot);
    case "local":
      return localConfigPath(repoRoot);
    default: {
      const exhaustive: never = layer;
      throw new Error(`Unknown config layer: ${String(exhaustive)}`);
    }
  }
}

function missingLayer(layer: ConfigLayer, path: string): LayerState {
  return { layer, path, exists: false, value: null, error: null, ignoredKeys: [] };
}

function failedLayer(
  layer: ConfigLayer,
  path: string,
  exists: boolean,
  error: string,
): LayerState {
  return { layer, path, exists, value: null, error, ignoredKeys: [] };
}

async function writeAtomic(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}`;
  try {
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

async function readRawObject(path: string): Promise<Record<string, unknown> | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if (isEnoent(err)) return null;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Cannot update ${path}: invalid JSON (${errorMessage(err)})`, { cause: err });
  }
  if (!isRecord(parsed)) {
    throw new Error(`Cannot update ${path}: expected a JSON object`);
  }
  return parsed;
}

function pruneEmpty(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => pruneEmpty(item));
  }
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (val === undefined) continue;
    const pruned = pruneEmpty(val);
    if (isRecord(pruned) && Object.keys(pruned).length === 0) continue;
    out[key] = pruned;
  }
  return out;
}

export async function migrateGlobalConfig(): Promise<boolean> {
  const path = globalConfigPath();
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if (isEnoent(err)) return false;
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!isRecord(parsed)) return false;
  const hasProjects = Object.prototype.hasOwnProperty.call(parsed, "projects");
  const hasDefaults = Object.prototype.hasOwnProperty.call(parsed, "defaults");
  if (!hasProjects && !hasDefaults) return false;

  const defaults = isRecord(parsed.defaults) ? parsed.defaults : {};
  const next: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(parsed)) {
    if (key === "projects" || key === "defaults") continue;
    next[key] = val;
  }

  if (
    !Object.prototype.hasOwnProperty.call(next, "models") &&
    Object.prototype.hasOwnProperty.call(defaults, "models")
  ) {
    next.models = defaults.models;
  }
  if (
    !Object.prototype.hasOwnProperty.call(next, "embeddings") &&
    Object.prototype.hasOwnProperty.call(defaults, "embeddings")
  ) {
    next.embeddings = defaults.embeddings;
  }

  const state: Record<string, unknown> = isRecord(next.state) ? { ...next.state } : {};
  const stateExisted = Object.prototype.hasOwnProperty.call(next, "state");
  if (
    !Object.prototype.hasOwnProperty.call(state, "lastUpdateCheckAt") &&
    typeof defaults.lastUpdateCheckAt === "number"
  ) {
    state.lastUpdateCheckAt = defaults.lastUpdateCheckAt;
  }
  if (
    !Object.prototype.hasOwnProperty.call(state, "latestKnownVersion") &&
    typeof defaults.latestKnownVersion === "string"
  ) {
    state.latestKnownVersion = defaults.latestKnownVersion;
  }
  if (!stateExisted || isRecord(next.state)) {
    if (Object.keys(state).length > 0) {
      next.state = state;
    } else if (!stateExisted) {
      delete next.state;
    }
  }

  await writeAtomic(path, next);
  return true;
}

export async function readLayer(layer: ConfigLayer, repoRoot: string): Promise<LayerState> {
  if (layer === "global") {
    await migrateGlobalConfig();
  }
  const path = layerPath(layer, repoRoot);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if (isEnoent(err)) return missingLayer(layer, path);
    return failedLayer(layer, path, true, errorMessage(err));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return failedLayer(layer, path, true, `Invalid JSON: ${errorMessage(err)}`);
  }

  const result = schemaFor(layer).safeParse(parsed);
  if (!result.success) {
    return failedLayer(layer, path, true, schemaErrorMessage(result.error));
  }

  const value = result.data as Record<string, unknown>;
  const ignoredKeys: string[] = [];
  if (
    (layer === "global" || layer === "local") &&
    Object.prototype.hasOwnProperty.call(value, "paths")
  ) {
    ignoredKeys.push("paths");
  }
  return { layer, path, exists: true, value, error: null, ignoredKeys };
}

function defaultSources(): Record<string, ConfigSource> {
  const sources: Record<string, ConfigSource> = {};
  for (const type of ARTIFACT_TYPES) {
    sources[`paths.${type}`] = "default";
  }
  sources["git.branchMode"] = "default";
  sources["git.commitEachPhase"] = "default";
  sources["git.branchPrefix"] = "default";
  sources["search.enabled"] = "default";
  sources["search.extraDirs"] = "default";
  return sources;
}

function defaultEffective(): EffectiveConfig {
  return {
    paths: { ...DEFAULT_ARTIFACT_PATHS },
    models: {},
    instructions: [],
    git: { ...DEFAULT_GIT },
    search: { enabled: DEFAULT_SEARCH.enabled, extraDirs: [...DEFAULT_SEARCH.extraDirs] },
  };
}

function applyModels(
  layer: ConfigLayer,
  value: Record<string, unknown>,
  effective: EffectiveConfig,
  sources: Record<string, ConfigSource>,
): void {
  const models = value.models;
  if (!isRecord(models)) return;
  for (const agent of AGENT_KINDS) {
    const perAgent = models[agent];
    if (!isRecord(perAgent)) continue;
    for (const skill of SKILL_NAMES) {
      const model = perAgent[skill];
      if (typeof model !== "string" || model.length === 0) continue;
      const current = effective.models[agent] ?? {};
      current[skill] = model;
      effective.models[agent] = current;
      sources[`models.${agent}.${skill}`] = layer;
    }
  }
}

function applyGit(
  layer: ConfigLayer,
  value: Record<string, unknown>,
  effective: EffectiveConfig,
  sources: Record<string, ConfigSource>,
): void {
  const git = value.git;
  if (!isRecord(git)) return;
  if (git.branchMode === "current" || git.branchMode === "feature") {
    effective.git.branchMode = git.branchMode;
    sources["git.branchMode"] = layer;
  }
  if (typeof git.commitEachPhase === "boolean") {
    effective.git.commitEachPhase = git.commitEachPhase;
    sources["git.commitEachPhase"] = layer;
  }
  if (typeof git.branchPrefix === "string") {
    effective.git.branchPrefix = git.branchPrefix;
    sources["git.branchPrefix"] = layer;
  }
}

function applySearch(
  layer: ConfigLayer,
  value: Record<string, unknown>,
  effective: EffectiveConfig,
  sources: Record<string, ConfigSource>,
  pathErrors: string[],
): void {
  const search = value.search;
  if (!isRecord(search)) return;
  if (typeof search.enabled === "boolean") {
    effective.search.enabled = search.enabled;
    sources["search.enabled"] = layer;
  }
  if (!Array.isArray(search.extraDirs)) return;
  const dirs: string[] = [];
  for (const entry of search.extraDirs) {
    if (typeof entry !== "string") {
      pathErrors.push("search.extraDirs: expected a string");
      continue;
    }
    const result = validateArtifactDir(entry);
    if (!result.ok) {
      pathErrors.push(`search.extraDirs: ${result.error}`);
      continue;
    }
    dirs.push(result.dir);
  }
  effective.search.extraDirs = dirs;
  sources["search.extraDirs"] = layer;
}

function applyInstructions(
  layer: ConfigLayer,
  value: Record<string, unknown>,
  instructions: InstructionEntry[],
): void {
  const raw = value.instructions;
  if (!isRecord(raw)) return;
  const all = raw.all;
  if (typeof all === "string" && all.length > 0) {
    instructions.push({ layer, scope: "all", text: all });
  }
  for (const skill of SKILL_NAMES) {
    const text = raw[skill];
    if (typeof text === "string" && text.length > 0) {
      instructions.push({ layer, scope: skill, text });
    }
  }
}

function applyRepoPaths(
  value: Record<string, unknown>,
  effective: EffectiveConfig,
  sources: Record<string, ConfigSource>,
  pathErrors: string[],
): void {
  const paths = value.paths;
  if (!isRecord(paths)) return;

  const owner = new Map<string, ArtifactType>();
  for (const type of ARTIFACT_TYPES) {
    owner.set(effective.paths[type], type);
  }

  for (const type of ARTIFACT_TYPES) {
    if (!Object.prototype.hasOwnProperty.call(paths, type)) continue;
    const raw = paths[type];
    if (typeof raw !== "string") {
      pathErrors.push(`paths.${type}: expected a string`);
      continue;
    }
    const result = validateArtifactDir(raw);
    if (!result.ok) {
      pathErrors.push(`paths.${type}: ${result.error}`);
      continue;
    }
    const takenBy = owner.get(result.dir);
    if (takenBy !== undefined && takenBy !== type) {
      pathErrors.push(
        `paths.${type} resolves to "${result.dir}", the same directory as paths.${takenBy}`,
      );
      continue;
    }
    const previous = effective.paths[type];
    if (previous !== result.dir && owner.get(previous) === type) {
      owner.delete(previous);
    }
    effective.paths[type] = result.dir;
    owner.set(result.dir, type);
    sources[`paths.${type}`] = "repo";
  }
}

export function mergeConfig(layers: Record<ConfigLayer, LayerState>): {
  effective: EffectiveConfig;
  sources: Record<string, ConfigSource>;
  pathErrors: string[];
} {
  const pathErrors: string[] = [];
  const sources = defaultSources();
  const effective = defaultEffective();
  for (const layer of CONFIG_LAYERS) {
    const value = layers[layer].value;
    if (!value) continue;
    applyModels(layer, value, effective, sources);
    applyGit(layer, value, effective, sources);
    applySearch(layer, value, effective, sources, pathErrors);
    applyInstructions(layer, value, effective.instructions);
    if (layer === "repo") {
      applyRepoPaths(value, effective, sources, pathErrors);
    }
  }
  return { effective, sources, pathErrors };
}

export async function loadConfig(repoRoot: string): Promise<LoadedConfig> {
  const [globalLayer, repoLayer, localLayer] = await Promise.all([
    readLayer("global", repoRoot),
    readLayer("repo", repoRoot),
    readLayer("local", repoRoot),
  ]);
  const layers = { global: globalLayer, repo: repoLayer, local: localLayer };
  return { layers, ...mergeConfig(layers) };
}

function composeWrite(
  layer: ConfigLayer,
  incoming: Record<string, unknown>,
  existing: Record<string, unknown> | null,
): Record<string, unknown> {
  const known = KNOWN_KEYS[layer];
  const result: Record<string, unknown> = {};
  if (existing) {
    for (const [key, val] of Object.entries(existing)) {
      if (known.has(key)) continue;
      result[key] = val;
    }
    if (layer === "global") {
      if (
        !Object.prototype.hasOwnProperty.call(incoming, "embeddings") &&
        Object.prototype.hasOwnProperty.call(existing, "embeddings")
      ) {
        result.embeddings = existing.embeddings;
      }
      if (
        !Object.prototype.hasOwnProperty.call(incoming, "state") &&
        Object.prototype.hasOwnProperty.call(existing, "state")
      ) {
        result.state = existing.state;
      }
    }
  }
  for (const [key, val] of Object.entries(incoming)) {
    result[key] = val;
  }
  const pruned = pruneEmpty(result);
  if (!isRecord(pruned)) {
    throw new Error("Config must be a JSON object");
  }
  return pruned;
}

export async function writeLayer(
  layer: ConfigLayer,
  repoRoot: string,
  value: unknown,
): Promise<LayerState> {
  const parsed = schemaFor(layer).safeParse(value);
  if (!parsed.success) {
    throw new Error(schemaErrorMessage(parsed.error));
  }
  const incoming = parsed.data as Record<string, unknown>;

  if (layer === "global") {
    await migrateGlobalConfig();
  }
  const path = layerPath(layer, repoRoot);
  const existing = await readRawObject(path);
  const next = composeWrite(layer, incoming, existing);

  if (layer === "local") {
    await ensureShipperGitignore(repoRoot);
  }
  await mkdir(dirname(path), { recursive: true });
  await writeAtomic(path, next);
  return readLayer(layer, repoRoot);
}

export async function ensureShipperGitignore(repoRoot: string): Promise<void> {
  const dir = join(repoRoot, ".shipper");
  await mkdir(dir, { recursive: true });
  const path = join(dir, ".gitignore");
  let existing = "";
  try {
    existing = await readFile(path, "utf8");
  } catch (err) {
    if (!isEnoent(err)) throw err;
  }
  const already = existing.split(/\r?\n/).some((line) => line.trim() === "config.local.json");
  if (already) return;
  if (existing.length === 0) {
    await writeFile(path, "config.local.json\n", "utf8");
    return;
  }
  const prefix = existing.endsWith("\n") ? existing : `${existing}\n`;
  await writeFile(path, `${prefix}config.local.json\n`, "utf8");
}

export async function getEmbedIdleMinutes(): Promise<number> {
  const layer = await readLayer("global", "");
  const embeddings = layer.value?.embeddings;
  if (isRecord(embeddings) && typeof embeddings.idleMinutes === "number") {
    return embeddings.idleMinutes;
  }
  return DEFAULT_EMBED_IDLE_MINUTES;
}

export async function setEmbedIdleMinutes(n: number): Promise<void> {
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`idleMinutes must be a positive integer, got ${n}`);
  }
  await migrateGlobalConfig();
  const path = globalConfigPath();
  const current = (await readRawObject(path)) ?? {};
  const embeddings = isRecord(current.embeddings) ? { ...current.embeddings } : {};
  embeddings.idleMinutes = n;
  current.embeddings = embeddings;
  await mkdir(configDir(), { recursive: true });
  await writeAtomic(path, current);
}

export async function getUpdateCheckState(): Promise<UpdateCheckState> {
  const layer = await readLayer("global", "");
  const state = layer.value?.state;
  if (!isRecord(state)) return {};
  const result: UpdateCheckState = {};
  if (typeof state.lastUpdateCheckAt === "number") {
    result.lastCheckAt = state.lastUpdateCheckAt;
  }
  if (typeof state.latestKnownVersion === "string") {
    result.latestKnown = state.latestKnownVersion;
  }
  return result;
}

export async function setUpdateCheckState(patch: UpdateCheckState): Promise<void> {
  await migrateGlobalConfig();
  const path = globalConfigPath();
  const current = (await readRawObject(path)) ?? {};
  const state = isRecord(current.state) ? { ...current.state } : {};
  if (patch.lastCheckAt !== undefined) {
    state.lastUpdateCheckAt = patch.lastCheckAt;
  }
  if (patch.latestKnown !== undefined) {
    state.latestKnownVersion = patch.latestKnown;
  }
  if (Object.keys(state).length === 0) {
    delete current.state;
  } else {
    current.state = state;
  }
  await mkdir(configDir(), { recursive: true });
  await writeAtomic(path, current);
}
