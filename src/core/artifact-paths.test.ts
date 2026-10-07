import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_ARTIFACT_PATHS,
  DEFAULT_GIT,
  DEFAULT_SEARCH,
  type EffectiveConfig,
} from "../shared/config-schema.ts";
import { ensureArtifactDirs, findStrayArtifacts, resolveArtifactDirs } from "./artifact-paths.ts";

const temps: string[] = [];

afterEach(async () => {
  for (const dir of temps.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "shipper-artifact-paths-"));
  temps.push(root);
  return root;
}

function effectiveConfig(partial?: {
  paths?: Partial<EffectiveConfig["paths"]>;
}): EffectiveConfig {
  return {
    paths: { ...DEFAULT_ARTIFACT_PATHS, ...partial?.paths },
    models: {},
    instructions: [],
    git: { ...DEFAULT_GIT },
    search: { ...DEFAULT_SEARCH, extraDirs: [] },
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("resolveArtifactDirs", () => {
  it("returns absolute paths from the effective config", async () => {
    const repo = await makeRepo();
    const dirs = resolveArtifactDirs(
      repo,
      effectiveConfig({ paths: { plans: "docs/plans", modules: "vendor/modules" } }),
    );
    expect(dirs.plans).toBe(join(repo, "docs", "plans"));
    expect(dirs.spikes).toBe(join(repo, ".shipper", "spikes"));
    expect(dirs.modules).toBe(join(repo, "vendor", "modules"));
  });
});

describe("ensureArtifactDirs", () => {
  it("scaffolds open and done at configured paths and writes the gitignore", async () => {
    const repo = await makeRepo();
    await ensureArtifactDirs(
      repo,
      effectiveConfig({
        paths: { plans: "docs/plans", spikes: "docs/spikes", bugs: "docs/bugs" },
      }),
    );

    for (const type of ["plans", "spikes", "bugs"] as const) {
      expect(await exists(join(repo, "docs", type, "open"))).toBe(true);
      expect(await exists(join(repo, "docs", type, "done"))).toBe(true);
      expect(await exists(join(repo, ".shipper", type))).toBe(false);
    }
    expect(await exists(join(repo, ".shipper", "reviews"))).toBe(false);
    expect(await exists(join(repo, ".shipper", "modules"))).toBe(false);
    expect(await exists(join(repo, ".shipper", "config.json"))).toBe(false);
    expect(await exists(join(repo, ".shipper", "config.local.json"))).toBe(false);

    const gitignore = await readFile(join(repo, ".shipper", ".gitignore"), "utf8");
    expect(gitignore).toContain("config.local.json");
  });
});

describe("findStrayArtifacts", () => {
  it("counts markdown left in default dirs that are no longer configured", async () => {
    const repo = await makeRepo();
    await mkdir(join(repo, ".shipper", "plans", "open"), { recursive: true });
    await mkdir(join(repo, ".shipper", "plans", "done"), { recursive: true });
    await mkdir(join(repo, ".shipper", "spikes", "open"), { recursive: true });
    await mkdir(join(repo, ".shipper", "reviews"), { recursive: true });
    await writeFile(join(repo, ".shipper", "plans", "open", "a.md"), "# A\n", "utf8");
    await writeFile(join(repo, ".shipper", "plans", "done", "b.md"), "# B\n", "utf8");
    await writeFile(join(repo, ".shipper", "plans", "loose.md"), "# Loose\n", "utf8");
    await writeFile(join(repo, ".shipper", "plans", "notes.txt"), "skip", "utf8");
    await writeFile(join(repo, ".shipper", "spikes", "open", "s.md"), "# S\n", "utf8");
    await writeFile(join(repo, ".shipper", "reviews", "r.md"), "# R\n", "utf8");

    const strays = await findStrayArtifacts(
      repo,
      effectiveConfig({ paths: { plans: "docs/plans", reviews: "docs/reviews" } }),
    );
    expect(strays).toEqual([
      { type: "plans", dir: ".shipper/plans", count: 3 },
      { type: "reviews", dir: ".shipper/reviews", count: 1 },
    ]);
  });

  it("returns nothing when every type still uses its default directory", async () => {
    const repo = await makeRepo();
    await mkdir(join(repo, ".shipper", "plans", "open"), { recursive: true });
    await writeFile(join(repo, ".shipper", "plans", "open", "a.md"), "# A\n", "utf8");
    expect(await findStrayArtifacts(repo, effectiveConfig())).toEqual([]);
  });
});
