import { watch } from "chokidar";
import { groupModelFamilies } from "../agents/model-variants.ts";
import { detectAgents, clearAgentDetectionCache } from "../agents/detect.ts";
import { listModels } from "../agents/models.ts";
import type { AgentKind } from "../agents/types.ts";
import { resolveArtifactDirs } from "../core/artifact-paths.ts";
import {
  getEmbedIdleMinutes,
  globalConfigPath,
  loadConfig,
  localConfigPath,
  repoConfigPath,
  writeLayer,
} from "../core/config.ts";
import { installSkillsGlobally } from "../core/skills.ts";
import { formatProgress } from "../embeddings/assets.ts";
import { createLlamaEmbedder, type Embedder } from "../embeddings/client.ts";
import { ensureEmbedServer, stopEmbedServer } from "../embeddings/server-manager.ts";
import { installMcp, uninstallMcp } from "../mcp/install.ts";
import { formatIndexProgress, type IndexProgress } from "../search/index-progress.ts";
import { syncIndex } from "../search/indexer.ts";
import { ARTIFACT_TYPES, type ConfigLayer } from "../shared/config-schema.ts";
import type {
  ActionStatus,
  ClientMessage,
  ModelFamilyDto,
  ServerMessage,
  SetupAction,
  SetupSnapshot,
} from "../shared/protocol.ts";
import { collectSetupSnapshot, type SetupSnapshotDeps } from "./setup-snapshot.ts";

const WATCH_DEBOUNCE_MS = 300;
const PROGRESS_INTERVAL_MS = 250;

const PATHS_LAYER_ERROR =
  "Artifact paths can only be saved in the repo config (.shipper/config.json).";

export type SetupControllerDeps = {
  collectSetupSnapshot: (repoRoot: string) => Promise<SetupSnapshot>;
  writeLayer: typeof writeLayer;
  clearAgentDetectionCache: () => void;
  detectAgents: () => Promise<Array<{ kind: AgentKind }>>;
  installSkillsGlobally: (
    agents: AgentKind[],
  ) => Promise<Array<{ agent: AgentKind; root: string }>>;
  installMcp: (agents: AgentKind[]) => Promise<Array<{ detail: string }>>;
  uninstallMcp: (agents: AgentKind[]) => Promise<Array<{ detail: string }>>;
  syncIndex: (opts: {
    repoRoot: string;
    embedder: Embedder;
    force?: boolean;
    onProgress?: (progress: IndexProgress) => void;
  }) => Promise<{ stats: { files: number; chunks: number } }>;
  createLlamaEmbedder: () => Embedder;
  ensureEmbedServer: (opts?: {
    idleMinutes?: number;
    onProgress?: (received: number, total: number | null) => void;
  }) => Promise<unknown>;
  stopEmbedServer: () => Promise<{ wasRunning: boolean }>;
  getEmbedIdleMinutes: () => Promise<number>;
  listModels: typeof listModels;
  groupModelFamilies: typeof groupModelFamilies;
  loadConfig: (repoRoot: string) => Promise<{ effective: { search: { enabled: boolean } } }>;
  createWatcher: (paths: string[], onChange: () => void) => { close: () => Promise<void> };
  /** Passed through to the default snapshot collector. Ignored when collect is overridden. */
  snapshotDeps?: SetupSnapshotDeps;
};

export type SetupController = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  getSnapshotMessage: () => ServerMessage;
  handleClientMessage: (msg: ClientMessage) => Promise<void>;
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function watchConfigFiles(paths: string[], onChange: () => void): { close: () => Promise<void> } {
  const watcher = watch(paths, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    ignored: (filePath: string) => filePath.includes(".tmp-"),
  });
  watcher.on("all", () => {
    onChange();
  });
  watcher.on("error", () => {
    // A missing config directory is normal. Keep the server up.
  });
  return { close: () => watcher.close() };
}

function defaultControllerDeps(snapshotDeps?: SetupSnapshotDeps): SetupControllerDeps {
  return {
    collectSetupSnapshot: (repoRoot) =>
      collectSetupSnapshot(repoRoot, snapshotDeps ?? undefined),
    writeLayer,
    clearAgentDetectionCache,
    detectAgents,
    installSkillsGlobally,
    installMcp,
    uninstallMcp,
    syncIndex,
    createLlamaEmbedder: () => createLlamaEmbedder(),
    ensureEmbedServer,
    stopEmbedServer,
    getEmbedIdleMinutes,
    listModels,
    groupModelFamilies,
    loadConfig,
    createWatcher: watchConfigFiles,
    snapshotDeps,
  };
}

type ActionOutcome = { state: "done" | "error"; message: string };

function runningMessage(action: SetupAction): string {
  switch (action.kind) {
    case "refresh-skills":
      return "Refreshing skills…";
    case "install-mcp":
      return action.agent ? `Installing MCP for ${action.agent}…` : "Installing MCP…";
    case "uninstall-mcp":
      return action.agent ? `Uninstalling MCP for ${action.agent}…` : "Uninstalling MCP…";
    case "sync-index":
      return action.force ? "Rebuilding the search index…" : "Syncing the search index…";
    case "start-embed":
      return "Starting the embedding server…";
    case "stop-embed":
      return "Stopping the embedding server…";
  }
}

function watchPaths(repoRoot: string, snapshot: SetupSnapshot): string[] {
  const dirs = resolveArtifactDirs(repoRoot, snapshot.config.effective);
  return [
    globalConfigPath(),
    repoConfigPath(repoRoot),
    localConfigPath(repoRoot),
    ...ARTIFACT_TYPES.map((type) => dirs[type]),
  ];
}

type ProgressTap = {
  report: (text: string) => void;
  drain: () => void;
  cancel: () => void;
};

function createProgressTap(emit: (text: string) => void): ProgressTap {
  let last = 0;
  let pending: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    if (pending === null) return;
    const text = pending;
    pending = null;
    last = Date.now();
    emit(text);
  };

  return {
    report(text: string) {
      const now = Date.now();
      if (timer === null && now - last >= PROGRESS_INTERVAL_MS) {
        last = now;
        emit(text);
        return;
      }
      pending = text;
      if (timer === null) {
        const wait = Math.max(0, PROGRESS_INTERVAL_MS - (now - last));
        timer = setTimeout(flush, wait);
      }
    },
    drain() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      flush();
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}

export function createSetupController(opts: {
  repoRoot: string;
  broadcast: (msg: ServerMessage) => void;
  deps?: Partial<SetupControllerDeps>;
}): SetupController {
  const deps: SetupControllerDeps = {
    ...defaultControllerDeps(opts.deps?.snapshotDeps),
    ...opts.deps,
  };
  const { repoRoot, broadcast } = opts;

  let snapshot: SetupSnapshot | null = null;
  let currentAction: ActionStatus | null = null;
  let actionInFlight = false;
  let stopped = false;
  let watchKey = "";
  let watcher: { close: () => Promise<void> } | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const publishAction = (status: ActionStatus) => {
    currentAction = {
      ...status,
      action: { ...status.action },
    };
    broadcast({ type: "action-status", action: currentAction });
  };

  const getSnapshotMessage = (): ServerMessage => {
    if (!snapshot) {
      throw new Error("Setup controller has not started");
    }
    return { type: "setup", setup: snapshot, action: currentAction };
  };

  const recollect = async () => {
    snapshot = await deps.collectSetupSnapshot(repoRoot);
  };

  const rewatch = async () => {
    if (!snapshot || stopped) return;
    const paths = watchPaths(repoRoot, snapshot);
    const key = paths.join("\0");
    if (key === watchKey && watcher) return;
    watchKey = key;
    if (watcher) {
      await watcher.close();
      watcher = null;
    }
    if (stopped) return;
    watcher = deps.createWatcher(paths, scheduleRefresh);
  };

  const broadcastSetup = async () => {
    await recollect();
    if (stopped) return;
    await rewatch();
    if (stopped || !snapshot) return;
    broadcast(getSnapshotMessage());
  };

  function scheduleRefresh(): void {
    if (stopped) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void broadcastSetup();
    }, WATCH_DEBOUNCE_MS);
  }

  async function agentsFor(agent: AgentKind | undefined): Promise<AgentKind[]> {
    if (agent) return [agent];
    const detected = await deps.detectAgents();
    return detected.map((entry) => entry.kind);
  }

  async function execute(action: SetupAction, report: (text: string) => void): Promise<ActionOutcome> {
    switch (action.kind) {
      case "refresh-skills": {
        const detected = await deps.detectAgents();
        const kinds = detected.map((entry) => entry.kind);
        const summaries = await deps.installSkillsGlobally(kinds);
        if (summaries.length === 0) {
          return { state: "done", message: "No coding agents detected." };
        }
        const names = summaries.map((summary) => summary.agent).join(", ");
        return { state: "done", message: `Refreshed skills for ${names}.` };
      }
      case "install-mcp":
      case "uninstall-mcp": {
        const agents = await agentsFor(action.agent);
        if (agents.length === 0) {
          return { state: "error", message: "No coding agents detected." };
        }
        const results =
          action.kind === "install-mcp"
            ? await deps.installMcp(agents)
            : await deps.uninstallMcp(agents);
        return { state: "done", message: results.map((result) => result.detail).join("\n") };
      }
      case "sync-index": {
        const loaded = await deps.loadConfig(repoRoot);
        if (!loaded.effective.search.enabled) {
          return { state: "error", message: "Search is disabled for this repository." };
        }
        const result = await deps.syncIndex({
          repoRoot,
          embedder: deps.createLlamaEmbedder(),
          force: action.force,
          onProgress: (progress) => {
            report(formatIndexProgress(progress));
          },
        });
        return {
          state: "done",
          message: `Indexed ${result.stats.files} files (${result.stats.chunks} chunks).`,
        };
      }
      case "start-embed": {
        const idleMinutes = await deps.getEmbedIdleMinutes();
        await deps.ensureEmbedServer({
          idleMinutes,
          onProgress: (received, total) => {
            report(formatProgress("assets", received, total));
          },
        });
        return { state: "done", message: "Embedding server is running." };
      }
      case "stop-embed": {
        const { wasRunning } = await deps.stopEmbedServer();
        return {
          state: "done",
          message: wasRunning
            ? "Stopped the embedding server."
            : "Embedding server was not running.",
        };
      }
      default: {
        const exhaustive: never = action;
        return { state: "error", message: `Unknown action: ${String(exhaustive)}` };
      }
    }
  }

  async function runAction(action: SetupAction): Promise<void> {
    if (actionInFlight) {
      broadcast({ type: "notice", text: "Another action is running." });
      return;
    }
    actionInFlight = true;
    const status: ActionStatus = {
      id: crypto.randomUUID(),
      action,
      state: "running",
      message: runningMessage(action),
      progress: null,
    };
    publishAction(status);
    const progress = createProgressTap((text) => {
      status.progress = text;
      publishAction(status);
    });
    try {
      const outcome = await execute(action, progress.report);
      progress.drain();
      status.state = outcome.state;
      status.message = outcome.message;
    } catch (err) {
      progress.cancel();
      status.state = "error";
      status.message = errorMessage(err);
    } finally {
      progress.cancel();
      actionInFlight = false;
    }
    publishAction(status);
    try {
      await broadcastSetup();
    } catch (err) {
      broadcast({ type: "notice", text: errorMessage(err) });
    }
  }

  async function saveConfig(layer: ConfigLayer, value: unknown): Promise<void> {
    if ((layer === "local" || layer === "global") && isRecord(value) && "paths" in value) {
      broadcast({
        type: "save-result",
        layer,
        ok: false,
        error: PATHS_LAYER_ERROR,
      });
      return;
    }
    try {
      await deps.writeLayer(layer, repoRoot, value);
    } catch (err) {
      broadcast({
        type: "save-result",
        layer,
        ok: false,
        error: errorMessage(err),
      });
      return;
    }
    broadcast({ type: "save-result", layer, ok: true, error: null });
    try {
      await broadcastSetup();
    } catch (err) {
      broadcast({ type: "notice", text: errorMessage(err) });
    }
  }

  async function listModelFamilies(agent: AgentKind): Promise<void> {
    try {
      const models = await deps.listModels(agent);
      const families: ModelFamilyDto[] = deps.groupModelFamilies(models).map((family) => ({
        id: family.id,
        label: family.label,
        variants: family.variants.map((variant) => ({ id: variant.id, label: variant.label })),
      }));
      broadcast({ type: "models-list", agent, families });
    } catch (err) {
      broadcast({ type: "notice", text: errorMessage(err) });
    }
  }

  return {
    async start() {
      stopped = false;
      await recollect();
      await rewatch();
    },
    async stop() {
      stopped = true;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (watcher) {
        await watcher.close();
        watcher = null;
      }
      watchKey = "";
    },
    getSnapshotMessage,
    async handleClientMessage(msg) {
      switch (msg.type) {
        case "refresh":
          deps.clearAgentDetectionCache();
          currentAction = null;
          try {
            await broadcastSetup();
          } catch (err) {
            broadcast({ type: "notice", text: errorMessage(err) });
          }
          return;
        case "save-config":
          await saveConfig(msg.layer, msg.value);
          return;
        case "list-models":
          await listModelFamilies(msg.agent);
          return;
        case "run-action":
          await runAction(msg.action);
          return;
        default: {
          const exhaustive: never = msg;
          throw new Error(`Unknown client message: ${String(exhaustive)}`);
        }
      }
    },
  };
}
