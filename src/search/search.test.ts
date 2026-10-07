import { describe, expect, it } from "vitest";
import type { LoadedIndex } from "./index-file.ts";
import { findSimilar, formatHits, searchIndex } from "./search.ts";

function buildIndex(): LoadedIndex {
  const dims = 3;
  // File A chunk0 ~ [1,0,0], chunk1 ~ [0.7,0.7,0]
  // File B chunk0 ~ [0,1,0]
  // File C review ~ [0,0,1]
  const vectors = new Float32Array([
    1, 0, 0, // A0
    0.7071, 0.7071, 0, // A1
    0, 1, 0, // B0
    0, 0, 1, // C0
  ]);
  return {
    header: {
      formatVersion: 1,
      endianness: "le",
      repoPath: "/tmp/r",
      modelId: "t",
      dims,
      chunkerVersion: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
      files: {
        ".shipper/plans/done/a.md": {
          type: "plan",
          status: "done",
          mtimeMs: 1,
          size: 1,
          contentHash: "a",
          title: "Plan A",
          frontmatter: { branch: "main" },
        },
        ".shipper/plans/open/b.md": {
          type: "plan",
          status: "open",
          mtimeMs: 1,
          size: 1,
          contentHash: "b",
          title: "Plan B",
          frontmatter: {},
        },
        ".shipper/reviews/c.md": {
          type: "review",
          status: null,
          mtimeMs: 1,
          size: 1,
          contentHash: "c",
          title: "Review C",
          frontmatter: { merge_risk: "low" },
        },
      },
      chunks: [
        {
          relPath: ".shipper/plans/done/a.md",
          headingPath: "Phase 1",
          startLine: 10,
          endLine: 20,
          textHash: "a0",
          preview: "alpha one",
        },
        {
          relPath: ".shipper/plans/done/a.md",
          headingPath: "Phase 2 > Section 1",
          startLine: 21,
          endLine: 40,
          textHash: "a1",
          preview: "alpha two",
        },
        {
          relPath: ".shipper/plans/open/b.md",
          headingPath: "Only",
          startLine: 5,
          endLine: 15,
          textHash: "b0",
          preview: "beta",
        },
        {
          relPath: ".shipper/reviews/c.md",
          headingPath: "",
          startLine: 1,
          endLine: 8,
          textHash: "c0",
          preview: "review body",
        },
      ],
    },
    vectors,
  };
}

describe("searchIndex", () => {
  it("ranks by best chunk score and keeps top 2 matches", () => {
    const index = buildIndex();
    const hits = searchIndex(index, new Float32Array([1, 0, 0]));
    expect(hits[0]!.relPath).toBe(".shipper/plans/done/a.md");
    expect(hits[0]!.matches).toHaveLength(2);
    expect(hits[0]!.matches[0]!.headingPath).toBe("Phase 1");
    expect(hits[0]!.score).toBeCloseTo(1, 3);
  });

  it("filters by type and status", () => {
    const index = buildIndex();
    const openOnly = searchIndex(index, new Float32Array([0, 1, 0]), {
      status: "open",
      types: ["plan"],
    });
    expect(openOnly).toHaveLength(1);
    expect(openOnly[0]!.relPath).toBe(".shipper/plans/open/b.md");

    const donePlans = searchIndex(index, new Float32Array([1, 0, 0]), {
      status: "done",
    });
    expect(donePlans.every((h) => h.status === "done")).toBe(true);
    expect(donePlans.every((h) => h.type !== "review")).toBe(true);
  });

  it("clamps limit between 1 and 25", () => {
    const index = buildIndex();
    expect(searchIndex(index, new Float32Array([1, 0, 0]), { limit: 0 })).toHaveLength(1);
    expect(searchIndex(index, new Float32Array([1, 0, 0]), { limit: 100 })).toHaveLength(3);
  });
});

describe("findSimilar", () => {
  it("excludes the source file and throws when missing", () => {
    const index = buildIndex();
    const hits = findSimilar(index, ".shipper/plans/done/a.md");
    expect(hits.every((h) => h.relPath !== ".shipper/plans/done/a.md")).toBe(true);
    expect(() => findSimilar(index, ".shipper/plans/open/missing.md")).toThrow(
      /Not indexed/,
    );
  });
});

describe("formatHits", () => {
  it("formats hits as markdown-ish text", () => {
    const index = buildIndex();
    const hits = searchIndex(index, new Float32Array([1, 0, 0]), { limit: 1 });
    const text = formatHits(hits);
    expect(text).toContain("1. [plan, done] Plan A — .shipper/plans/done/a.md (score ");
    expect(text).toContain("Phase 1 (lines 10-20): alpha one");
    expect(text).toContain("Phase 2 > Section 1 (lines 21-40): alpha two");
  });

  it("returns No results for empty", () => {
    expect(formatHits([])).toBe("No results.");
  });
});
