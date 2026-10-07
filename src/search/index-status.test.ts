import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { indexPathForRepo } from "../embeddings/paths.ts";
import { writeIndex, type LoadedIndex } from "./index-file.ts";
import { getIndexStatus } from "./index-status.ts";
import type { ShipperDoc } from "./documents.ts";

const temps: string[] = [];
let previousHome: string | undefined;
let previousXdgConfig: string | undefined;
let previousXdgCache: string | undefined;

beforeEach(async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "shipper-index-status-"));
  temps.push(homeDir);
  previousHome = process.env["HOME"];
  previousXdgConfig = process.env["XDG_CONFIG_HOME"];
  previousXdgCache = process.env["XDG_CACHE_HOME"];
  process.env["HOME"] = homeDir;
  process.env["XDG_CONFIG_HOME"] = join(homeDir, "config");
  process.env["XDG_CACHE_HOME"] = join(homeDir, "cache");
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

function doc(relPath: string, mtimeMs: number): ShipperDoc {
  return {
    relPath,
    absPath: relPath,
    type: "plan",
    status: "open",
    mtimeMs,
    size: 10,
  };
}

function sample(repoPath: string, updatedAt: string): LoadedIndex {
  return {
    header: {
      formatVersion: 1,
      endianness: "le",
      repoPath,
      modelId: "test-model",
      dims: 1,
      chunkerVersion: 1,
      updatedAt,
      files: {
        ".shipper/plans/open/a.md": {
          type: "plan",
          status: "open",
          mtimeMs: 1,
          size: 10,
          contentHash: "abc",
          title: "A",
          frontmatter: {},
        },
      },
      chunks: [
        {
          relPath: ".shipper/plans/open/a.md",
          headingPath: "",
          startLine: 1,
          endLine: 2,
          textHash: "h",
          preview: "a",
        },
      ],
    },
    vectors: new Float32Array([0.5]),
  };
}

describe("getIndexStatus", () => {
  it("is stale when the index is missing", async () => {
    const repo = await realpath(await mkdtemp(join(tmpdir(), "shipper-idx-repo-")));
    temps.push(repo);
    const status = await getIndexStatus(repo, []);
    expect(status.exists).toBe(false);
    expect(status.stale).toBe(true);
    expect(status.files).toBe(0);
    expect(status.path).toBe(indexPathForRepo(repo));
  });

  it("is fresh when paths match and docs are not newer than updatedAt", async () => {
    const repo = await realpath(await mkdtemp(join(tmpdir(), "shipper-idx-repo-")));
    temps.push(repo);
    const updatedAt = "2026-01-01T00:00:00.000Z";
    const updatedMs = Date.parse(updatedAt);
    const path = indexPathForRepo(repo);
    await writeIndex(path, sample(repo, updatedAt));

    const fresh = await getIndexStatus(repo, [doc(".shipper/plans/open/a.md", updatedMs - 1000)]);
    expect(fresh.exists).toBe(true);
    expect(fresh.stale).toBe(false);
    expect(fresh.files).toBe(1);
    expect(fresh.chunks).toBe(1);
    expect(fresh.modelId).toBe("test-model");
    expect(fresh.updatedAt).toBe(updatedAt);

    const newer = await getIndexStatus(repo, [doc(".shipper/plans/open/a.md", updatedMs + 1000)]);
    expect(newer.stale).toBe(true);

    const extra = await getIndexStatus(repo, [
      doc(".shipper/plans/open/a.md", updatedMs - 1000),
      doc(".shipper/plans/open/b.md", updatedMs - 1000),
    ]);
    expect(extra.stale).toBe(true);
  });
});
