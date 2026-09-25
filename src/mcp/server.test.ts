import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Embedder } from "../embeddings/client.ts";
import { createShipperMcpServer } from "./server.ts";

const temps: string[] = [];
let previousHome: string | undefined;
let previousXdgCache: string | undefined;
let homeDir: string;

beforeEach(async () => {
  homeDir = await mkdtemp(join(tmpdir(), "shipper-mcp-home-"));
  temps.push(homeDir);
  previousHome = process.env["HOME"];
  previousXdgCache = process.env["XDG_CACHE_HOME"];
  process.env["HOME"] = homeDir;
  delete process.env["XDG_CACHE_HOME"];
});

afterEach(async () => {
  if (previousHome === undefined) {
    delete process.env["HOME"];
  } else {
    process.env["HOME"] = previousHome;
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
});
