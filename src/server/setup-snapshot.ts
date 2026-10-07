import { stat } from "node:fs/promises";
import { detectAgents } from "../agents/detect.ts";
import { DEFAULT_EMBED_IDLE_MINUTES } from "../constants.ts";
import { findStrayArtifacts, resolveArtifactDirs } from "../core/artifact-paths.ts";
import { layerPath, loadConfig, type LoadedConfig } from "../core/config.ts";
import { listInstalledModules } from "../core/modules.ts";
import { getSkillStatus } from "../core/skill-status.ts";
import { checkForUpdate, type UpdateNotice } from "../core/update-check.ts";
import { getEmbedServerStatus, type EmbedServerStatus } from "../embeddings/server-manager.ts";
import { indexPathForRepo } from "../embeddings/paths.ts";
import { getMcpStatus } from "../mcp/install.ts";
import { discoverDocs, type DocType, type ShipperDoc } from "../search/documents.ts";
import { getIndexStatus, type IndexStatus } from "../search/index-status.ts";
import {
  AGENT_KINDS,
  ARTIFACT_TYPES,
  CONFIG_LAYERS,
  DEFAULT_ARTIFACT_PATHS,
  DEFAULT_GIT,
  DEFAULT_SEARCH,
  type AgentKind,
  type ArtifactType,
  type ConfigSource,
  type EffectiveConfig,
} from "../shared/config-schema.ts";
import type { SetupSnapshot } from "../shared/protocol.ts";
import { getVersion } from "../version.ts";

const COLLECT_TIMEOUT_MS = 5_000;

const DOC_TYPE_BY_ARTIFACT = {
  plans: "plan",
  spikes: "spike",
  bugs: "bug",
} as const satisfies Partial<Record<ArtifactType, DocType>>;

export type SetupSnapshotDeps = {
  loadConfig: typeof loadConfig;
  discoverDocs: typeof discoverDocs;
  detectAgents: typeof detectAgents;
  getSkillStatus: typeof getSkillStatus;
  getMcpStatus: typeof getMcpStatus;
  getIndexStatus: typeof getIndexStatus;
  getEmbedServerStatus: typeof getEmbedServerStatus;
  listInstalledModules: typeof listInstalledModules;
  findStrayArtifacts: typeof findStrayArtifacts;
  checkForUpdate: typeof checkForUpdate;
  getVersion: typeof getVersion;
  /** Defaults to 5 seconds. Tests pass a smaller value. */
  timeoutMs?: number;
};

export function defaultSetupSnapshotDeps(): SetupSnapshotDeps {
  return {
    loadConfig,
    discoverDocs,
    detectAgents,
    getSkillStatus,
    getMcpStatus,
    getIndexStatus,
    getEmbedServerStatus,
    listInstalledModules,
    findStrayArtifacts,
    checkForUpdate,
    getVersion,
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback()), ms);
  });
  const guarded = promise.then(
    (value) => value,
    () => fallback(),
  );
  try {
    return await Promise.race([guarded, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function defaultSources(): Record<string, ConfigSource> {
  const sources: Record<string, ConfigSource> = {
    "git.branchMode": "default",
    "git.commitEachPhase": "default",
    "git.branchPrefix": "default",
    "search.enabled": "default",
    "search.extraDirs": "default",
  };
  for (const type of ARTIFACT_TYPES) {
    sources[`paths.${type}`] = "default";
  }
  return sources;
}

function defaultEffective(): EffectiveConfig {
  return {
    paths: { ...DEFAULT_ARTIFACT_PATHS },
    models: {},
    instructions: [],
    git: { ...DEFAULT_GIT },
    search: { ...DEFAULT_SEARCH },
  };
}

function defaultLoaded(repoRoot: string): LoadedConfig {
  const layers = {} as LoadedConfig["layers"];
  for (const layer of CONFIG_LAYERS) {
    layers[layer] = {
      layer,
      path: layerPath(layer, repoRoot),
      exists: false,
      value: null,
      error: null,
      ignoredKeys: [],
    };
  }
  return {
    layers,
    effective: defaultEffective(),
    sources: defaultSources(),
    pathErrors: [],
  };
}

function unknownMcp(agents: AgentKind[]): SetupSnapshot["mcp"] {
  return agents.map((agent) => ({
    agent,
    state: "unknown" as const,
    detail: "Status check timed out",
  }));
}

function missingIndex(repoRoot: string): IndexStatus {
  return {
    path: indexPathForRepo(repoRoot),
    exists: false,
    files: 0,
    chunks: 0,
    updatedAt: null,
    modelId: null,
    stale: true,
  };
}

function embedView(status: EmbedServerStatus): SetupSnapshot["search"]["embed"] {
  return {
    running: status.running,
    port: status.port,
    idleMinutes: status.idleMinutes,
    lastUsedAt: status.lastUsedAt,
    assets: status.assets,
    cacheDir: status.cacheDir,
  };
}

function embedFallback(): SetupSnapshot["search"]["embed"] {
  return {
    running: false,
    port: null,
    idleMinutes: DEFAULT_EMBED_IDLE_MINUTES,
    lastUsedAt: null,
    assets: { serverBinary: false, model: false },
    cacheDir: "",
  };
}

async function dirExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function countDocs(docs: ShipperDoc[], type: DocType): { open: number; done: number; total: number } {
  let open = 0;
  let done = 0;
  let total = 0;
  for (const doc of docs) {
    if (doc.type !== type) continue;
    total += 1;
    if (doc.status === "open") open += 1;
    else if (doc.status === "done") done += 1;
  }
  return { open, done, total };
}

function updateView(notice: UpdateNotice | null): SetupSnapshot["update"] {
  if (!notice) return null;
  return { latest: notice.latest, installCommand: notice.installCommand };
}

export async function collectSetupSnapshot(
  repoRoot: string,
  deps: SetupSnapshotDeps = defaultSetupSnapshotDeps(),
): Promise<SetupSnapshot> {
  const timeoutMs = deps.timeoutMs ?? COLLECT_TIMEOUT_MS;
  const loaded = await withTimeout(deps.loadConfig(repoRoot), timeoutMs, () =>
    defaultLoaded(repoRoot),
  );
  const effective = loaded.effective;
  const dirs = resolveArtifactDirs(repoRoot, effective);

  const [docs, detected, strayArtifacts, notice, embedStatus, modules] = await Promise.all([
    withTimeout(deps.discoverDocs(repoRoot, { config: effective }), timeoutMs, () => []),
    withTimeout(deps.detectAgents(), timeoutMs, () => []),
    withTimeout(deps.findStrayArtifacts(repoRoot, effective), timeoutMs, () => []),
    withTimeout(deps.checkForUpdate(), timeoutMs, () => null),
    withTimeout(deps.getEmbedServerStatus(), timeoutMs, () => null),
    withTimeout(deps.listInstalledModules(dirs.modules), timeoutMs, () => []),
  ]);

  const detectedKinds = detected.map((agent) => agent.kind);
  const [skills, mcp, index, exists] = await Promise.all([
    withTimeout(deps.getSkillStatus(detectedKinds), timeoutMs, () => []),
    withTimeout(deps.getMcpStatus(detectedKinds), timeoutMs, () => unknownMcp(detectedKinds)),
    withTimeout(deps.getIndexStatus(repoRoot, docs), timeoutMs, () => missingIndex(repoRoot)),
    Promise.all(ARTIFACT_TYPES.map((type) => dirExists(dirs[type]))),
  ]);

  const detectedByKind = new Map(detected.map((agent) => [agent.kind, agent]));
  const artifacts = ARTIFACT_TYPES.map((type, indexInList) => {
    const dir = effective.paths[type];
    const directoryExists = exists[indexInList] ?? false;
    if (type === "modules") {
      return {
        type,
        dir,
        exists: directoryExists,
        open: null,
        done: null,
        total: modules.length,
      };
    }
    if (type === "reviews") {
      return {
        type,
        dir,
        exists: directoryExists,
        open: null,
        done: null,
        total: countDocs(docs, "review").total,
      };
    }
    const docType = DOC_TYPE_BY_ARTIFACT[type];
    const counts = countDocs(docs, docType);
    return {
      type,
      dir,
      exists: directoryExists,
      open: counts.open,
      done: counts.done,
      total: counts.total,
    };
  });

  return {
    repoRoot,
    version: deps.getVersion(),
    update: updateView(notice),
    config: {
      layers: loaded.layers,
      effective,
      sources: loaded.sources,
      pathErrors: loaded.pathErrors,
    },
    artifacts,
    strayArtifacts,
    modules,
    agents: AGENT_KINDS.map((kind) => {
      const found = detectedByKind.get(kind);
      return {
        kind,
        detected: found !== undefined,
        version: found?.version ?? null,
        binary: found?.binary ?? null,
      };
    }),
    skills,
    mcp,
    search: {
      index,
      embed: embedStatus ? embedView(embedStatus) : embedFallback(),
    },
    collectedAt: new Date().toISOString(),
  };
}
