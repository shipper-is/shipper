import { mkdir, utimes, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { EMBEDDING_MODEL } from "../constants.ts";
import { clearEmbedServerCache, ensureEmbedServer } from "./server-manager.ts";
import { lastUsedPath } from "./paths.ts";

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type Embedder = {
  modelId: string;
  dims: number;
  embedDocuments(texts: string[]): Promise<Float32Array[]>;
  embedQuery(text: string): Promise<Float32Array>;
};

const BATCH_SIZE = 16;
const QUERY_LRU_MAX = 100;

type LruEntry = { key: string; value: Float32Array };

class QueryLru {
  private readonly entries: LruEntry[] = [];

  get(key: string): Float32Array | undefined {
    const idx = this.entries.findIndex((e) => e.key === key);
    if (idx < 0) {
      return undefined;
    }
    const [entry] = this.entries.splice(idx, 1);
    if (!entry) {
      return undefined;
    }
    this.entries.push(entry);
    return entry.value;
  }

  set(key: string, value: Float32Array): void {
    const idx = this.entries.findIndex((e) => e.key === key);
    if (idx >= 0) {
      this.entries.splice(idx, 1);
    }
    this.entries.push({ key, value });
    while (this.entries.length > QUERY_LRU_MAX) {
      this.entries.shift();
    }
  }
}

async function touchLastUsed(): Promise<void> {
  const path = lastUsedPath();
  await mkdir(dirname(path), { recursive: true });
  const now = new Date();
  try {
    await utimes(path, now, now);
  } catch {
    await writeFile(path, "", "utf8");
    await utimes(path, now, now);
  }
}

function isConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  const msg = err.message.toLowerCase();
  if (
    msg.includes("fetch failed") ||
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("socket hang up") ||
    msg.includes("network")
  ) {
    return true;
  }
  const cause = (err as Error & { cause?: unknown }).cause;
  if (cause && cause !== err) {
    return isConnectionError(cause);
  }
  return false;
}

type EmbeddingsResponse = {
  data: Array<{ embedding: number[] }>;
};

async function postEmbeddings(
  baseUrl: string,
  input: string[],
  fetchFn: FetchFn,
): Promise<Float32Array[]> {
  const response = await fetchFn(`${baseUrl}/v1/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Embeddings request failed: ${response.status} ${response.statusText}${body ? ` — ${body}` : ""}`);
  }
  const json = (await response.json()) as EmbeddingsResponse;
  if (!Array.isArray(json.data) || json.data.length !== input.length) {
    throw new Error(
      `Embeddings response length mismatch: expected ${input.length}, got ${json.data?.length ?? 0}`,
    );
  }
  return json.data.map((item, i) => {
    const vec = item.embedding;
    if (!Array.isArray(vec) || vec.length !== EMBEDDING_MODEL.dims) {
      throw new Error(
        `Embedding dims mismatch at index ${i}: expected ${EMBEDDING_MODEL.dims}, got ${vec?.length ?? 0}`,
      );
    }
    return Float32Array.from(vec);
  });
}

async function embedOneWithFallback(
  baseUrl: string,
  text: string,
  fetchFn: FetchFn,
): Promise<Float32Array> {
  try {
    const [vec] = await postEmbeddings(baseUrl, [text], fetchFn);
    return vec!;
  } catch (err) {
    const half = text.slice(0, Math.floor(text.length / 2));
    if (half.length === 0 || half === text) {
      console.error(
        `Warning: skipping embedding for input (${text.length} chars): ${err instanceof Error ? err.message : String(err)}`,
      );
      return new Float32Array(0);
    }
    try {
      const [vec] = await postEmbeddings(baseUrl, [half], fetchFn);
      return vec!;
    } catch (err2) {
      console.error(
        `Warning: skipping embedding after truncate (${text.length} chars): ${err2 instanceof Error ? err2.message : String(err2)}`,
      );
      return new Float32Array(0);
    }
  }
}

async function embedBatch(
  baseUrl: string,
  texts: string[],
  fetchFn: FetchFn,
): Promise<Float32Array[]> {
  try {
    return await postEmbeddings(baseUrl, texts, fetchFn);
  } catch {
    const out: Float32Array[] = [];
    for (const text of texts) {
      out.push(await embedOneWithFallback(baseUrl, text, fetchFn));
    }
    return out;
  }
}

export function createLlamaEmbedder(opts?: {
  fetchFn?: FetchFn;
  ensureServer?: () => Promise<{ baseUrl: string }>;
}): Embedder {
  const fetchFn = opts?.fetchFn ?? fetch;
  const ensureServer = opts?.ensureServer ?? (() => ensureEmbedServer({ fetchFn }));
  const queryCache = new QueryLru();

  async function withServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
    await touchLastUsed();
    let { baseUrl } = await ensureServer();
    try {
      return await fn(baseUrl);
    } catch (err) {
      if (!isConnectionError(err)) {
        throw err;
      }
      clearEmbedServerCache();
      ({ baseUrl } = await ensureServer());
      await touchLastUsed();
      return await fn(baseUrl);
    }
  }

  return {
    modelId: EMBEDDING_MODEL.id,
    dims: EMBEDDING_MODEL.dims,

    async embedDocuments(texts: string[]): Promise<Float32Array[]> {
      if (texts.length === 0) {
        return [];
      }
      const prefixed = texts.map((t) => `${EMBEDDING_MODEL.documentPrefix}${t}`);
      return withServer(async (baseUrl) => {
        const results: Float32Array[] = [];
        for (let i = 0; i < prefixed.length; i += BATCH_SIZE) {
          const batch = prefixed.slice(i, i + BATCH_SIZE);
          const vectors = await embedBatch(baseUrl, batch, fetchFn);
          results.push(...vectors);
        }
        return results;
      });
    },

    async embedQuery(text: string): Promise<Float32Array> {
      const prefixed = `${EMBEDDING_MODEL.queryPrefix}${text}`;
      const cached = queryCache.get(prefixed);
      if (cached) {
        await touchLastUsed();
        return cached;
      }
      const [vec] = await withServer(async (baseUrl) =>
        embedBatch(baseUrl, [prefixed], fetchFn),
      );
      if (!vec || vec.length === 0) {
        throw new Error("Failed to embed query");
      }
      queryCache.set(prefixed, vec);
      return vec;
    },
  };
}
