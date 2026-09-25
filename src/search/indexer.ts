import { readFile, realpath } from "node:fs/promises";
import type { Embedder } from "../embeddings/client.ts";
import { indexPathForRepo } from "../embeddings/paths.ts";
import { CHUNKER_VERSION, chunkMarkdown, type Chunk } from "./chunker.ts";
import {
  contentHash,
  discoverDocs,
  readDocMetadata,
  type DocStatus,
  type DocType,
  type ShipperDoc,
} from "./documents.ts";
import {
  collapsePreview,
  readIndex,
  writeIndex,
  type IndexHeader,
  type LoadedIndex,
} from "./index-file.ts";

export type SyncStats = {
  files: number;
  chunks: number;
  embedded: number;
  reused: number;
  removed: number;
  ms: number;
};

export type SyncResult = {
  index: LoadedIndex;
  stats: SyncStats;
};

type SyncOpts = {
  repoRoot: string;
  embedder: Embedder;
  force?: boolean;
  onProgress?: (message: string) => void;
};

const inFlight = new Map<string, Promise<SyncResult>>();
const lastSyncAt = new Map<string, number>();


function vectorMapFromIndex(index: LoadedIndex): Map<string, Float32Array> {
  const map = new Map<string, Float32Array>();
  const { dims } = index.header;
  for (let i = 0; i < index.header.chunks.length; i++) {
    const meta = index.header.chunks[i]!;
    const vec = index.vectors.subarray(i * dims, (i + 1) * dims);
    // Prefer first occurrence; identical textHash should share the same vector.
    if (!map.has(meta.textHash)) {
      map.set(meta.textHash, Float32Array.from(vec));
    }
  }
  return map;
}

type FileWork = {
  kind: "rechunk";
  doc: ShipperDoc;
  title: string;
  frontmatter: Record<string, string | number>;
  contentHash: string;
  chunks: Chunk[];
};

type KeepWork = {
  kind: "keep";
  doc: ShipperDoc;
  file: IndexHeader["files"][string];
};

async function prepareFile(
  doc: ShipperDoc,
  existing: IndexHeader | null,
  force: boolean,
): Promise<FileWork | KeepWork | null> {
  const prior = existing?.files[doc.relPath];
  if (
    !force &&
    prior &&
    prior.mtimeMs === doc.mtimeMs &&
    prior.size === doc.size
  ) {
    return { kind: "keep", doc, file: prior };
  }

  let markdown: string;
  try {
    markdown = await readFile(doc.absPath, "utf8");
  } catch {
    return null;
  }

  const hash = contentHash(markdown);
  const { title, frontmatter } = readDocMetadata(markdown, doc);

  if (!force && prior && prior.contentHash === hash) {
    return {
      kind: "keep",
      doc,
      file: {
        ...prior,
        mtimeMs: doc.mtimeMs,
        size: doc.size,
        title,
        frontmatter,
      },
    };
  }

  const chunks = chunkMarkdown(markdown, { title, type: doc.type });
  return {
    kind: "rechunk",
    doc,
    title,
    frontmatter,
    contentHash: hash,
    chunks,
  };
}

async function syncIndexInner(opts: SyncOpts): Promise<SyncResult> {
  const started = Date.now();
  const repoPath = await realpath(opts.repoRoot);
  const indexPath = indexPathForRepo(repoPath);
  const force = opts.force === true;

  let existing = force ? null : await readIndex(indexPath);
  if (existing) {
    const h = existing.header;
    if (
      h.modelId !== opts.embedder.modelId ||
      h.dims !== opts.embedder.dims ||
      h.chunkerVersion !== CHUNKER_VERSION ||
      h.repoPath !== repoPath
    ) {
      existing = null;
    }
  }

  const docs = await discoverDocs(repoPath);
  opts.onProgress?.(`Discovering ${docs.length} documents…`);

  const oldVectors = existing ? vectorMapFromIndex(existing) : new Map<string, Float32Array>();
  const keptByPath = new Map<
    string,
    { file: IndexHeader["files"][string]; chunkIndices: number[] }
  >();

  if (existing) {
    for (let i = 0; i < existing.header.chunks.length; i++) {
      const c = existing.header.chunks[i]!;
      let entry = keptByPath.get(c.relPath);
      if (!entry) {
        const file = existing.header.files[c.relPath];
        if (!file) {
          continue;
        }
        entry = { file, chunkIndices: [] };
        keptByPath.set(c.relPath, entry);
      }
      entry.chunkIndices.push(i);
    }
  }

  const newFiles: IndexHeader["files"] = {};
  const newChunks: IndexHeader["chunks"] = [];
  const newVectors: Float32Array[] = [];

  let embedded = 0;
  let reused = 0;
  let removed = 0;
  let changed = force || !existing;

  const toEmbed: Array<{ chunk: Chunk; relPath: string; placeIndex: number }> = [];
  const pendingPlaces: Array<{
    relPath: string;
    headingPath: string;
    startLine: number;
    endLine: number;
    textHash: string;
    preview: string;
    vector: Float32Array | null;
  }> = [];

  const docRelPaths = new Set(docs.map((d) => d.relPath));

  if (existing) {
    for (const relPath of Object.keys(existing.header.files)) {
      if (!docRelPaths.has(relPath)) {
        removed += 1;
        changed = true;
      }
    }
  }

  for (const doc of docs) {
    const prepared = await prepareFile(doc, existing?.header ?? null, force);
    if (!prepared) {
      continue;
    }

    if (prepared.kind === "keep") {
      newFiles[doc.relPath] = prepared.file;
      const prior = keptByPath.get(doc.relPath);
      const existingFile = existing?.header.files[doc.relPath];
      if (
        existingFile &&
        (existingFile.mtimeMs !== prepared.file.mtimeMs ||
          existingFile.size !== prepared.file.size ||
          existingFile.title !== prepared.file.title)
      ) {
        changed = true;
      }
      if (prior && existing) {
        for (const idx of prior.chunkIndices) {
          const meta = existing.header.chunks[idx]!;
          const vec = existing.vectors.subarray(
            idx * existing.header.dims,
            (idx + 1) * existing.header.dims,
          );
          pendingPlaces.push({
            relPath: meta.relPath,
            headingPath: meta.headingPath,
            startLine: meta.startLine,
            endLine: meta.endLine,
            textHash: meta.textHash,
            preview: meta.preview,
            vector: Float32Array.from(vec),
          });
          reused += 1;
        }
      }
      continue;
    }

    changed = true;
    const work = prepared;
    newFiles[doc.relPath] = {
      type: doc.type,
      status: doc.status,
      mtimeMs: doc.mtimeMs,
      size: doc.size,
      contentHash: work.contentHash,
      title: work.title,
      frontmatter: work.frontmatter,
    };

    for (const chunk of work.chunks) {
      const cached = oldVectors.get(chunk.textHash);
      if (cached) {
        pendingPlaces.push({
          relPath: doc.relPath,
          headingPath: chunk.headingPath,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          textHash: chunk.textHash,
          preview: collapsePreview(chunk.text),
          vector: Float32Array.from(cached),
        });
        reused += 1;
      } else {
        const placeIndex = pendingPlaces.length;
        pendingPlaces.push({
          relPath: doc.relPath,
          headingPath: chunk.headingPath,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          textHash: chunk.textHash,
          preview: collapsePreview(chunk.text),
          vector: null,
        });
        toEmbed.push({ chunk, relPath: doc.relPath, placeIndex });
      }
    }
  }

  if (toEmbed.length > 0) {
    opts.onProgress?.(`Embedding ${toEmbed.length} chunks…`);
    const vectors = await opts.embedder.embedDocuments(toEmbed.map((t) => t.chunk.embedText));
    for (let i = 0; i < toEmbed.length; i++) {
      const item = toEmbed[i]!;
      const vec = vectors[i];
      const place = pendingPlaces[item.placeIndex];
      if (!place) {
        continue;
      }
      if (!vec || vec.length === 0 || vec.length !== opts.embedder.dims) {
        // Drop skipped items (Gotcha 4 / zero-length Float32Array).
        place.vector = null;
        continue;
      }
      place.vector = vec;
      embedded += 1;
    }
  }

  for (const place of pendingPlaces) {
    if (!place.vector) {
      continue;
    }
    newChunks.push({
      relPath: place.relPath,
      headingPath: place.headingPath,
      startLine: place.startLine,
      endLine: place.endLine,
      textHash: place.textHash,
      preview: place.preview,
    });
    newVectors.push(place.vector);
  }

  const dims = opts.embedder.dims;
  const packed = new Float32Array(newChunks.length * dims);
  for (let i = 0; i < newVectors.length; i++) {
    packed.set(newVectors[i]!, i * dims);
  }

  const header: IndexHeader = {
    formatVersion: 1,
    endianness: "le",
    repoPath,
    modelId: opts.embedder.modelId,
    dims,
    chunkerVersion: CHUNKER_VERSION,
    updatedAt: new Date().toISOString(),
    files: newFiles,
    chunks: newChunks,
  };

  const index: LoadedIndex = { header, vectors: packed };

  if (changed) {
    await writeIndex(indexPath, index);
  } else if (existing) {
    return {
      index: existing,
      stats: {
        files: Object.keys(existing.header.files).length,
        chunks: existing.header.chunks.length,
        embedded: 0,
        reused: existing.header.chunks.length,
        removed: 0,
        ms: Date.now() - started,
      },
    };
  }

  return {
    index,
    stats: {
      files: Object.keys(newFiles).length,
      chunks: newChunks.length,
      embedded,
      reused,
      removed,
      ms: Date.now() - started,
    },
  };
}

export async function syncIndex(opts: SyncOpts): Promise<SyncResult> {
  const key = await realpath(opts.repoRoot).catch(() => opts.repoRoot);
  const existing = inFlight.get(key);
  if (existing) {
    return existing;
  }
  const promise = syncIndexInner(opts).finally(() => {
    inFlight.delete(key);
    lastSyncAt.set(key, Date.now());
  });
  inFlight.set(key, promise);
  return promise;
}

export async function syncIndexIfStale(opts: SyncOpts): Promise<SyncResult> {
  const key = await realpath(opts.repoRoot).catch(() => opts.repoRoot);
  const last = lastSyncAt.get(key);
  if (last !== undefined && Date.now() - last < 2000) {
    const indexPath = indexPathForRepo(key);
    const loaded = await readIndex(indexPath);
    if (loaded) {
      return {
        index: loaded,
        stats: {
          files: Object.keys(loaded.header.files).length,
          chunks: loaded.header.chunks.length,
          embedded: 0,
          reused: loaded.header.chunks.length,
          removed: 0,
          ms: 0,
        },
      };
    }
  }
  return syncIndex(opts);
}

// Re-export types used by callers
export type { DocStatus, DocType };
