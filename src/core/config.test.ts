import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_EMBED_IDLE_MINUTES } from "../constants.ts";
import {
  CONFIG_LAYERS,
  DEFAULT_ARTIFACT_PATHS,
  DEFAULT_GIT,
  DEFAULT_SEARCH,
  validateArtifactDir,
} from "../shared/config-schema.ts";
import {
  getEmbedIdleMinutes,
  getUpdateCheckState,
  globalConfigPath,
  loadConfig,
  localConfigPath,
  migrateGlobalConfig,
  repoConfigPath,
  setEmbedIdleMinutes,
  setUpdateCheckState,
  writeLayer,
} from "./config.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("layered config", () => {
  let previousHome: string | undefined;
  let previousXdg: string | undefined;
  let homeDir: string;
  let xdgDir: string;
  let repoDir: string;

  beforeEach(async () => {
    previousHome = process.env["HOME"];
    previousXdg = process.env["XDG_CONFIG_HOME"];
    homeDir = await mkdtemp(join(tmpdir(), "shipper-config-home-"));
    xdgDir = await mkdtemp(join(tmpdir(), "shipper-config-xdg-"));
    repoDir = await mkdtemp(join(tmpdir(), "shipper-config-repo-"));
    process.env["HOME"] = homeDir;
    process.env["XDG_CONFIG_HOME"] = xdgDir;
  });

  afterEach(async () => {
    if (previousHome === undefined) {
      delete process.env["HOME"];
    } else {
      process.env["HOME"] = previousHome;
    }
    if (previousXdg === undefined) {
      delete process.env["XDG_CONFIG_HOME"];
    } else {
      process.env["XDG_CONFIG_HOME"] = previousXdg;
    }
    if (homeDir) await rm(homeDir, { recursive: true, force: true });
    if (xdgDir) await rm(xdgDir, { recursive: true, force: true });
    if (repoDir) await rm(repoDir, { recursive: true, force: true });
  });

  async function writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }

  it("uses defaults when no files exist", async () => {
    const loaded = await loadConfig(repoDir);
    expect(loaded.effective.paths).toEqual(DEFAULT_ARTIFACT_PATHS);
    expect(loaded.effective.git).toEqual(DEFAULT_GIT);
    expect(loaded.effective.search).toEqual(DEFAULT_SEARCH);
    expect(loaded.effective.models).toEqual({});
    expect(loaded.effective.instructions).toEqual([]);
    expect(loaded.pathErrors).toEqual([]);
    expect(Object.values(loaded.sources).every((source) => source === "default")).toBe(true);
    expect(Object.keys(loaded.sources).sort()).toEqual(
      [
        "git.branchMode",
        "git.branchPrefix",
        "git.commitEachPhase",
        "paths.bugs",
        "paths.modules",
        "paths.plans",
        "paths.reviews",
        "paths.spikes",
        "search.enabled",
        "search.extraDirs",
      ].sort(),
    );
    for (const layer of CONFIG_LAYERS) {
      expect(loaded.layers[layer].exists).toBe(false);
      expect(loaded.layers[layer].error).toBeNull();
      expect(loaded.layers[layer].value).toBeNull();
    }
  });

  it("applies global < repo < local for the same fields", async () => {
    await writeJson(globalConfigPath(), {
      git: { branchMode: "current" },
      models: { cursor: { "shipper-build": "global-model" } },
      search: { enabled: true },
    });
    await writeJson(repoConfigPath(repoDir), {
      git: { branchMode: "feature" },
      models: { cursor: { "shipper-build": "repo-model" } },
      search: { enabled: true },
    });
    await writeJson(localConfigPath(repoDir), {
      git: { branchMode: "current" },
      models: { cursor: { "shipper-build": "local-model" } },
      search: { enabled: false },
    });

    const loaded = await loadConfig(repoDir);
    expect(loaded.effective.git.branchMode).toBe("current");
    expect(loaded.sources["git.branchMode"]).toBe("local");
    expect(loaded.effective.models.cursor?.["shipper-build"]).toBe("local-model");
    expect(loaded.sources["models.cursor.shipper-build"]).toBe("local");
    expect(loaded.effective.search.enabled).toBe(false);
    expect(loaded.sources["search.enabled"]).toBe("local");
  });

  it("merges git fields independently and keeps lower-layer values", async () => {
    await writeJson(repoConfigPath(repoDir), {
      git: { branchPrefix: "feat/", branchMode: "feature" },
      models: { cursor: { "shipper-build": "repo-model" } },
      hello: 1,
    });
    await writeJson(localConfigPath(repoDir), {
      git: { commitEachPhase: false },
      models: { cursor: { "shipper-plan": "local-plan" } },
    });

    const loaded = await loadConfig(repoDir);
    expect(loaded.effective.git).toEqual({
      branchMode: "feature",
      commitEachPhase: false,
      branchPrefix: "feat/",
    });
    expect(loaded.sources["git.branchPrefix"]).toBe("repo");
    expect(loaded.sources["git.branchMode"]).toBe("repo");
    expect(loaded.sources["git.commitEachPhase"]).toBe("local");
    expect(loaded.effective.models.cursor).toEqual({
      "shipper-build": "repo-model",
      "shipper-plan": "local-plan",
    });
    expect(loaded.layers.repo.value).toMatchObject({ hello: 1 });
  });

  it("replaces search.extraDirs instead of concatenating", async () => {
    await writeJson(globalConfigPath(), { search: { extraDirs: ["docs/a", "docs/a/"] } });
    await writeJson(repoConfigPath(repoDir), {
      search: { extraDirs: ["../nope", "docs/adr/", "a\\b"] },
    });

    const loaded = await loadConfig(repoDir);
    expect(loaded.effective.search.extraDirs).toEqual(["docs/adr"]);
    expect(loaded.sources["search.extraDirs"]).toBe("repo");
    expect(loaded.pathErrors.some((error) => error.includes("../nope"))).toBe(true);
    expect(loaded.pathErrors.some((error) => error.includes("a\\b"))).toBe(true);
  });

  it("ignores paths in the global and local files", async () => {
    await writeJson(globalConfigPath(), {
      paths: { plans: "docs/global-plans" },
      git: { branchMode: "feature" },
      custom: true,
    });
    await writeJson(repoConfigPath(repoDir), {
      paths: { bugs: "docs/bugs/" },
    });
    await writeJson(localConfigPath(repoDir), {
      paths: { spikes: "docs/local-spikes" },
    });

    const loaded = await loadConfig(repoDir);
    expect(loaded.layers.global.ignoredKeys).toEqual(["paths"]);
    expect(loaded.layers.local.ignoredKeys).toEqual(["paths"]);
    expect(loaded.layers.repo.ignoredKeys).toEqual([]);
    expect(loaded.layers.global.value).toMatchObject({
      paths: { plans: "docs/global-plans" },
      custom: true,
    });
    expect(loaded.effective.paths.plans).toBe(DEFAULT_ARTIFACT_PATHS.plans);
    expect(loaded.effective.paths.spikes).toBe(DEFAULT_ARTIFACT_PATHS.spikes);
    expect(loaded.effective.paths.bugs).toBe("docs/bugs");
    expect(loaded.sources["paths.plans"]).toBe("default");
    expect(loaded.sources["paths.bugs"]).toBe("repo");
    expect(loaded.effective.git.branchMode).toBe("feature");
  });

  it("falls back to default paths when a repo path is invalid or duplicated", async () => {
    await writeJson(repoConfigPath(repoDir), {
      paths: {
        plans: "../x",
        spikes: "/abs",
        bugs: ".git/x",
        reviews: "docs/same",
        modules: "docs/same/",
      },
    });

    const loaded = await loadConfig(repoDir);
    expect(loaded.effective.paths.plans).toBe(DEFAULT_ARTIFACT_PATHS.plans);
    expect(loaded.effective.paths.spikes).toBe(DEFAULT_ARTIFACT_PATHS.spikes);
    expect(loaded.effective.paths.bugs).toBe(DEFAULT_ARTIFACT_PATHS.bugs);
    expect(loaded.effective.paths.reviews).toBe("docs/same");
    expect(loaded.effective.paths.modules).toBe(DEFAULT_ARTIFACT_PATHS.modules);
    expect(loaded.sources["paths.reviews"]).toBe("repo");
    expect(loaded.sources["paths.modules"]).toBe("default");
    expect(loaded.pathErrors.length).toBeGreaterThanOrEqual(4);
    expect(loaded.effective.git.branchPrefix).toBe("shipper/");
  });

  it("normalizes relative paths", () => {
    expect(validateArtifactDir("docs/plans/")).toEqual({ ok: true, dir: "docs/plans" });
    expect(validateArtifactDir("./a/../b")).toEqual({ ok: true, dir: "b" });
    expect(validateArtifactDir("x/node_modules").ok).toBe(false);
    expect(validateArtifactDir("a\\b").ok).toBe(false);
  });

  it("orders instructions global, repo, then local, with all before each skill", async () => {
    await writeJson(globalConfigPath(), {
      instructions: { "shipper-plan": "g-plan", all: "g-all" },
    });
    await writeJson(repoConfigPath(repoDir), {
      instructions: { all: "r-all", "shipper-bug": "" },
    });
    await writeJson(localConfigPath(repoDir), {
      instructions: { "shipper-plan": "l-plan", all: "l-all" },
    });

    const loaded = await loadConfig(repoDir);
    expect(loaded.effective.instructions).toEqual([
      { layer: "global", scope: "all", text: "g-all" },
      { layer: "global", scope: "shipper-plan", text: "g-plan" },
      { layer: "repo", scope: "all", text: "r-all" },
      { layer: "local", scope: "all", text: "l-all" },
      { layer: "local", scope: "shipper-plan", text: "l-plan" },
    ]);
  });

  it("treats invalid JSON and schema failures as an empty layer", async () => {
    await writeJson(globalConfigPath(), { git: { branchPrefix: "global/" } });
    await mkdir(join(repoDir, ".shipper"), { recursive: true });
    await writeFile(repoConfigPath(repoDir), "{", "utf8");
    await writeJson(localConfigPath(repoDir), { git: { branchMode: "sideways" } });

    const loaded = await loadConfig(repoDir);
    expect(loaded.layers.repo.exists).toBe(true);
    expect(loaded.layers.repo.value).toBeNull();
    expect(loaded.layers.repo.error).toMatch(/JSON/i);
    expect(loaded.layers.local.exists).toBe(true);
    expect(loaded.layers.local.value).toBeNull();
    expect(loaded.layers.local.error).toBeTruthy();
    expect(loaded.effective.git.branchPrefix).toBe("global/");
    expect(loaded.sources["git.branchPrefix"]).toBe("global");
    expect(loaded.effective.git.branchMode).toBeNull();
    expect(loaded.sources["git.branchMode"]).toBe("default");
  });

  it("preserves unknown keys and global machine keys when writing", async () => {
    await writeJson(globalConfigPath(), {
      custom: 1,
      models: { cursor: { "shipper-plan": "will-be-replaced" } },
      embeddings: { idleMinutes: 4, extra: true },
      state: { lastUpdateCheckAt: 9, latestKnownVersion: "1.2.3" },
      git: { branchPrefix: "old/" },
    });

    const globalLayer = await writeLayer("global", repoDir, { git: { branchMode: "feature" } });
    expect(globalLayer.value).toMatchObject({
      custom: 1,
      embeddings: { idleMinutes: 4, extra: true },
      state: { lastUpdateCheckAt: 9, latestKnownVersion: "1.2.3" },
      git: { branchMode: "feature" },
    });
    expect(globalLayer.value).not.toHaveProperty("models");

    await writeJson(repoConfigPath(repoDir), {
      custom: { keep: true },
      git: { branchPrefix: "old/" },
    });
    const repoLayer = await writeLayer("repo", repoDir, { search: { enabled: false } });
    expect(repoLayer.value).toMatchObject({ custom: { keep: true }, search: { enabled: false } });
    expect(repoLayer.value).not.toHaveProperty("git");
  });

  it("creates .shipper/.gitignore when writing the local layer", async () => {
    await mkdir(join(repoDir, ".shipper"), { recursive: true });
    await writeFile(join(repoDir, ".shipper", ".gitignore"), "foo", "utf8");

    await writeLayer("local", repoDir, { git: { commitEachPhase: false } });
    const gitignore = join(repoDir, ".shipper", ".gitignore");
    expect(await readFile(gitignore, "utf8")).toBe("foo\nconfig.local.json\n");

    await writeLayer("local", repoDir, { git: { commitEachPhase: true } });
    expect(await readFile(gitignore, "utf8")).toBe("foo\nconfig.local.json\n");

    const written = JSON.parse(await readFile(localConfigPath(repoDir), "utf8")) as {
      git: { commitEachPhase: boolean };
    };
    expect(written.git.commitEachPhase).toBe(true);
  });

  it("rejects an invalid layer write", async () => {
    await expect(writeLayer("repo", repoDir, { git: { branchMode: "maybe" } })).rejects.toThrow(
      /branchMode/,
    );
    await expect(readFile(repoConfigPath(repoDir), "utf8")).rejects.toThrow();
  });

  it("migrates the legacy global file and is idempotent", async () => {
    await writeJson(globalConfigPath(), {
      projects: { "/tmp/foo": { agent: "cursor", lastPlan: "a.md" } },
      defaults: {
        agent: "claude",
        models: { cursor: { "shipper-plan": "composer-2.5" } },
        embeddings: { idleMinutes: 8 },
        lastUpdateCheckAt: 42,
        latestKnownVersion: "0.1.0",
        nickname: "dropped",
      },
      customFlag: true,
    });

    expect(await migrateGlobalConfig()).toBe(true);
    expect(await migrateGlobalConfig()).toBe(false);

    const written = JSON.parse(await readFile(globalConfigPath(), "utf8")) as Record<
      string,
      unknown
    >;
    expect(written.projects).toBeUndefined();
    expect(written.defaults).toBeUndefined();
    expect(written.customFlag).toBe(true);
    expect(written.models).toEqual({ cursor: { "shipper-plan": "composer-2.5" } });
    expect(written.embeddings).toEqual({ idleMinutes: 8 });
    expect(written.state).toEqual({ lastUpdateCheckAt: 42, latestKnownVersion: "0.1.0" });
    expect(await getEmbedIdleMinutes()).toBe(8);
    expect(await getUpdateCheckState()).toEqual({ lastCheckAt: 42, latestKnown: "0.1.0" });
  });

  it("keeps a new-shape value when it conflicts with the legacy file", async () => {
    await writeJson(globalConfigPath(), {
      models: { cursor: { "shipper-build": "from-new" } },
      state: { lastUpdateCheckAt: 7 },
      defaults: {
        models: { cursor: { "shipper-build": "from-legacy" } },
        embeddings: { idleMinutes: 3 },
        lastUpdateCheckAt: 99,
        latestKnownVersion: "2.0.0",
      },
    });

    expect(await migrateGlobalConfig()).toBe(true);
    const written = JSON.parse(await readFile(globalConfigPath(), "utf8")) as {
      models: { cursor: { "shipper-build": string } };
      embeddings: { idleMinutes: number };
      state: { lastUpdateCheckAt: number; latestKnownVersion: string };
    };
    expect(written.models.cursor["shipper-build"]).toBe("from-new");
    expect(written.embeddings).toEqual({ idleMinutes: 3 });
    expect(written.state).toEqual({ lastUpdateCheckAt: 7, latestKnownVersion: "2.0.0" });
  });

  it("round-trips embed idle minutes without dropping other settings", async () => {
    expect(await getEmbedIdleMinutes()).toBe(DEFAULT_EMBED_IDLE_MINUTES);
    await writeJson(globalConfigPath(), {
      models: { cursor: { "shipper-plan": "composer-2.5" } },
    });
    await setEmbedIdleMinutes(7);
    expect(await getEmbedIdleMinutes()).toBe(7);
    const written = JSON.parse(await readFile(globalConfigPath(), "utf8")) as {
      models: { cursor: { "shipper-plan": string } };
      embeddings: { idleMinutes: number };
    };
    expect(written.embeddings.idleMinutes).toBe(7);
    expect(written.models.cursor["shipper-plan"]).toBe("composer-2.5");
    await expect(setEmbedIdleMinutes(0)).rejects.toThrow(/positive integer/);
    await expect(setEmbedIdleMinutes(-1)).rejects.toThrow(/positive integer/);
  });

  it("round-trips update-check state in the new location", async () => {
    await setUpdateCheckState({ lastCheckAt: 10, latestKnown: "9.9.9" });
    expect(await getUpdateCheckState()).toEqual({ lastCheckAt: 10, latestKnown: "9.9.9" });
    await setUpdateCheckState({ lastCheckAt: 11 });
    expect(await getUpdateCheckState()).toEqual({ lastCheckAt: 11, latestKnown: "9.9.9" });
    const written = JSON.parse(await readFile(globalConfigPath(), "utf8")) as {
      state: { lastUpdateCheckAt: number; latestKnownVersion: string };
      defaults?: unknown;
    };
    expect(written.defaults).toBeUndefined();
    expect(written.state).toEqual({ lastUpdateCheckAt: 11, latestKnownVersion: "9.9.9" });
  });

  it("prints config as JSON and lists the three paths", async () => {
    await mkdir(join(repoDir, ".shipper"), { recursive: true });
    await writeJson(repoConfigPath(repoDir), { git: { branchPrefix: "feat/" } });
    const env = {
      ...process.env,
      HOME: homeDir,
      XDG_CONFIG_HOME: xdgDir,
    };

    const shown = await runCli(["--dir", repoDir, "config", "--json"], env);
    expect(shown.status).toBe(0);
    const parsed = JSON.parse(shown.stdout) as {
      effective: { git: { branchPrefix: string } };
      sources: Record<string, string>;
      pathErrors: unknown[];
    };
    expect(parsed.effective.git.branchPrefix).toBe("feat/");
    expect(parsed.sources["git.branchPrefix"]).toBe("repo");
    expect(parsed.pathErrors).toEqual([]);

    const paths = await runCli(["--dir", repoDir, "config", "path"], env);
    expect(paths.status).toBe(0);
    const lines = paths.stdout.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(`global\t${globalConfigPath()}`);
    expect(lines[1]?.startsWith("repo\t")).toBe(true);
    expect(lines[1]).toContain("config.json");
    expect(lines[2]?.startsWith("local\t")).toBe(true);
    expect(lines[2]).toContain("config.local.json");
  });
});

function runCli(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("bun", ["run", "src/index.ts", ...args], {
      cwd: repoRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}
