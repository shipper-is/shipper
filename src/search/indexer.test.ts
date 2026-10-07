import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Embedder } from "../embeddings/client.ts";
import type { IndexProgress } from "./index-progress.ts";
import { syncIndex } from "./indexer.ts";

const temps: string[] = [];
let previousHome: string | undefined;
let previousXdgConfig: string | undefined;
let previousXdgCache: string | undefined;
let homeDir: string;

beforeEach(async () => {
  homeDir = await mkdtemp(join(tmpdir(), "shipper-indexer-home-"));
  temps.push(homeDir);
  previousHome = process.env["HOME"];
  previousXdgConfig = process.env["XDG_CONFIG_HOME"];
  previousXdgCache = process.env["XDG_CACHE_HOME"];
  process.env["HOME"] = homeDir;
  process.env["XDG_CONFIG_HOME"] = join(homeDir, "config");
  process.env["XDG_CACHE_HOME"] = join(homeDir, "cache");
});

afterEach(async () => {
  if (previousHome === undefined) {
    delete process.env["HOME"];
  } else {
    process.env["HOME"] = previousHome;
  }
  if (previousXdgConfig === undefined) {
    delete process.env["XDG_CONFIG_HOME"];
  } else {
    process.env["XDG_CONFIG_HOME"] = previousXdgConfig;
  }
  if (previousXdgCache === undefined) {
    delete process.env["XDG_CACHE_HOME"];
  } else {
    process.env["XDG_CACHE_HOME"] = previousXdgCache;
  }
  for (const dir of temps.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

const DIMS = 8;

/** Deterministic fake embedder: hash text into a normalized 8-d vector. */
function createFakeEmbedder(modelId = "fake-8d"): Embedder & { embedCalls: number } {
  const state = { embedCalls: 0 };
  const embedOne = (text: string): Float32Array => {
    const hash = createHash("sha256").update(text).digest();
    const v = new Float32Array(DIMS);
    for (let i = 0; i < DIMS; i++) {
      v[i] = (hash[i]! / 255) * 2 - 1;
    }
    let norm = 0;
    for (let i = 0; i < DIMS; i++) {
      norm += v[i]! * v[i]!;
    }
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < DIMS; i++) {
      v[i]! /= norm;
    }
    return v;
  };
  return {
    modelId,
    dims: DIMS,
    get embedCalls() {
      return state.embedCalls;
    },
    async embedDocuments(
      texts: string[],
      opts?: { onProgress?: (done: number, total: number) => void },
    ) {
      state.embedCalls += texts.length;
      const vectors = texts.map(embedOne);
      opts?.onProgress?.(texts.length, texts.length);
      return vectors;
    },
    async embedQuery(text: string) {
      state.embedCalls += 1;
      return embedOne(text);
    },
  };
}

async function makeRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "shipper-indexer-repo-"));
  temps.push(root);
  await mkdir(join(root, ".shipper", "plans", "open"), { recursive: true });
  await mkdir(join(root, ".shipper", "plans", "done"), { recursive: true });
  return root;
}

const DOC_A = `---
type: plan
---

# Plan A

## Section One

Content about alpha that is long enough to be its own chunk. Padding padding padding padding padding padding.

## Section Two

Content about beta that is long enough to be its own chunk. Padding padding padding padding padding padding.
`;

const DOC_B = `---
type: plan
---

# Plan B

## Only

Gamma content long enough for a chunk. Padding padding padding padding padding padding padding.
`;

describe("syncIndex", () => {
  it("embeds all chunks on first sync and reuses on second", async () => {
    const repo = await makeRepo();
    await writeFile(join(repo, ".shipper", "plans", "open", "a.md"), DOC_A, "utf8");
    await writeFile(join(repo, ".shipper", "plans", "open", "b.md"), DOC_B, "utf8");

    const embedder = createFakeEmbedder();
    const first = await syncIndex({ repoRoot: repo, embedder });
    expect(first.stats.embedded).toBeGreaterThan(0);
    expect(first.stats.files).toBe(2);
    const embeddedFirst = first.stats.embedded;

    const embedder2 = createFakeEmbedder();
    const second = await syncIndex({ repoRoot: repo, embedder: embedder2 });
    expect(second.stats.embedded).toBe(0);
    expect(second.stats.reused).toBe(embeddedFirst);
    expect(embedder2.embedCalls).toBe(0);
  });

  it("re-embeds only changed chunks when one file is edited", async () => {
    const repo = await makeRepo();
    await writeFile(join(repo, ".shipper", "plans", "open", "a.md"), DOC_A, "utf8");
    await writeFile(join(repo, ".shipper", "plans", "open", "b.md"), DOC_B, "utf8");

    const embedder = createFakeEmbedder();
    await syncIndex({ repoRoot: repo, embedder });

    await writeFile(
      join(repo, ".shipper", "plans", "open", "a.md"),
      DOC_A.replace("alpha", "ALPHA-EDITED"),
      "utf8",
    );

    const embedder2 = createFakeEmbedder();
    const result = await syncIndex({ repoRoot: repo, embedder: embedder2 });
    expect(result.stats.embedded).toBeGreaterThan(0);
    expect(result.stats.embedded).toBeLessThan(result.stats.chunks);
    expect(result.stats.reused).toBeGreaterThan(0);
  });

  it("re-embeds nothing when moving open -> done and updates status", async () => {
    const repo = await makeRepo();
    const openPath = join(repo, ".shipper", "plans", "open", "a.md");
    const donePath = join(repo, ".shipper", "plans", "done", "a.md");
    await writeFile(openPath, DOC_A, "utf8");

    const embedder = createFakeEmbedder();
    const first = await syncIndex({ repoRoot: repo, embedder });
    expect(first.index.header.files[".shipper/plans/open/a.md"]?.status).toBe("open");

    await rename(openPath, donePath);

    const embedder2 = createFakeEmbedder();
    const second = await syncIndex({ repoRoot: repo, embedder: embedder2 });
    expect(second.stats.embedded).toBe(0);
    expect(second.index.header.files[".shipper/plans/done/a.md"]?.status).toBe("done");
    expect(second.index.header.files[".shipper/plans/open/a.md"]).toBeUndefined();
    expect(embedder2.embedCalls).toBe(0);
  });

  it("removes chunks when a file is deleted", async () => {
    const repo = await makeRepo();
    await writeFile(join(repo, ".shipper", "plans", "open", "a.md"), DOC_A, "utf8");
    await writeFile(join(repo, ".shipper", "plans", "open", "b.md"), DOC_B, "utf8");

    const embedder = createFakeEmbedder();
    const first = await syncIndex({ repoRoot: repo, embedder });
    const before = first.stats.chunks;

    await rm(join(repo, ".shipper", "plans", "open", "b.md"));

    const second = await syncIndex({ repoRoot: repo, embedder: createFakeEmbedder() });
    expect(second.stats.removed).toBe(1);
    expect(second.stats.chunks).toBeLessThan(before);
    expect(second.index.header.files[".shipper/plans/open/b.md"]).toBeUndefined();
  });

  it("forces a full rebuild when model id changes", async () => {
    const repo = await makeRepo();
    await writeFile(join(repo, ".shipper", "plans", "open", "a.md"), DOC_A, "utf8");

    await syncIndex({ repoRoot: repo, embedder: createFakeEmbedder("model-a") });

    const embedderB = createFakeEmbedder("model-b");
    const result = await syncIndex({ repoRoot: repo, embedder: embedderB });
    expect(result.stats.embedded).toBe(result.stats.chunks);
    expect(result.stats.reused).toBe(0);
    expect(result.index.header.modelId).toBe("model-b");
  });

  it("reports scan, read, embed, and write progress", async () => {
    const repo = await makeRepo();
    await writeFile(join(repo, ".shipper", "plans", "open", "a.md"), DOC_A, "utf8");
    await writeFile(join(repo, ".shipper", "plans", "open", "b.md"), DOC_B, "utf8");

    const events: IndexProgress[] = [];
    const result = await syncIndex({
      repoRoot: repo,
      embedder: createFakeEmbedder(),
      onProgress: (progress) => events.push({ ...progress }),
    });

    expect(events.at(-1)?.phase).toBe("write");
    expect(events.filter((event) => event.phase === "scan").at(-1)).toEqual({
      phase: "scan",
      current: 2,
      total: 2,
    });
    expect(events.filter((event) => event.phase === "read").map((event) => event.current)).toEqual([
      1, 2,
    ]);
    const embed = events.filter((event) => event.phase === "embed");
    expect(embed[0]).toEqual({ phase: "embed", current: 0, total: result.stats.embedded });
    expect(embed.map((event) => event.current)).toEqual([
      0,
      result.stats.embedded,
      result.stats.embedded,
    ]);

    const refresh: IndexProgress[] = [];
    await syncIndex({
      repoRoot: repo,
      embedder: createFakeEmbedder(),
      onProgress: (progress) => refresh.push({ ...progress }),
    });
    expect(refresh.some((event) => event.phase === "read")).toBe(true);
    expect(refresh.some((event) => event.phase === "embed" || event.phase === "write")).toBe(false);
  });
});
