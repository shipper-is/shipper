import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { DocStatus, DocType } from "./documents.ts";

export type IndexHeader = {
  formatVersion: 1;
  endianness: "le";
  repoPath: string;
  modelId: string;
  dims: number;
  chunkerVersion: number;
  updatedAt: string;
  files: Record<
    string,
    {
      type: DocType;
      status: DocStatus;
      mtimeMs: number;
      size: number;
      contentHash: string;
      title: string;
      frontmatter: Record<string, string | number>;
    }
  >;
  chunks: Array<{
    relPath: string;
    headingPath: string;
    startLine: number;
    endLine: number;
    textHash: string;
    preview: string;
  }>;
};

export type LoadedIndex = {
  header: IndexHeader;
  vectors: Float32Array;
};

const MAGIC = Buffer.from("SHIPIDX1", "utf8");

export function collapsePreview(text: string, max = 400): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

function isValidHeader(value: unknown): value is IndexHeader {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const h = value as Record<string, unknown>;
  return (
    h.formatVersion === 1 &&
    h.endianness === "le" &&
    typeof h.repoPath === "string" &&
    typeof h.modelId === "string" &&
    typeof h.dims === "number" &&
    typeof h.chunkerVersion === "number" &&
    typeof h.updatedAt === "string" &&
    h.files !== null &&
    typeof h.files === "object" &&
    !Array.isArray(h.files) &&
    Array.isArray(h.chunks)
  );
}

export async function readIndex(path: string): Promise<LoadedIndex | null> {
  let buf: Buffer;
  try {
    buf = await readFile(path);
  } catch {
    return null;
  }

  if (buf.length < 12) {
    return null;
  }
  if (!buf.subarray(0, 8).equals(MAGIC)) {
    return null;
  }

  const headerLen = buf.readUInt32LE(8);
  const headerStart = 12;
  const headerEnd = headerStart + headerLen;
  if (headerEnd > buf.length) {
    return null;
  }

  let header: IndexHeader;
  try {
    const parsed: unknown = JSON.parse(buf.subarray(headerStart, headerEnd).toString("utf8"));
    if (!isValidHeader(parsed)) {
      return null;
    }
    header = parsed;
  } catch {
    return null;
  }

  if (header.endianness !== "le") {
    return null;
  }

  const paddedHeaderEnd = headerEnd + ((4 - (headerEnd % 4)) % 4);
  const expectedFloats = header.chunks.length * header.dims;
  const expectedBytes = expectedFloats * 4;
  if (paddedHeaderEnd + expectedBytes > buf.length) {
    return null;
  }
  if (buf.length - paddedHeaderEnd < expectedBytes) {
    return null;
  }

  // Copy into a fresh ArrayBuffer so the Float32Array offset is always 0 (Gotcha 17).
  const vectorBytes = buf.subarray(paddedHeaderEnd, paddedHeaderEnd + expectedBytes);
  const copy = new ArrayBuffer(expectedBytes);
  new Uint8Array(copy).set(vectorBytes);
  const vectors = new Float32Array(copy);

  if (vectors.length !== expectedFloats) {
    return null;
  }

  return { header, vectors };
}

export async function writeIndex(path: string, index: LoadedIndex): Promise<void> {
  const { header, vectors } = index;
  const headerJson = Buffer.from(JSON.stringify(header), "utf8");
  const headerLen = headerJson.length;
  const headerEnd = 12 + headerLen;
  const padLen = (4 - (headerEnd % 4)) % 4;
  const expectedFloats = header.chunks.length * header.dims;
  if (vectors.length !== expectedFloats) {
    throw new Error(
      `Index vector length mismatch: expected ${expectedFloats}, got ${vectors.length}`,
    );
  }

  const out = Buffer.alloc(headerEnd + padLen + expectedFloats * 4);
  MAGIC.copy(out, 0);
  out.writeUInt32LE(headerLen, 8);
  headerJson.copy(out, 12);
  Buffer.from(vectors.buffer, vectors.byteOffset, vectors.byteLength).copy(out, headerEnd + padLen);

  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  try {
    await writeFile(tmp, out);
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}
