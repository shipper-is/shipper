import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collapsePreview, readIndex, writeIndex, type LoadedIndex } from "./index-file.ts";

const temps: string[] = [];

afterEach(async () => {
  for (const dir of temps.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function sampleIndex(): LoadedIndex {
  const dims = 4;
  const vectors = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
  return {
    header: {
      formatVersion: 1,
      endianness: "le",
      repoPath: "/tmp/repo",
      modelId: "test-model",
      dims,
      chunkerVersion: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
      files: {
        ".shipper/plans/open/a.md": {
          type: "plan",
          status: "open",
          mtimeMs: 1,
          size: 10,
          contentHash: "abc",
          title: "A",
          frontmatter: {},
        },
      },
      chunks: [
        {
          relPath: ".shipper/plans/open/a.md",
          headingPath: "",
          startLine: 1,
          endLine: 5,
          textHash: "h1",
          preview: "hello",
        },
        {
          relPath: ".shipper/plans/open/a.md",
          headingPath: "Phase 1",
          startLine: 6,
          endLine: 10,
          textHash: "h2",
          preview: "world",
        },
      ],
    },
    vectors,
  };
}

describe("index-file", () => {
  it("round-trips an index", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shipper-idx-"));
    temps.push(dir);
    const path = join(dir, "repo.idx");
    const original = sampleIndex();
    await writeIndex(path, original);
    const loaded = await readIndex(path);
    expect(loaded).not.toBeNull();
    expect(loaded!.header).toEqual(original.header);
    expect([...loaded!.vectors]).toEqual([...original.vectors]);
  });

  it("returns null for corrupt magic", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shipper-idx-"));
    temps.push(dir);
    const path = join(dir, "bad.idx");
    await writeFile(path, Buffer.from("BADMAGIC1........"));
    expect(await readIndex(path)).toBeNull();
  });

  it("returns null for truncated vectors", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shipper-idx-"));
    temps.push(dir);
    const path = join(dir, "trunc.idx");
    await writeIndex(path, sampleIndex());
    const buf = await readFile(path);
    await writeFile(path, buf.subarray(0, buf.length - 8));
    expect(await readIndex(path)).toBeNull();
  });

  it("loads correctly from a Buffer with non-zero byteOffset", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shipper-idx-"));
    temps.push(dir);
    const path = join(dir, "offset.idx");
    const original = sampleIndex();
    await writeIndex(path, original);
    const raw = await readFile(path);
    // Simulate a pooled buffer with a non-zero offset by wrapping in a larger buffer.
    const pooled = Buffer.alloc(raw.length + 7);
    raw.copy(pooled, 7);
    const sliced = pooled.subarray(7);
    expect(sliced.byteOffset).toBeGreaterThan(0);

    // write the sliced view back and read via readIndex (which copies)
    await writeFile(path, sliced);
    const loaded = await readIndex(path);
    expect(loaded).not.toBeNull();
    expect([...loaded!.vectors]).toEqual([...original.vectors]);
  });

  it("collapses preview whitespace", () => {
    expect(collapsePreview("  a\n\nb  c  ", 10)).toBe("a b c");
  });
});
