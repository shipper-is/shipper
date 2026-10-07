import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMBEDDING_MODEL } from "../constants.ts";
import { createLlamaEmbedder } from "./client.ts";
import { lastUsedPath } from "./paths.ts";

function makeVector(seed: number): number[] {
  const dims = EMBEDDING_MODEL.dims;
  const out = new Array<number>(dims);
  for (let i = 0; i < dims; i++) {
    out[i] = ((seed + i) % 97) / 97;
  }
  return out;
}

describe("createLlamaEmbedder", () => {
  let previousHome: string | undefined;
  let previousXdgCache: string | undefined;
  let homeDir: string;
  let requestBodies: unknown[];
  let fetchCount: number;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "shipper-embed-client-"));
    previousHome = process.env["HOME"];
    previousXdgCache = process.env["XDG_CACHE_HOME"];
    process.env["HOME"] = homeDir;
    process.env["XDG_CACHE_HOME"] = join(homeDir, "cache");
    await mkdir(join(homeDir, "cache", "shipper", "embed"), { recursive: true });
    requestBodies = [];
    fetchCount = 0;
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
    await rm(homeDir, { recursive: true, force: true });
  });

  function stubFetch(handler?: (input: string[], body: unknown) => Response | Promise<Response>) {
    return async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      fetchCount += 1;
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      requestBodies.push(body);
      const input = (body as { input: string[] }).input;
      if (handler) {
        return handler(input, body);
      }
      return new Response(
        JSON.stringify({
          data: input.map((_: string, i: number) => ({ embedding: makeVector(i) })),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
  }

  it("prefixes documents and queries", async () => {
    const embedder = createLlamaEmbedder({
      fetchFn: stubFetch(),
      ensureServer: async () => ({ baseUrl: "http://127.0.0.1:9" }),
    });

    await embedder.embedDocuments(["doc one"]);
    await embedder.embedQuery("q one");

    expect(requestBodies[0]).toEqual({
      input: [`${EMBEDDING_MODEL.documentPrefix}doc one`],
    });
    expect(requestBodies[1]).toEqual({
      input: [`${EMBEDDING_MODEL.queryPrefix}q one`],
    });
  });

  it("batches documents into groups of 16", async () => {
    const embedder = createLlamaEmbedder({
      fetchFn: stubFetch(),
      ensureServer: async () => ({ baseUrl: "http://127.0.0.1:9" }),
    });

    const texts = Array.from({ length: 40 }, (_, i) => `t${i}`);
    const vectors = await embedder.embedDocuments(texts);
    expect(vectors).toHaveLength(40);
    expect(fetchCount).toBe(3);
    expect((requestBodies[0] as { input: string[] }).input).toHaveLength(16);
    expect((requestBodies[1] as { input: string[] }).input).toHaveLength(16);
    expect((requestBodies[2] as { input: string[] }).input).toHaveLength(8);
  });

  it("reports embedding progress after each batch", async () => {
    const embedder = createLlamaEmbedder({
      fetchFn: stubFetch(),
      ensureServer: async () => ({ baseUrl: "http://127.0.0.1:9" }),
    });
    const texts = Array.from({ length: 40 }, (_, i) => `t${i}`);
    const updates: Array<[number, number]> = [];
    await embedder.embedDocuments(texts, {
      onProgress: (done, total) => updates.push([done, total]),
    });
    expect(updates).toEqual([
      [16, 40],
      [32, 40],
      [40, 40],
    ]);
  });

  it("skips items with wrong dimensions via zero-length vectors", async () => {
    const embedder = createLlamaEmbedder({
      fetchFn: async () =>
        new Response(JSON.stringify({ data: [{ embedding: [1, 2, 3] }] }), { status: 200 }),
      ensureServer: async () => ({ baseUrl: "http://127.0.0.1:9" }),
    });

    const results = await embedder.embedDocuments(["x"]);
    expect(results).toHaveLength(1);
    expect(results[0]!.length).toBe(0);
  });

  it("falls back to per-item requests when a batch fails", async () => {
    let calls = 0;
    const badText = `FAIL${"x".repeat(200)}`;
    const embedder = createLlamaEmbedder({
      fetchFn: async (_url, init) => {
        calls += 1;
        const body = JSON.parse(String(init?.body)) as { input: string[] };
        if (body.input.length > 1) {
          return new Response("batch too big", { status: 500 });
        }
        const text = body.input[0] ?? "";
        // Fail the full item and its truncated half (FAIL sits just after the prefix).
        if (text.includes("FAIL")) {
          return new Response("bad item", { status: 500 });
        }
        return new Response(
          JSON.stringify({ data: [{ embedding: makeVector(1) }] }),
          { status: 200 },
        );
      },
      ensureServer: async () => ({ baseUrl: "http://127.0.0.1:9" }),
    });

    const results = await embedder.embedDocuments(["good", badText, "also good"]);
    expect(results).toHaveLength(3);
    expect(results[0]!.length).toBe(EMBEDDING_MODEL.dims);
    expect(results[1]!.length).toBe(0);
    expect(results[2]!.length).toBe(EMBEDDING_MODEL.dims);
    expect(calls).toBeGreaterThan(3);
  });

  it("caches embedQuery results in an LRU", async () => {
    const embedder = createLlamaEmbedder({
      fetchFn: stubFetch(),
      ensureServer: async () => ({ baseUrl: "http://127.0.0.1:9" }),
    });

    const a = await embedder.embedQuery("same");
    const before = fetchCount;
    const b = await embedder.embedQuery("same");
    expect(fetchCount).toBe(before);
    expect(a).toEqual(b);
  });

  it("touches last-used before embedding", async () => {
    const embedder = createLlamaEmbedder({
      fetchFn: stubFetch(),
      ensureServer: async () => ({ baseUrl: "http://127.0.0.1:9" }),
    });

    await embedder.embedQuery("touch me");
    const info = await stat(lastUsedPath());
    expect(info.mtimeMs).toBeGreaterThan(0);
  });
});
