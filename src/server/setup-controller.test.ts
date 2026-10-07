import { describe, expect, it } from "vitest";
import type { Embedder } from "../embeddings/client.ts";
import type { LayerState } from "../core/config.ts";
import { groupModelFamilies } from "../agents/model-variants.ts";
import {
  ARTIFACT_TYPES,
  CONFIG_LAYERS,
  DEFAULT_ARTIFACT_PATHS,
  DEFAULT_GIT,
  DEFAULT_SEARCH,
  type ConfigLayer,
  type ConfigSource,
} from "../shared/config-schema.ts";
import type { ServerMessage, SetupSnapshot } from "../shared/protocol.ts";
import { createSetupController, type SetupControllerDeps } from "./setup-controller.ts";

const embedder: Embedder = {
  modelId: "test",
  dims: 1,
  embedDocuments: async () => [],
  embedQuery: async () => new Float32Array([0]),
};

function sources(): Record<string, ConfigSource> {
  const out: Record<string, ConfigSource> = {
    "git.branchMode": "default",
    "git.commitEachPhase": "default",
    "git.branchPrefix": "default",
    "search.enabled": "default",
    "search.extraDirs": "default",
  };
  for (const type of ARTIFACT_TYPES) out[`paths.${type}`] = "default";
  return out;
}

function fixtureSnapshot(): SetupSnapshot {
  const layers = {} as SetupSnapshot["config"]["layers"];
  for (const layer of CONFIG_LAYERS) {
    layers[layer] = {
      layer,
      path: `/tmp/${layer}.json`,
      exists: false,
      value: null,
      error: null,
      ignoredKeys: [],
    };
  }
  return {
    repoRoot: "/tmp/shipper-controller",
    version: "0.0.0-test",
    update: null,
    config: {
      layers,
      effective: {
        paths: { ...DEFAULT_ARTIFACT_PATHS },
        models: {},
        instructions: [],
        git: { ...DEFAULT_GIT },
        search: { ...DEFAULT_SEARCH },
      },
      sources: sources(),
      pathErrors: [],
    },
    artifacts: [],
    strayArtifacts: [],
    modules: [],
    agents: [],
    skills: [],
    mcp: [],
    search: {
      index: {
        path: "/tmp/index.idx",
        exists: false,
        files: 0,
        chunks: 0,
        updatedAt: null,
        modelId: null,
        stale: true,
      },
      embed: {
        running: false,
        port: null,
        idleMinutes: 15,
        lastUsedAt: null,
        assets: { serverBinary: false, model: false },
        cacheDir: "/tmp/cache",
      },
    },
    collectedAt: "2026-01-01T00:00:00.000Z",
  };
}

function layerState(layer: ConfigLayer): LayerState {
  return {
    layer,
    path: `/tmp/${layer}.json`,
    exists: true,
    value: {},
    error: null,
    ignoredKeys: [],
  };
}

function harness(overrides: Partial<SetupControllerDeps> = {}) {
  const messages: ServerMessage[] = [];
  let collects = 0;
  const controller = createSetupController({
    repoRoot: "/tmp/shipper-controller",
    broadcast: (msg) => {
      messages.push(structuredClone(msg));
    },
    deps: {
      collectSetupSnapshot: async () => {
        collects += 1;
        return fixtureSnapshot();
      },
      createWatcher: () => ({ close: async () => {} }),
      detectAgents: async () => [],
      clearAgentDetectionCache: () => {},
      installSkillsGlobally: async () => [],
      installMcp: async () => [],
      uninstallMcp: async () => [],
      syncIndex: async () => {
        throw new Error("syncIndex was not stubbed");
      },
      createLlamaEmbedder: () => embedder,
      ensureEmbedServer: async () => {
        throw new Error("ensureEmbedServer was not stubbed");
      },
      stopEmbedServer: async () => {
        throw new Error("stopEmbedServer was not stubbed");
      },
      getEmbedIdleMinutes: async () => 15,
      loadConfig: async () => ({ effective: { search: { enabled: true } } }),
      listModels: async () => [],
      groupModelFamilies,
      writeLayer: async (layer) => layerState(layer),
      ...overrides,
    },
  });
  return { controller, messages, collects: () => collects };
}

describe("setup controller", () => {
  it("saves a layer and broadcasts the result plus a fresh snapshot", async () => {
    const written: unknown[] = [];
    const { controller, messages } = harness({
      writeLayer: async (layer, _repo, value) => {
        written.push({ layer, value });
        return layerState(layer);
      },
    });
    await controller.start();
    messages.length = 0;

    await controller.handleClientMessage({
      type: "save-config",
      layer: "repo",
      value: { paths: { plans: "docs/plans" }, git: { branchMode: "feature" } },
    });

    expect(written).toEqual([
      {
        layer: "repo",
        value: { paths: { plans: "docs/plans" }, git: { branchMode: "feature" } },
      },
    ]);
    expect(messages.map((msg) => msg.type)).toEqual(["save-result", "setup"]);
    expect(messages[0]).toMatchObject({ type: "save-result", layer: "repo", ok: true, error: null });
  });

  it("reports validation failures and rejects paths on the local and global layers", async () => {
    let writes = 0;
    const { controller, messages } = harness({
      writeLayer: async (layer) => {
        writes += 1;
        if (layer === "repo") {
          throw new Error("branchPrefix is invalid");
        }
        return layerState(layer);
      },
    });
    await controller.start();

    await controller.handleClientMessage({
      type: "save-config",
      layer: "repo",
      value: { git: { branchPrefix: "bad prefix" } },
    });
    await controller.handleClientMessage({
      type: "save-config",
      layer: "local",
      value: { paths: { plans: "docs/plans" }, git: { commitEachPhase: false } },
    });
    await controller.handleClientMessage({
      type: "save-config",
      layer: "global",
      value: { paths: { plans: "docs/plans" } },
    });

    expect(writes).toBe(1);
    const saves = messages.filter((msg) => msg.type === "save-result");
    expect(saves[0]).toMatchObject({
      layer: "repo",
      ok: false,
      error: "branchPrefix is invalid",
    });
    expect(saves[1]).toMatchObject({ layer: "local", ok: false });
    expect(saves[2]).toMatchObject({ layer: "global", ok: false });
    if (saves[1]?.type === "save-result") {
      expect(saves[1].error).toContain("repo config");
    }
  });

  it("runs one action at a time and broadcasts running, done, then setup", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let syncs = 0;
    let stops = 0;
    const { controller, messages } = harness({
      syncIndex: () => {
        syncs += 1;
        return gate.then(() => ({ stats: { files: 4, chunks: 9 } }));
      },
      stopEmbedServer: async () => {
        stops += 1;
        return { wasRunning: true };
      },
    });
    await controller.start();
    messages.length = 0;

    const first = controller.handleClientMessage({
      type: "run-action",
      action: { kind: "sync-index", force: false },
    });
    const second = controller.handleClientMessage({
      type: "run-action",
      action: { kind: "stop-embed" },
    });

    expect(messages.map((msg) => msg.type)).toEqual(["action-status", "notice"]);
    expect(messages[0]).toMatchObject({
      type: "action-status",
      action: { state: "running", progress: null, action: { kind: "sync-index", force: false } },
    });
    expect(messages[1]).toEqual({ type: "notice", text: "Another action is running." });
    expect(stops).toBe(0);

    await second;
    expect(syncs).toBe(1);

    release();
    await first;
    await second;

    const types = messages.map((msg) => msg.type);
    expect(types).toEqual(["action-status", "notice", "action-status", "setup"]);
    expect(messages[2]).toMatchObject({
      type: "action-status",
      action: { state: "done", message: "Indexed 4 files (9 chunks)." },
    });
    expect(messages[3]).toMatchObject({ type: "setup", action: { state: "done" } });
  });

  it("refuses to sync the index when search is disabled", async () => {
    let syncs = 0;
    const { controller, messages } = harness({
      loadConfig: async () => ({ effective: { search: { enabled: false } } }),
      syncIndex: async () => {
        syncs += 1;
        return { stats: { files: 0, chunks: 0 } };
      },
    });
    await controller.start();
    messages.length = 0;

    await controller.handleClientMessage({
      type: "run-action",
      action: { kind: "sync-index", force: true },
    });

    expect(syncs).toBe(0);
    expect(messages[0]).toMatchObject({ type: "action-status", action: { state: "running" } });
    expect(messages[1]).toMatchObject({
      type: "action-status",
      action: { state: "error", message: "Search is disabled for this repository." },
    });
    expect(messages.at(-1)?.type).toBe("setup");
  });

  it("maps list-models into family and variant ids", async () => {
    const { controller, messages } = harness({
      listModels: async (agent) => {
        expect(agent).toBe("cursor");
        return [
          { id: "composer-2.5", label: "Composer 2.5" },
          { id: "composer-2.5-fast", label: "Composer 2.5 Fast" },
        ];
      },
    });

    await controller.handleClientMessage({ type: "list-models", agent: "cursor" });

    expect(messages).toHaveLength(1);
    const msg = messages[0];
    expect(msg?.type).toBe("models-list");
    if (msg?.type !== "models-list") return;
    expect(msg.agent).toBe("cursor");
    expect(msg.families).toHaveLength(1);
    expect(msg.families[0]?.id).toBe("composer-2.5");
    expect(msg.families[0]?.variants.map((variant) => variant.id)).toEqual([
      "composer-2.5",
      "composer-2.5-fast",
    ]);
    expect(Object.keys(msg.families[0]?.variants[0] ?? {})).toEqual(["id", "label"]);
  });

  it("sends a notice when listing models fails", async () => {
    const { controller, messages } = harness({
      listModels: async () => {
        throw new Error("opencode is not running");
      },
    });
    await controller.handleClientMessage({ type: "list-models", agent: "opencode" });
    expect(messages).toEqual([{ type: "notice", text: "opencode is not running" }]);
  });
});
