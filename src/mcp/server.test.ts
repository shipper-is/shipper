import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Embedder } from "../embeddings/client.ts";
import { createShipperMcpServer } from "./server.ts";

const temps: string[] = [];
let previousHome: string | undefined;
let previousXdgConfig: string | undefined;
let previousXdgCache: string | undefined;
let homeDir: string;

beforeEach(async () => {
  homeDir = await mkdtemp(join(tmpdir(), "shipper-mcp-home-"));
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

function createFakeEmbedder(modelId = "fake-8d"): Embedder {
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
    async embedDocuments(texts: string[]) {
      return texts.map(embedOne);
    },
    async embedQuery(text: string) {
      return embedOne(text);
    },
  };
}

/** Embedder that maps a specific query to the same vector as docs containing a snippet. */
function createBiasedEmbedder(targetSnippet: string): Embedder {
  const hashText = (text: string): Float32Array => {
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
  const targetVec = hashText(targetSnippet);

  return {
    modelId: "fake-8d",
    dims: DIMS,
    async embedDocuments(texts: string[]) {
      return texts.map((t) => (t.includes(targetSnippet) ? Float32Array.from(targetVec) : hashText(t)));
    },
    async embedQuery(text: string) {
      if (text.includes(targetSnippet) || text.includes("unique-alpha-topic")) {
        return Float32Array.from(targetVec);
      }
      return hashText(text);
    },
  };
}

async function makeRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "shipper-mcp-repo-"));
  temps.push(root);
  await mkdir(join(root, ".shipper", "plans", "open"), { recursive: true });
  await mkdir(join(root, ".shipper", "plans", "done"), { recursive: true });
  await mkdir(join(root, ".shipper", "bugs", "open"), { recursive: true });

  await writeFile(
    join(root, ".shipper", "plans", "open", "alpha.md"),
    `---
type: plan
---

# Alpha Plan

## Overview

This plan covers the unique-alpha-topic for semantic search testing. Padding padding padding padding padding.

## Details

More unique-alpha-topic content that is long enough for its own chunk. Padding padding padding padding.
`,
    "utf8",
  );

  await writeFile(
    join(root, ".shipper", "plans", "done", "beta.md"),
    `---
type: plan
---

# Beta Plan

## Overview

This finished plan is about an unrelated-beta-subject entirely. Padding padding padding padding padding.

## Wrap-up

Closing notes on unrelated-beta-subject. Padding padding padding padding padding.
`,
    "utf8",
  );

  await writeFile(
    join(root, ".shipper", "bugs", "open", "gamma.md"),
    `---
severity: high
---

# Gamma Bug

## Symptom

Something breaks when unrelated-beta-subject interacts wrongly. Padding padding padding padding.

## Root Cause

Misconfiguration around the gamma pathway. Padding padding padding padding padding.
`,
    "utf8",
  );

  await writeFile(join(root, ".shipper", "notes.txt"), "not markdown\n", "utf8");

  return root;
}

async function writeRepoConfig(repoRoot: string, value: unknown): Promise<void> {
  await mkdir(join(repoRoot, ".shipper"), { recursive: true });
  await writeFile(
    join(repoRoot, ".shipper", "config.json"),
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
}

const SEARCH_DISABLED_MESSAGE =
  "Search is disabled for this repository (search.enabled is false in Shipper config). Use grep/glob over the artifact directories instead.";

async function connectPair(opts: {
  repoRoot: string;
  embedder: Embedder;
  ensureServer?: () => Promise<{ baseUrl: string }>;
  warmUpTimeoutMs?: number;
}): Promise<{ client: Client; close: () => Promise<void> }> {
  const logs: string[] = [];
  const server = createShipperMcpServer({
    embedder: opts.embedder,
    explicitDir: opts.repoRoot,
    cwd: opts.repoRoot,
    ensureServer: opts.ensureServer ?? (async () => ({ baseUrl: "http://127.0.0.1:9" })),
    warmUpTimeoutMs: opts.warmUpTimeoutMs,
    log: (msg) => logs.push(msg),
  });

  const client = new Client({ name: "test", version: "0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

function toolText(result: {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}): string {
  const parts = result.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text);
  return parts.join("\n");
}

describe("createShipperMcpServer", () => {
  it("lists exactly the five tools", async () => {
    const repoRoot = await makeRepo();
    const { client, close } = await connectPair({
      repoRoot,
      embedder: createFakeEmbedder(),
    });
    try {
      const listed = await client.listTools();
      const names = listed.tools.map((t) => t.name).sort();
      expect(names).toEqual([
        "shipper_get_doc",
        "shipper_list_docs",
        "shipper_reindex",
        "shipper_search",
        "shipper_similar",
      ]);
    } finally {
      await close();
    }
  });

  it("shipper_search returns the expected top file for a matching query", async () => {
    const repoRoot = await makeRepo();
    const snippet = "unique-alpha-topic";
    const { client, close } = await connectPair({
      repoRoot,
      embedder: createBiasedEmbedder(snippet),
    });
    try {
      // Allow warm-up sync to finish.
      await new Promise((r) => setTimeout(r, 100));
      const result = await client.callTool({
        name: "shipper_search",
        arguments: { query: "unique-alpha-topic" },
      });
      expect(result.isError).toBeFalsy();
      const text = toolText(result as { content: Array<{ type: string; text?: string }> });
      expect(text).toContain("alpha.md");
      expect(text.indexOf("alpha.md")).toBeLessThan(
        text.includes("beta.md") ? text.indexOf("beta.md") : Number.POSITIVE_INFINITY,
      );
    } finally {
      await close();
    }
  });

  it("filters by status done", async () => {
    const repoRoot = await makeRepo();
    const { client, close } = await connectPair({
      repoRoot,
      embedder: createFakeEmbedder(),
    });
    try {
      await new Promise((r) => setTimeout(r, 100));
      const result = await client.callTool({
        name: "shipper_search",
        arguments: { query: "plan", status: "done" },
      });
      expect(result.isError).toBeFalsy();
      const text = toolText(result as { content: Array<{ type: string; text?: string }> });
      expect(text).toContain("beta.md");
      expect(text).not.toContain("alpha.md");
    } finally {
      await close();
    }
  });

  it("shipper_get_doc rejects path traversal and non-md paths", async () => {
    const repoRoot = await makeRepo();
    const { client, close } = await connectPair({
      repoRoot,
      embedder: createFakeEmbedder(),
    });
    try {
      await new Promise((r) => setTimeout(r, 100));
      const traversal = await client.callTool({
        name: "shipper_get_doc",
        arguments: { path: "../../etc/passwd" },
      });
      expect(traversal.isError).toBe(true);
      expect(toolText(traversal as { content: Array<{ type: string; text?: string }> })).toMatch(
        /stay inside|\.shipper|not found/i,
      );

      const nonMd = await client.callTool({
        name: "shipper_get_doc",
        arguments: { path: ".shipper/notes.txt" },
      });
      expect(nonMd.isError).toBe(true);
      expect(toolText(nonMd as { content: Array<{ type: string; text?: string }> })).toMatch(/\.md/i);
    } finally {
      await close();
    }
  });

  it("shipper_get_doc returns only the requested line range", async () => {
    const repoRoot = await makeRepo();
    const { client, close } = await connectPair({
      repoRoot,
      embedder: createFakeEmbedder(),
    });
    try {
      await new Promise((r) => setTimeout(r, 100));
      const result = await client.callTool({
        name: "shipper_get_doc",
        arguments: {
          path: ".shipper/plans/open/alpha.md",
          startLine: 1,
          endLine: 3,
        },
      });
      expect(result.isError).toBeFalsy();
      const text = toolText(result as { content: Array<{ type: string; text?: string }> });
      expect(text).toContain(".shipper/plans/open/alpha.md:1-3");
      expect(text).toContain("---");
      expect(text).toContain("type: plan");
      expect(text).not.toContain("unique-alpha-topic");
    } finally {
      await close();
    }
  });

  it("returns a warming-up message when ensureServer never resolves", async () => {
    const repoRoot = await makeRepo();
    const { client, close } = await connectPair({
      repoRoot,
      embedder: createFakeEmbedder(),
      ensureServer: () => new Promise(() => {}),
      warmUpTimeoutMs: 50,
    });
    try {
      const result = await client.callTool({
        name: "shipper_search",
        arguments: { query: "anything" },
      });
      expect(result.isError).toBeFalsy();
      const text = toolText(result as { content: Array<{ type: string; text?: string }> });
      expect(text).toMatch(/warming up/i);
      expect(text).toMatch(/shipper embed start/i);
    } finally {
      await close();
    }
  });

  it("shipper_get_doc allows configured dirs and extra dirs, and rejects escapes", async () => {
    const repoRoot = await makeRepo();
    await writeRepoConfig(repoRoot, {
      paths: { plans: "docs/plans" },
      search: { extraDirs: ["docs/adr"] },
    });
    await mkdir(join(repoRoot, "docs", "plans", "open"), { recursive: true });
    await mkdir(join(repoRoot, "docs", "adr"), { recursive: true });
    await writeFile(
      join(repoRoot, "docs", "plans", "open", "custom.md"),
      "# Custom Plan\n\nBody.\n",
      "utf8",
    );
    await writeFile(join(repoRoot, "docs", "adr", "decision.md"), "# Decision\n", "utf8");

    const outsideDir = await mkdtemp(join(tmpdir(), "shipper-mcp-outside-"));
    temps.push(outsideDir);
    const outsideFile = join(outsideDir, "outside.md");
    await writeFile(outsideFile, "# Outside\n", "utf8");
    await symlink(outsideFile, join(repoRoot, ".shipper", "plans", "open", "escape.md"));

    await mkdir(join(repoRoot, ".shipper-not"), { recursive: true });
    await writeFile(join(repoRoot, ".shipper-not", "secret.md"), "# Secret\n", "utf8");

    const { client, close } = await connectPair({
      repoRoot,
      embedder: createFakeEmbedder(),
    });
    try {
      await new Promise((r) => setTimeout(r, 100));

      const custom = await client.callTool({
        name: "shipper_get_doc",
        arguments: { path: "docs/plans/open/custom.md" },
      });
      expect(custom.isError).toBeFalsy();
      expect(toolText(custom as { content: Array<{ type: string; text?: string }> })).toContain(
        "# Custom Plan",
      );

      const extra = await client.callTool({
        name: "shipper_get_doc",
        arguments: { path: "docs/adr/decision.md" },
      });
      expect(extra.isError).toBeFalsy();
      expect(toolText(extra as { content: Array<{ type: string; text?: string }> })).toContain(
        "# Decision",
      );

      const escapedPath = relative(repoRoot, outsideFile);
      const escaped = await client.callTool({
        name: "shipper_get_doc",
        arguments: { path: escapedPath },
      });
      expect(escaped.isError).toBe(true);
      expect(toolText(escaped as { content: Array<{ type: string; text?: string }> })).toBe(
        `Path must be a .md file inside a Shipper artifact directory: ${escapedPath}`,
      );

      const viaSymlink = await client.callTool({
        name: "shipper_get_doc",
        arguments: { path: ".shipper/plans/open/escape.md" },
      });
      expect(viaSymlink.isError).toBe(true);
      expect(
        toolText(viaSymlink as { content: Array<{ type: string; text?: string }> }),
      ).toContain("Path must be a .md file inside a Shipper artifact directory");

      const prefix = await client.callTool({
        name: "shipper_get_doc",
        arguments: { path: ".shipper-not/secret.md" },
      });
      expect(prefix.isError).toBe(true);
      expect(toolText(prefix as { content: Array<{ type: string; text?: string }> })).toContain(
        "Path must be a .md file inside a Shipper artifact directory",
      );

      const absolute = await client.callTool({
        name: "shipper_get_doc",
        arguments: { path: outsideFile },
      });
      expect(absolute.isError).toBe(true);
      expect(toolText(absolute as { content: Array<{ type: string; text?: string }> })).toContain(
        "Path must be a .md file inside a Shipper artifact directory",
      );
    } finally {
      await close();
    }
  });

  it("returns a non-error when search is disabled, and list and get still work", async () => {
    const repoRoot = await makeRepo();
    await writeRepoConfig(repoRoot, { search: { enabled: false } });
    let ensured = false;
    const { client, close } = await connectPair({
      repoRoot,
      embedder: createFakeEmbedder(),
      ensureServer: async () => {
        ensured = true;
        return { baseUrl: "http://127.0.0.1:9" };
      },
    });
    try {
      const search = await client.callTool({
        name: "shipper_search",
        arguments: { query: "unique-alpha-topic" },
      });
      expect(search.isError).toBeFalsy();
      expect(toolText(search as { content: Array<{ type: string; text?: string }> })).toBe(
        SEARCH_DISABLED_MESSAGE,
      );

      const similar = await client.callTool({
        name: "shipper_similar",
        arguments: { path: ".shipper/plans/open/alpha.md" },
      });
      expect(similar.isError).toBeFalsy();
      expect(toolText(similar as { content: Array<{ type: string; text?: string }> })).toBe(
        SEARCH_DISABLED_MESSAGE,
      );

      const reindex = await client.callTool({
        name: "shipper_reindex",
        arguments: {},
      });
      expect(reindex.isError).toBeFalsy();
      expect(toolText(reindex as { content: Array<{ type: string; text?: string }> })).toBe(
        SEARCH_DISABLED_MESSAGE,
      );

      const listed = await client.callTool({
        name: "shipper_list_docs",
        arguments: {},
      });
      expect(listed.isError).toBeFalsy();
      const listedText = toolText(listed as { content: Array<{ type: string; text?: string }> });
      expect(listedText).toContain("alpha.md");
      expect(listedText).toContain("Alpha Plan");
      expect(listedText).not.toContain("Search is disabled");

      const doc = await client.callTool({
        name: "shipper_get_doc",
        arguments: { path: ".shipper/plans/open/alpha.md" },
      });
      expect(doc.isError).toBeFalsy();
      expect(toolText(doc as { content: Array<{ type: string; text?: string }> })).toContain(
        "unique-alpha-topic",
      );

      await new Promise((r) => setTimeout(r, 50));
      expect(ensured).toBe(false);
    } finally {
      await close();
    }
  });
});
