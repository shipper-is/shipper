import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHUNKER_VERSION, chunkMarkdown } from "./chunker.ts";

const fixturePath = join(
  import.meta.dirname,
  "../../.shipper/plans/done/shipper-cli-foundation.md",
);
const fixture = readFileSync(fixturePath, "utf8");

describe("chunkMarkdown", () => {
  it("exports CHUNKER_VERSION", () => {
    expect(CHUNKER_VERSION).toBe(1);
  });

  it("splits a plan into heading paths with correct line ranges", () => {
    const pad = "padding ".repeat(40);
    const md = `---
type: plan
---

# Sample Plan

Intro paragraph. ${pad}

## Phase 1: Setup

Setup body. ${pad}

### Section 1

Section one body. ${pad}

## Phase 2: Build

Build body. ${pad}
`;
    const chunks = chunkMarkdown(md, { title: "Sample Plan", type: "plan" });
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks.some((c) => c.headingPath === "" || c.headingPath.startsWith("Phase"))).toBe(
      true,
    );
    expect(chunks.some((c) => c.headingPath === "Phase 1: Setup > Section 1")).toBe(true);
    expect(chunks.some((c) => c.headingPath === "Phase 2: Build")).toBe(true);
    for (const c of chunks) {
      expect(c.startLine).toBeGreaterThan(0);
      expect(c.endLine).toBeGreaterThanOrEqual(c.startLine);
      expect(c.embedText.startsWith("Plan: Sample Plan")).toBe(true);
      expect(c.textHash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("ignores headings inside fenced blocks", () => {
    const md = `# Title

Preamble text that is long enough not to merge away immediately when we add a following section with adequate length. Padding padding padding padding.

\`\`\`ts
## Phase 9
# comment
\`\`\`

## Real Phase

Real body that is long enough to stand alone after the fence. Padding padding padding padding padding padding padding padding padding.
`;
    const chunks = chunkMarkdown(md, { title: "Title", type: "plan" });
    expect(chunks.every((c) => !c.headingPath.includes("Phase 9"))).toBe(true);
    expect(chunks.some((c) => c.headingPath === "Real Phase")).toBe(true);
    expect(chunks.some((c) => c.text.includes("## Phase 9"))).toBe(true);
  });

  it("merges tiny sections into neighbors", () => {
    const md = `# Title

## Tiny A

x

## Tiny B

y

## Big Enough Section

${"word ".repeat(80)}
`;
    const chunks = chunkMarkdown(md, { title: "Title", type: "plan" });
    expect(chunks.length).toBeLessThan(4);
    const big = chunks.find((c) => c.headingPath.includes("Big Enough") || c.text.includes("word"));
    expect(big).toBeDefined();
  });

  it("splits a 10000-character section into pieces of at most 4000", () => {
    const body = ("paragraph text goes here. ".repeat(20) + "\n\n").repeat(20);
    expect(body.length).toBeGreaterThan(10_000);
    const md = `# Title

## Huge

${body}
`;
    const chunks = chunkMarkdown(md, { title: "Title", type: "plan" });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(4000);
      expect(c.headingPath).toBe("Huge");
    }
  });

  it("yields one chunk for a flat spike checklist", () => {
    const md = `# Spike

- [ ] one
- [ ] two
- [ ] three
`;
    const chunks = chunkMarkdown(md, { title: "Spike", type: "spike" });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.headingPath).toBe("");
    expect(chunks[0]!.embedText.startsWith("Spike: Spike")).toBe(true);
  });

  it("keeps bug Symptom and Root Cause as separate chunks when long enough", () => {
    const pad = "padding ".repeat(50);
    const md = `# Bug

## Symptom

Something broke. ${pad}

## Root Cause

Because of X. ${pad}
`;
    const chunks = chunkMarkdown(md, { title: "Bug", type: "bug" });
    expect(chunks.some((c) => c.headingPath === "Symptom")).toBe(true);
    expect(chunks.some((c) => c.headingPath === "Root Cause")).toBe(true);
  });

  it("keeps every chunk of a real done plan under 4000 characters", () => {
    const chunks = chunkMarkdown(fixture, {
      title: "Shipper CLI Foundation",
      type: "plan",
    });
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(4000);
    }
  });
});
