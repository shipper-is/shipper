import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  emptyPlanMeta,
  getPlanProgress,
  parseFrontmatter,
  parsePlan,
} from "./plan-store.ts";

const fixturePath = join(
  import.meta.dirname,
  "../../.shipper/done/shipper-cli-foundation.md",
);
const fixture = readFileSync(fixturePath, "utf8");

describe("parsePlan", () => {
  it("extracts the plan title from the first H1", () => {
    const parsed = parsePlan(fixture);
    expect(parsed.title).toBe("Shipper CLI Foundation");
  });

  it("finds all six phases", () => {
    const parsed = parsePlan(fixture);
    expect(parsed.phases).toHaveLength(6);
    expect(parsed.phases.map((p) => p.number)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("parses phase titles", () => {
    const parsed = parsePlan(fixture);
    expect(parsed.phases[0]!.title).toBe("Project scaffolding and core plumbing");
    expect(parsed.phases[1]!.title).toBe("Agent adapter layer");
  });

  it("groups checklist items by section within a phase", () => {
    const parsed = parsePlan(fixture);
    const phase1 = parsed.phases[0]!;
    expect(phase1.sections.length).toBeGreaterThanOrEqual(4);

    const section11 = phase1.sections.find((s) =>
      s.title.includes("1.1"),
    );
    expect(section11).toBeDefined();
    expect(section11!.items.length).toBeGreaterThan(0);
    expect(section11!.checkedCount).toBe(section11!.items.length);
  });

  it("counts total checkboxes across the plan", () => {
    const parsed = parsePlan(fixture);
    expect(parsed.totalChecked + parsed.totalUnchecked).toBeGreaterThan(50);
    expect(parsed.totalChecked).toBeGreaterThan(parsed.totalUnchecked);
  });

  it("reports completion notes on finished phases", () => {
    const parsed = parsePlan(fixture);
    expect(parsed.phases[0]!.hasCompletionNotes).toBe(true);
    expect(parsed.phases[1]!.hasCompletionNotes).toBe(true);
  });

  it("detects completion notes when present", () => {
    const withNotes = `${fixture}\n\n### Completion Notes\n- shipped phase 1\n`;
    const parsed = parsePlan(withNotes);
    const lastPhase = parsed.phases[parsed.phases.length - 1]!;
    expect(lastPhase.hasCompletionNotes).toBe(true);
  });

  it("never throws on malformed markdown", () => {
    expect(() => parsePlan("")).not.toThrow();
    expect(() => parsePlan("### random\n- [ ] item\nno phases here")).not.toThrow();

    const parsed = parsePlan("### random\n- [ ] lone item\n");
    expect(parsed.phases.length).toBeGreaterThanOrEqual(1);
    expect(parsed.totalUnchecked).toBeGreaterThanOrEqual(1);
  });

  it("tracks checked vs unchecked items", () => {
    const md = `# Test\n\n## Phase 1: One\n### S\n- [x] done\n- [ ] todo\n`;
    const parsed = parsePlan(md);
    expect(parsed.totalChecked).toBe(1);
    expect(parsed.totalUnchecked).toBe(1);
  });
});

describe("getPlanProgress", () => {
  it("identifies the first incomplete phase", () => {
    const parsed = parsePlan(fixture);
    const progress = getPlanProgress(parsed);
    expect(progress.currentPhase).toBeNull();
    expect(progress.phaseCount).toBe(6);
  });

  it("finds the first incomplete phase in a partially done plan", () => {
    const md = `# Partial\n\n## Phase 1: A\n### S\n- [x] a\n\n### Completion Notes\nok\n\n## Phase 2: B\n### S\n- [ ] b\n`;
    const parsed = parsePlan(md);
    const progress = getPlanProgress(parsed);
    expect(progress.currentPhase).toBe(2);
  });

  it("returns null current phase when all phases are done", () => {
    const md = `# Done Plan\n\n## Phase 1: A\n### S\n- [x] a\n\n### Completion Notes\nok\n`;
    const parsed = parsePlan(md);
    const progress = getPlanProgress(parsed);
    expect(progress.currentPhase).toBeNull();
  });
});

const FULL_FRONTMATTER = `---
branch: shipper/plan-completion-metadata
started_at: "2026-07-04T22:15:00-05:00"
completed_at: "2026-07-05T01:40:00-05:00"
pr_url: https://github.com/owner/repo/pull/123
pr_number: 123
---
# Plan With Metadata

## Phase 1: First

### Section A

- [x] done item
- [ ] todo item
`;

describe("parseFrontmatter", () => {
  it("parses all five fields from a complete frontmatter block", () => {
    const meta = parseFrontmatter(FULL_FRONTMATTER);
    expect(meta).toEqual({
      branch: "shipper/plan-completion-metadata",
      startedAt: "2026-07-04T22:15:00-05:00",
      completedAt: "2026-07-05T01:40:00-05:00",
      prUrl: "https://github.com/owner/repo/pull/123",
      prNumber: 123,
    });
  });

  it("returns empty meta when frontmatter is absent", () => {
    expect(parseFrontmatter("# No frontmatter\n\n## Phase 1\n")).toEqual(
      emptyPlanMeta(),
    );
    expect(parseFrontmatter(fixture)).toEqual(emptyPlanMeta());
  });

  it("returns empty meta for malformed YAML", () => {
    const md = `---
branch: [unclosed
---
# Title
`;
    expect(parseFrontmatter(md)).toEqual(emptyPlanMeta());
  });

  it("nulls wrong-typed values", () => {
    const md = `---
branch: 42
started_at: true
completed_at: 3.14
pr_url: 99
pr_number: abc
---
# Title
`;
    expect(parseFrontmatter(md)).toEqual(emptyPlanMeta());
  });

  it("coerces numeric pr_number from a string", () => {
    const md = `---
pr_number: "456"
---
# Title
`;
    expect(parseFrontmatter(md).prNumber).toBe(456);
  });

  it("ignores frontmatter not on line 1", () => {
    const md = `# Title first

---
branch: ignored
---
`;
    expect(parseFrontmatter(md)).toEqual(emptyPlanMeta());
  });
});

describe("parsePlan with frontmatter", () => {
  it("still finds title, phases, and checklist items", () => {
    const parsed = parsePlan(FULL_FRONTMATTER);
    expect(parsed.title).toBe("Plan With Metadata");
    expect(parsed.phases).toHaveLength(1);
    expect(parsed.phases[0]!.title).toBe("First");
    expect(parsed.phases[0]!.sections[0]!.title).toBe("Section A");
    expect(parsed.phases[0]!.sections[0]!.items).toHaveLength(2);
    expect(parsed.totalChecked).toBe(1);
    expect(parsed.totalUnchecked).toBe(1);
  });

  it("preserves absolute line numbers for checklist items", () => {
    const parsed = parsePlan(FULL_FRONTMATTER);
    const items = parsed.phases[0]!.sections[0]!.items;
    expect(items[0]!.line).toBe(14);
    expect(items[1]!.line).toBe(15);
  });
});
