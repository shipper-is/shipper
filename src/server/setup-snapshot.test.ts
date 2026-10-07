import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DetectedAgent } from "../agents/types.ts";
import type { LoadedConfig } from "../core/config.ts";
import type { EmbedServerStatus } from "../embeddings/server-manager.ts";
import type { ShipperDoc } from "../search/documents.ts";
import {
  ARTIFACT_TYPES,
  CONFIG_LAYERS,
  DEFAULT_ARTIFACT_PATHS,
  DEFAULT_GIT,
  DEFAULT_SEARCH,
  type ConfigSource,
} from "../shared/config-schema.ts";
import { collectSetupSnapshot, type SetupSnapshotDeps } from "./setup-snapshot.ts";

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

function loaded(repoRoot: string): LoadedConfig {
  const layers = {} as LoadedConfig["layers"];
  for (const layer of CONFIG_LAYERS) {
    layers[layer] = {
      layer,
      path:
        layer === "global"
          ? "/tmp/shipper-test/config.json"
          : join(repoRoot, ".shipper", layer === "repo" ? "config.json" : "config.local.json"),
      exists: false,
      value: null,
      error: null,
      ignoredKeys: [],
    };
  }
  return {
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
  };
}

function doc(
  relPath: string,
  type: ShipperDoc["type"],
  status: ShipperDoc["status"],
): ShipperDoc {
  return { relPath, absPath: relPath, type, status, mtimeMs: 1, size: 4 };
}

const embedStatus: EmbedServerStatus = {
  running: false,
  port: null,
  pid: null,
  modelId: null,
  llamaBuild: null,
  startedAt: null,
  idleMinutes: 15,
  lastUsedAt: null,
  assets: { serverBinary: false, model: false },
  cacheDir: "/tmp/shipper-cache",
};

function deps(overrides: Partial<SetupSnapshotDeps>): SetupSnapshotDeps {
  const base: SetupSnapshotDeps = {
    loadConfig: async (repoRoot) => loaded(repoRoot),
    discoverDocs: async () => [],
    detectAgents: async () => [],
    getSkillStatus: async () => [],
    getMcpStatus: async () => [],
    getIndexStatus: async () => ({
      path: "/tmp/index.idx",
      exists: false,
      files: 0,
      chunks: 0,
      updatedAt: null,
      modelId: null,
      stale: true,
    }),
    getEmbedServerStatus: async () => embedStatus,
    listInstalledModules: async () => [],
    findStrayArtifacts: async () => [],
    checkForUpdate: async () => null,
    getVersion: () => "9.9.9-test",
    timeoutMs: 50,
  };
  return { ...base, ...overrides };
}

describe("collectSetupSnapshot", () => {
  it("counts artifacts by type and ignores extra-dir docs", async () => {
    const repoRoot = await mkdirTemp();
    await mkdir(join(repoRoot, ".shipper", "plans"), { recursive: true });
    const docs: ShipperDoc[] = [
      doc(".shipper/plans/open/a.md", "plan", "open"),
      doc(".shipper/plans/open/b.md", "plan", "open"),
      doc(".shipper/spikes/done/s.md", "spike", "done"),
      doc(".shipper/reviews/r.md", "review", null),
      doc("docs/adr/one.md", "doc", null),
    ];
    let skillAgents: string[] = [];
    let mcpAgents: string[] = [];
    const detected: DetectedAgent[] = [
      { kind: "cursor", binary: "cursor-agent", version: "1.2.3" },
    ];

    const snapshot = await collectSetupSnapshot(
      repoRoot,
      deps({
        discoverDocs: async () => docs,
        detectAgents: async () => detected,
        getSkillStatus: async (agents) => {
          skillAgents = agents;
          return [];
        },
        getMcpStatus: async (agents) => {
          mcpAgents = agents;
          return agents.map((agent) => ({
            agent,
            state: "missing" as const,
            detail: "shipper is not registered",
          }));
        },
        listInstalledModules: async () => [
          { id: "alpha", name: "Alpha", version: "1" },
          { id: "beta", name: "Beta", version: null },
        ],
        findStrayArtifacts: async () => [{ type: "plans", dir: ".shipper/plans", count: 2 }],
      }),
    );

    const byType = new Map(snapshot.artifacts.map((entry) => [entry.type, entry]));
    expect(byType.get("plans")).toMatchObject({ open: 2, done: 0, total: 2, exists: true });
    expect(byType.get("spikes")).toMatchObject({ open: 0, done: 1, total: 1, exists: false });
    expect(byType.get("bugs")).toMatchObject({ open: 0, done: 0, total: 0 });
    expect(byType.get("reviews")).toMatchObject({ open: null, done: null, total: 1 });
    expect(byType.get("modules")).toMatchObject({ open: null, done: null, total: 2 });
    expect(snapshot.modules).toHaveLength(2);
    expect(snapshot.strayArtifacts).toEqual([{ type: "plans", dir: ".shipper/plans", count: 2 }]);
    expect(snapshot.agents.find((agent) => agent.kind === "cursor")).toMatchObject({
      detected: true,
      version: "1.2.3",
      binary: "cursor-agent",
    });
    expect(snapshot.agents.find((agent) => agent.kind === "claude")?.detected).toBe(false);
    expect(skillAgents).toEqual(["cursor"]);
    expect(mcpAgents).toEqual(["cursor"]);
    expect(snapshot.version).toBe("9.9.9-test");
    expect(snapshot.search.embed.running).toBe(false);
    await rmTemp(repoRoot);
  });

  it("returns unknown MCP status when the probe times out and still finishes", async () => {
    const snapshot = await collectSetupSnapshot(
      "/tmp/shipper-snapshot-timeout",
      deps({
        timeoutMs: 30,
        detectAgents: async () => [{ kind: "cursor", binary: "cursor-agent", version: "1" }],
        getMcpStatus: () => new Promise(() => {}),
        getSkillStatus: async () => {
          throw new Error("skill probe failed");
        },
        getEmbedServerStatus: () => new Promise(() => {}),
        checkForUpdate: () => new Promise(() => {}),
      }),
    );

    expect(snapshot.mcp).toEqual([
      { agent: "cursor", state: "unknown", detail: "Status check timed out" },
    ]);
    expect(snapshot.skills).toEqual([]);
    expect(snapshot.search.embed.running).toBe(false);
    expect(snapshot.search.embed.cacheDir).toBe("");
    expect(snapshot.update).toBeNull();
    expect(snapshot.repoRoot).toBe("/tmp/shipper-snapshot-timeout");
  });
});

async function mkdirTemp(): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  return mkdtemp(join(tmpdir(), "shipper-snapshot-"));
}

async function rmTemp(path: string): Promise<void> {
  const { rm } = await import("node:fs/promises");
  await rm(path, { recursive: true, force: true });
}
