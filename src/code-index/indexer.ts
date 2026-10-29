import { realpath } from "node:fs/promises";
import type { Embedder } from "../embeddings/client.ts";
import { decisionState, embedText, type CardMode, type Decision } from "./cards.ts";
import { CODE_INDEX_VERSION, D3_MODELS, D3_UBATCH_TOKENS, type D3Quant } from "./constants.ts";
import { startD3Server, type D3Server } from "./d3-runtime.ts";
import { decideSymbol, stateCharBudget } from "./decisions.ts";
import { extractFromFiles, type CodeSymbol } from "./extract.ts";
import { discoverSourceFiles } from "./files.ts";
import { normalize, readCodeIndex, sha, writeCodeIndex, type CodeIndex, type StoredSymbol } from "./store.ts";
import { buildQuestions, type Taxonomy } from "./taxonomy.ts";

export type D3Config =
  | { mode: "managed"; quant: D3Quant; parallel: number }
  | { mode: "url"; url: string; model?: string; parallel: number }
  | { mode: "off" };

export type CodeIndexOpts = {
  repoRoot: string;
  embedder: Embedder;
  taxonomy: Taxonomy;
  d3: D3Config;
  includeTests?: boolean;
  paths?: string[];
  limit?: number;
  /** Index every extracted symbol instead of exported or substantial ones. */
  all?: boolean;
  force?: boolean;
  onStatus?: (line: string) => void;
};

export type CodeIndexStats = {
  files: number;
  extracted: number;
  symbols: number;
  d3Asked: number;
  d3Reused: number;
  d3Failed: number;
  d3WallMs: number;
  d3AvgMs: number;
  modes: Record<CardMode, number>;
  embedded: number;
  embedReused: number;
  ms: number;
};

const LINE_THRESHOLD_PRIVATE = 5;
const LINE_THRESHOLD_METHOD = 3;

function lines(sym: CodeSymbol): number {
  return sym.endLine - sym.startLine + 1;
}

/** Exported symbols, plus private functions and classes big enough to be worth reusing. */
export function selectSymbols(symbols: CodeSymbol[], all = false): CodeSymbol[] {
  if (all) {
    return symbols;
  }
  return symbols.filter((sym) => {
    if (sym.kind === "method") {
      return sym.exported && lines(sym) >= LINE_THRESHOLD_METHOD;
    }
    if (sym.exported) {
      return true;
    }
    return (
      (sym.kind === "function" || sym.kind === "component" || sym.kind === "hook" || sym.kind === "class") &&
      lines(sym) >= LINE_THRESHOLD_PRIVATE
    );
  });
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

function d3ModelId(config: D3Config): string | null {
  if (config.mode === "managed") {
    return D3_MODELS[config.quant].id;
  }
  if (config.mode === "url") {
    return config.model ?? config.url;
  }
  return null;
}

function formatEta(ms: number): string {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

type DecisionEntry = { decision: Decision; mode: CardMode; stateHash: string };

export async function buildCodeIndex(
  opts: CodeIndexOpts,
): Promise<{ index: CodeIndex; stats: CodeIndexStats; path: string }> {
  const started = Date.now();
  const status = opts.onStatus ?? (() => undefined);
  const repoPath = await realpath(opts.repoRoot);

  status("Scanning source files");
  const files = await discoverSourceFiles({
    repoRoot: repoPath,
    includeTests: opts.includeTests,
    paths: opts.paths,
  });
  const extracted = extractFromFiles(files);
  let symbols = selectSymbols(extracted, opts.all);
  if (opts.limit !== undefined) {
    symbols = symbols.slice(0, opts.limit);
  }
  status(`Extracted ${extracted.length} symbols from ${files.length} files; indexing ${symbols.length}`);

  const previous = opts.force ? null : await readCodeIndex(repoPath);
  const compatible =
    previous &&
    previous.version === CODE_INDEX_VERSION &&
    previous.embedModelId === opts.embedder.modelId &&
    previous.dims === opts.embedder.dims
      ? previous
      : null;

  const modelId = d3ModelId(opts.d3);
  const questions = buildQuestions(opts.taxonomy);
  const stateChars = stateCharBudget(questions, D3_UBATCH_TOKENS);

  const decisionCache = new Map<string, { decision: Decision; mode: CardMode }>();
  if (compatible && compatible.d3ModelId === modelId && compatible.taxonomyHash === opts.taxonomy.hash) {
    for (const stored of compatible.symbols) {
      if (stored.stateHash && stored.decision && stored.mode) {
        decisionCache.set(stored.stateHash, { decision: stored.decision, mode: stored.mode });
      }
    }
  }

  const decisions = new Map<string, DecisionEntry>();
  const stateHashes = new Map<string, string>();
  const pending: CodeSymbol[] = [];
  const modes: Record<CardMode, number> = { full: 0, excerpt: 0, skeleton: 0, header: 0 };
  let d3Reused = 0;
  if (opts.d3.mode !== "off") {
    for (const sym of symbols) {
      const stateHash = sha(`${decisionState(sym, stateChars).text}\0${opts.taxonomy.hash}\0${modelId}`);
      stateHashes.set(sym.id, stateHash);
      const cached = decisionCache.get(stateHash);
      if (cached) {
        decisions.set(sym.id, { ...cached, stateHash });
        modes[cached.mode]++;
        d3Reused++;
      } else {
        pending.push(sym);
      }
    }
  }

  let d3Failed = 0;
  let d3TotalMs = 0;
  const d3Started = Date.now();
  if (pending.length > 0 && opts.d3.mode !== "off") {
    const d3 = opts.d3;
    const server: D3Server =
      d3.mode === "managed"
        ? await startD3Server({
            quant: d3.quant,
            parallel: d3.parallel,
            ubatchTokens: D3_UBATCH_TOKENS,
            onStatus: status,
          })
        : { baseUrl: d3.url, modelId: modelId ?? d3.url, logPath: "", stop: async () => undefined };
    const model = d3.mode === "url" ? d3.model : undefined;
    let done = 0;
    const loopStarted = Date.now();
    try {
      await runPool(pending, d3.parallel, async (sym) => {
        try {
          const result = await decideSymbol({
            baseUrl: server.baseUrl,
            model,
            symbol: sym,
            questions,
            stateChars,
          });
          decisions.set(sym.id, {
            decision: result.decision,
            mode: result.mode,
            stateHash: stateHashes.get(sym.id)!,
          });
          modes[result.mode]++;
          d3TotalMs += result.ms;
        } catch (err) {
          d3Failed++;
          if (d3Failed <= 3) {
            status(`d3 failed for ${sym.id}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        done++;
        if (done === 1 || done % 10 === 0 || done === pending.length) {
          const elapsed = Date.now() - loopStarted;
          const rate = done / Math.max(1, elapsed / 1000);
          const eta = ((pending.length - done) / Math.max(rate, 0.001)) * 1000;
          status(`d3 ${done}/${pending.length} symbols · ${rate.toFixed(1)}/s · eta ${formatEta(eta)}`);
        }
      });
    } finally {
      await server.stop();
    }
  }
  const d3WallMs = pending.length > 0 ? Date.now() - d3Started : 0;
  const d3Asked = pending.length - d3Failed;

  const vectorCache = new Map<string, Float32Array>();
  if (compatible) {
    const { dims } = compatible;
    compatible.symbols.forEach((stored, i) => {
      vectorCache.set(stored.plainHash, compatible.plain.subarray(i * dims, (i + 1) * dims));
      vectorCache.set(stored.labeledHash, compatible.labeled.subarray(i * dims, (i + 1) * dims));
    });
  }

  const texts = symbols.map((sym) => {
    const entry = decisions.get(sym.id);
    const plain = embedText(sym);
    const labeled = entry ? embedText(sym, { decision: entry.decision, taxonomy: opts.taxonomy }) : plain;
    return { plain, labeled, plainHash: sha(plain), labeledHash: sha(labeled) };
  });

  const toEmbed = new Map<string, string>();
  for (const t of texts) {
    for (const [hash, text] of [
      [t.plainHash, t.plain],
      [t.labeledHash, t.labeled],
    ] as const) {
      if (!vectorCache.has(hash)) {
        toEmbed.set(hash, text);
      }
    }
  }
  const embedReused = texts.length * 2 - toEmbed.size;
  if (toEmbed.size > 0) {
    const hashes = [...toEmbed.keys()];
    let lastReported = 0;
    const vectors = await opts.embedder.embedDocuments([...toEmbed.values()], {
      onProgress: (doneCount, total) => {
        if (doneCount - lastReported >= 64 || doneCount === total) {
          lastReported = doneCount;
          status(`Embedding ${doneCount}/${total} cards`);
        }
      },
    });
    hashes.forEach((hash, i) => {
      const vec = vectors[i];
      if (vec && vec.length === opts.embedder.dims) {
        vectorCache.set(hash, normalize(vec));
      }
    });
  }

  const dims = opts.embedder.dims;
  const stored: StoredSymbol[] = [];
  const plainVectors: Float32Array[] = [];
  const labeledVectors: Float32Array[] = [];
  symbols.forEach((sym, i) => {
    const t = texts[i]!;
    const plainVec = vectorCache.get(t.plainHash);
    const labeledVec = vectorCache.get(t.labeledHash) ?? plainVec;
    if (!plainVec || !labeledVec) {
      return;
    }
    const entry = decisions.get(sym.id);
    stored.push({
      id: sym.id,
      relPath: sym.relPath,
      name: sym.name,
      qualifiedName: sym.qualifiedName,
      kind: sym.kind,
      exported: sym.exported,
      startLine: sym.startLine,
      endLine: sym.endLine,
      signature: sym.signature,
      doc: sym.doc,
      uses: sym.uses,
      refCount: sym.refCount,
      preview: sym.body.replace(/\s+/g, " ").trim().slice(0, 300),
      stateHash: entry?.stateHash ?? null,
      mode: entry?.mode ?? null,
      decision: entry?.decision ?? null,
      plainHash: t.plainHash,
      labeledHash: t.labeledHash,
    });
    plainVectors.push(plainVec);
    labeledVectors.push(labeledVec);
  });

  const plain = new Float32Array(stored.length * dims);
  const labeled = new Float32Array(stored.length * dims);
  plainVectors.forEach((vec, i) => plain.set(vec, i * dims));
  labeledVectors.forEach((vec, i) => labeled.set(vec, i * dims));

  const index: CodeIndex = {
    formatVersion: 1,
    version: CODE_INDEX_VERSION,
    repoPath,
    embedModelId: opts.embedder.modelId,
    dims,
    d3ModelId: modelId,
    taxonomyHash: opts.taxonomy.hash,
    updatedAt: new Date().toISOString(),
    symbols: stored,
    plain,
    labeled,
  };
  const path = await writeCodeIndex(index);

  return {
    index,
    path,
    stats: {
      files: files.length,
      extracted: extracted.length,
      symbols: stored.length,
      d3Asked,
      d3Reused,
      d3Failed,
      d3WallMs,
      d3AvgMs: d3Asked > 0 ? Math.round(d3TotalMs / d3Asked) : 0,
      modes,
      embedded: toEmbed.size,
      embedReused,
      ms: Date.now() - started,
    },
  };
}
