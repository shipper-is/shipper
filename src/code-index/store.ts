import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CardMode, Decision } from "./cards.ts";
import { codeIndexDir } from "./d3-runtime.ts";
import type { CodeSymbol } from "./extract.ts";

export type StoredSymbol = Omit<CodeSymbol, "body" | "members"> & {
  preview: string;
  /** Hash of the decision state plus questions; null when the symbol was never sent to d3. */
  stateHash: string | null;
  mode: CardMode | null;
  decision: Decision | null;
  plainHash: string;
  labeledHash: string;
};

export type CodeIndexMeta = {
  formatVersion: 1;
  version: number;
  repoPath: string;
  embedModelId: string;
  dims: number;
  d3ModelId: string | null;
  taxonomyHash: string;
  updatedAt: string;
  symbols: StoredSymbol[];
};

export type CodeIndex = CodeIndexMeta & {
  /** Deterministic cards only. `symbols.length * dims` floats, L2-normalized. */
  plain: Float32Array;
  /** Cards plus d3 labels; identical to `plain` for symbols without a decision. */
  labeled: Float32Array;
};

export function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 24);
}

export function codeIndexBasePath(realRepoPath: string): string {
  return join(codeIndexDir(), createHash("sha256").update(realRepoPath).digest("hex").slice(0, 16));
}

export async function readCodeIndex(realRepoPath: string): Promise<CodeIndex | null> {
  const base = codeIndexBasePath(realRepoPath);
  try {
    const meta = JSON.parse(await readFile(`${base}.json`, "utf8")) as CodeIndexMeta;
    if (meta.formatVersion !== 1 || !Array.isArray(meta.symbols)) {
      return null;
    }
    const buf = await readFile(`${base}.vec`);
    const floats = meta.symbols.length * meta.dims;
    if (buf.byteLength !== floats * 2 * 4) {
      return null;
    }
    const copy = new ArrayBuffer(buf.byteLength);
    new Uint8Array(copy).set(buf);
    const all = new Float32Array(copy);
    return { ...meta, plain: all.subarray(0, floats), labeled: all.subarray(floats) };
  } catch {
    return null;
  }
}

async function writeAtomic(path: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

export async function writeCodeIndex(index: CodeIndex): Promise<string> {
  const { plain, labeled, ...meta } = index;
  const floats = meta.symbols.length * meta.dims;
  if (plain.length !== floats || labeled.length !== floats) {
    throw new Error(`Code index vector length mismatch: expected ${floats} per variant`);
  }
  const base = codeIndexBasePath(meta.repoPath);
  await mkdir(dirname(base), { recursive: true });
  const vectors = new Float32Array(floats * 2);
  vectors.set(plain, 0);
  vectors.set(labeled, floats);
  await writeAtomic(`${base}.vec`, new Uint8Array(vectors.buffer));
  await writeAtomic(`${base}.json`, JSON.stringify(meta));
  return `${base}.json`;
}

export function normalize(vec: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) {
    norm += vec[i]! * vec[i]!;
  }
  norm = Math.sqrt(norm);
  const out = Float32Array.from(vec);
  if (norm > 0) {
    for (let i = 0; i < out.length; i++) {
      out[i]! /= norm;
    }
  }
  return out;
}
