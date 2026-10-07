import type { DocStatus, DocType } from "./documents.ts";
import type { LoadedIndex } from "./index-file.ts";

export type SearchFilters = {
  types?: DocType[];
  status?: "open" | "done" | "any";
  limit?: number;
};

export type SearchHit = {
  relPath: string;
  type: DocType;
  status: DocStatus;
  title: string;
  score: number;
  frontmatter: Record<string, string | number>;
  matches: Array<{
    headingPath: string;
    startLine: number;
    endLine: number;
    score: number;
    preview: string;
  }>;
};

function clampLimit(limit: number | undefined): number {
  const n = limit ?? 8;
  if (!Number.isFinite(n)) {
    return 8;
  }
  return Math.min(25, Math.max(1, Math.trunc(n)));
}

function dot(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += a[i]! * b[i]!;
  }
  return sum;
}

function passesFilters(
  type: DocType,
  status: DocStatus,
  filters: SearchFilters | undefined,
): boolean {
  if (filters?.types && filters.types.length > 0 && !filters.types.includes(type)) {
    return false;
  }
  const statusFilter = filters?.status;
  if (!statusFilter || statusFilter === "any") {
    return true;
  }
  // status filter excludes reviews unless "any"
  if (status === null) {
    return false;
  }
  return status === statusFilter;
}

export function searchIndex(
  index: LoadedIndex,
  queryVector: Float32Array,
  filters?: SearchFilters,
): SearchHit[] {
  const { dims } = index.header;
  type ChunkScore = {
    relPath: string;
    headingPath: string;
    startLine: number;
    endLine: number;
    preview: string;
    score: number;
  };

  const scored: ChunkScore[] = [];
  for (let i = 0; i < index.header.chunks.length; i++) {
    const meta = index.header.chunks[i]!;
    const file = index.header.files[meta.relPath];
    if (!file) {
      continue;
    }
    if (!passesFilters(file.type, file.status, filters)) {
      continue;
    }
    const vec = index.vectors.subarray(i * dims, (i + 1) * dims);
    scored.push({
      relPath: meta.relPath,
      headingPath: meta.headingPath,
      startLine: meta.startLine,
      endLine: meta.endLine,
      preview: meta.preview,
      score: dot(queryVector, vec),
    });
  }

  const byFile = new Map<string, ChunkScore[]>();
  for (const s of scored) {
    let list = byFile.get(s.relPath);
    if (!list) {
      list = [];
      byFile.set(s.relPath, list);
    }
    list.push(s);
  }

  const hits: SearchHit[] = [];
  for (const [relPath, chunks] of byFile) {
    chunks.sort((a, b) => b.score - a.score);
    const top = chunks.slice(0, 2);
    const file = index.header.files[relPath]!;
    hits.push({
      relPath,
      type: file.type,
      status: file.status,
      title: file.title,
      score: top[0]!.score,
      frontmatter: file.frontmatter,
      matches: top.map((c) => ({
        headingPath: c.headingPath,
        startLine: c.startLine,
        endLine: c.endLine,
        score: c.score,
        preview: c.preview,
      })),
    });
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, clampLimit(filters?.limit));
}

function meanVector(vectors: Float32Array[], dims: number): Float32Array {
  const out = new Float32Array(dims);
  if (vectors.length === 0) {
    return out;
  }
  for (const v of vectors) {
    for (let i = 0; i < dims; i++) {
      out[i]! += v[i]!;
    }
  }
  for (let i = 0; i < dims; i++) {
    out[i]! /= vectors.length;
  }
  // L2-normalize so dot product ≈ cosine.
  let norm = 0;
  for (let i = 0; i < dims; i++) {
    norm += out[i]! * out[i]!;
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dims; i++) {
      out[i]! /= norm;
    }
  }
  return out;
}

export function findSimilar(
  index: LoadedIndex,
  relPath: string,
  filters?: SearchFilters,
): SearchHit[] {
  const file = index.header.files[relPath];
  if (!file) {
    throw new Error(`Not indexed: ${relPath}`);
  }
  const { dims } = index.header;
  const vectors: Float32Array[] = [];
  for (let i = 0; i < index.header.chunks.length; i++) {
    const meta = index.header.chunks[i]!;
    if (meta.relPath !== relPath) {
      continue;
    }
    vectors.push(index.vectors.subarray(i * dims, (i + 1) * dims));
  }
  const query = meanVector(vectors, dims);
  return searchIndex(index, query, filters).filter((h) => h.relPath !== relPath);
}

export function formatHits(hits: SearchHit[]): string {
  if (hits.length === 0) {
    return "No results.";
  }
  const blocks: string[] = [];
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i]!;
    const typeStatus = hit.status === null ? hit.type : `${hit.type}, ${hit.status}`;
    const header = `${i + 1}. [${typeStatus}] ${hit.title} — ${hit.relPath} (score ${hit.score.toFixed(2)})`;
    const lines = [header];
    for (const m of hit.matches) {
      const label = m.headingPath ? `${m.headingPath} ` : "";
      lines.push(`   ${label}(lines ${m.startLine}-${m.endLine}): ${m.preview}`);
    }
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
}
