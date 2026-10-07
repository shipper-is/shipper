import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_ARTIFACT_PATHS,
  DEFAULT_GIT,
  DEFAULT_SEARCH,
  type EffectiveConfig,
} from "../shared/config-schema.ts";
import { discoverDocs, readDocMetadata } from "./documents.ts";

const temps: string[] = [];
let previousHome: string | undefined;
let previousXdgConfig: string | undefined;
let previousXdgCache: string | undefined;

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), "shipper-docs-home-"));
  temps.push(home);
  previousHome = process.env["HOME"];
  previousXdgConfig = process.env["XDG_CONFIG_HOME"];
  previousXdgCache = process.env["XDG_CACHE_HOME"];
  process.env["HOME"] = home;
  process.env["XDG_CONFIG_HOME"] = join(home, "config");
  process.env["XDG_CACHE_HOME"] = join(home, "cache");
});

afterEach(async () => {
  if (previousHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = previousHome;
  if (previousXdgConfig === undefined) delete process.env["XDG_CONFIG_HOME"];
  else process.env["XDG_CONFIG_HOME"] = previousXdgConfig;
  if (previousXdgCache === undefined) delete process.env["XDG_CACHE_HOME"];
  else process.env["XDG_CACHE_HOME"] = previousXdgCache;
  for (const dir of temps.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function configWith(partial?: {
  paths?: Partial<EffectiveConfig["paths"]>;
  extraDirs?: string[];
}): EffectiveConfig {
  return {
    paths: { ...DEFAULT_ARTIFACT_PATHS, ...partial?.paths },
    models: {},
    instructions: [],
    git: { ...DEFAULT_GIT },
    search: { ...DEFAULT_SEARCH, extraDirs: partial?.extraDirs ?? [] },
  };
}

async function makeRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "shipper-docs-"));
  temps.push(root);
  return root;
}

describe("discoverDocs", () => {
  it("discovers each typed artifact, legacy files, and skips symlink and non-md", async () => {
    const root = await makeRepo();
    const shipper = join(root, ".shipper");

    await mkdir(join(shipper, "plans", "open"), { recursive: true });
    await mkdir(join(shipper, "plans", "done"), { recursive: true });
    await mkdir(join(shipper, "spikes", "open"), { recursive: true });
    await mkdir(join(shipper, "bugs", "done"), { recursive: true });
    await mkdir(join(shipper, "reviews"), { recursive: true });
    await mkdir(join(shipper, "open"), { recursive: true });

    await writeFile(
      join(shipper, "plans", "open", "alpha.md"),
      "---\ntype: plan\nbranch: feature/a\n---\n\n# Alpha Plan\n",
      "utf8",
    );
    await writeFile(
      join(shipper, "spikes", "open", "beta.md"),
      "---\ntype: spike\n---\n\n# Beta Spike\n",
      "utf8",
    );
    await writeFile(
      join(shipper, "bugs", "done", "gamma.md"),
      "---\nseverity: high\nfixed_at: \"2026-01-01\"\n---\n\n# Gamma Bug\n",
      "utf8",
    );
    await writeFile(
      join(shipper, "reviews", "delta.md"),
      "---\ntype: review\nmerge_risk: low\n---\n\n# Delta Review\n",
      "utf8",
    );
    await writeFile(
      join(shipper, "open", "legacy.md"),
      "---\ntype: spike\n---\n\n# Legacy Spike\n",
      "utf8",
    );
    await writeFile(join(shipper, "plans", "open", "notes.txt"), "not markdown", "utf8");
    await symlink(
      join(shipper, "plans", "open", "alpha.md"),
      join(shipper, "plans", "open", "link.md"),
    );

    const found: number[] = [];
    const docs = await discoverDocs(root, {
      onFound: (count) => found.push(count),
    });
    expect(found).toEqual([1, 2, 3, 4, 5]);
    expect(docs.map((d) => d.relPath)).toEqual([
      ".shipper/bugs/done/gamma.md",
      ".shipper/open/legacy.md",
      ".shipper/plans/open/alpha.md",
      ".shipper/reviews/delta.md",
      ".shipper/spikes/open/beta.md",
    ]);

    expect(docs.find((d) => d.relPath.endsWith("alpha.md"))).toMatchObject({
      type: "plan",
      status: "open",
    });
    expect(docs.find((d) => d.relPath.endsWith("legacy.md"))).toMatchObject({
      type: "spike",
      status: "open",
    });
    expect(docs.find((d) => d.relPath.endsWith("delta.md"))).toMatchObject({
      type: "review",
      status: null,
    });
  });

  it("discovers configured directories and still finds the legacy layout", async () => {
    const root = await makeRepo();
    await mkdir(join(root, "docs", "plans", "open"), { recursive: true });
    await mkdir(join(root, "docs", "reviews"), { recursive: true });
    await mkdir(join(root, ".shipper", "open"), { recursive: true });
    await mkdir(join(root, ".shipper", "plans", "open"), { recursive: true });
    await writeFile(join(root, "docs", "plans", "open", "custom.md"), "# Custom\n", "utf8");
    await writeFile(join(root, "docs", "reviews", "rev.md"), "# Rev\n", "utf8");
    await writeFile(
      join(root, ".shipper", "open", "legacy.md"),
      "---\ntype: spike\n---\n\n# Legacy\n",
      "utf8",
    );
    await writeFile(join(root, ".shipper", "plans", "open", "stray.md"), "# Stray\n", "utf8");

    const docs = await discoverDocs(root, {
      config: configWith({ paths: { plans: "docs/plans", reviews: "docs/reviews" } }),
    });
    expect(docs.map((d) => d.relPath)).toEqual([
      ".shipper/open/legacy.md",
      "docs/plans/open/custom.md",
      "docs/reviews/rev.md",
    ]);
    expect(docs.find((d) => d.relPath.endsWith("custom.md"))).toMatchObject({
      type: "plan",
      status: "open",
    });
    expect(docs.find((d) => d.relPath.endsWith("rev.md"))).toMatchObject({
      type: "review",
      status: null,
    });
    expect(docs.find((d) => d.relPath.endsWith("legacy.md"))).toMatchObject({
      type: "spike",
      status: "open",
    });
  });

  it("indexes extra directories as doc and does not recurse", async () => {
    const root = await makeRepo();
    await mkdir(join(root, "docs", "adr", "nested"), { recursive: true });
    await writeFile(join(root, "docs", "adr", "one.md"), "# One\n", "utf8");
    await writeFile(join(root, "docs", "adr", "notes.txt"), "skip", "utf8");
    await writeFile(join(root, "docs", "adr", "nested", "two.md"), "# Two\n", "utf8");

    const docs = await discoverDocs(root, {
      config: configWith({ extraDirs: ["docs/adr"] }),
    });
    expect(docs).toEqual([
      expect.objectContaining({
        relPath: "docs/adr/one.md",
        type: "doc",
        status: null,
      }),
    ]);
  });

  it("does not list an extra-dir file twice when it was already discovered", async () => {
    const root = await makeRepo();
    await mkdir(join(root, ".shipper", "reviews"), { recursive: true });
    await writeFile(join(root, ".shipper", "reviews", "delta.md"), "# Delta\n", "utf8");

    const docs = await discoverDocs(root, {
      config: configWith({ extraDirs: [".shipper/reviews"] }),
    });
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ relPath: ".shipper/reviews/delta.md", type: "review" });
  });

  it("extracts title and scalar frontmatter", async () => {
    const markdown = `---
type: plan
branch: shipper/foo
pr_number: 12
phase_commits:
  1: abc
---

# My Title

Body.
`;
    const meta = readDocMetadata(markdown, { relPath: ".shipper/plans/open/my-title.md" });
    expect(meta.title).toBe("My Title");
    expect(meta.frontmatter).toEqual({
      branch: "shipper/foo",
      pr_number: 12,
    });
  });

  it("falls back to filename when there is no H1", async () => {
    const meta = readDocMetadata("no title here\n", {
      relPath: ".shipper/bugs/open/mystery.md",
    });
    expect(meta.title).toBe("mystery");
  });
});
