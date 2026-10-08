import { realpath } from "node:fs/promises";
import { indexPathForRepo } from "../embeddings/paths.ts";
import type { ShipperDoc } from "./documents.ts";
import { readIndexHeader } from "./index-file.ts";

export type IndexStatus = {
  path: string;
  exists: boolean;
  files: number;
  chunks: number;
  updatedAt: string | null;
  modelId: string | null;
  stale: boolean;
};

function samePaths(indexed: Iterable<string>, docs: ShipperDoc[]): boolean {
  const docPaths = new Set(docs.map((doc) => doc.relPath));
  const indexedPaths = new Set(indexed);
  if (docPaths.size !== indexedPaths.size) {
    return false;
  }
  for (const path of docPaths) {
    if (!indexedPaths.has(path)) {
      return false;
    }
  }
  return true;
}

export async function getIndexStatus(repoRoot: string, docs: ShipperDoc[]): Promise<IndexStatus> {
  const realRepo = await realpath(repoRoot).catch(() => repoRoot);
  const path = indexPathForRepo(realRepo);
  const header = await readIndexHeader(path);
  if (!header) {
    return {
      path,
      exists: false,
      files: 0,
      chunks: 0,
      updatedAt: null,
      modelId: null,
      stale: true,
    };
  }

  const updatedMs = Date.parse(header.updatedAt);
  let stale = !samePaths(Object.keys(header.files), docs) || !Number.isFinite(updatedMs);
  if (!stale) {
    for (const doc of docs) {
      if (doc.mtimeMs > updatedMs) {
        stale = true;
        break;
      }
    }
  }

  return {
    path,
    exists: true,
    files: Object.keys(header.files).length,
    chunks: header.chunks.length,
    updatedAt: header.updatedAt,
    modelId: header.modelId,
    stale,
  };
}
