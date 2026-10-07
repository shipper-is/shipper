import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyPlanMeta, parseFrontmatter } from "./frontmatter.ts";

const fixturePath = join(
  import.meta.dirname,
  "../../.shipper/plans/done/shipper-cli-foundation.md",
);
const fixture = readFileSync(fixturePath, "utf8");

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
  it("parses all metadata fields from a complete frontmatter block", () => {
    const meta = parseFrontmatter(FULL_FRONTMATTER);
    expect(meta).toEqual({
      type: "plan",
      branch: "shipper/plan-completion-metadata",
      baseBranch: null,
      startedAt: "2026-07-04T22:15:00-05:00",
      completedAt: "2026-07-05T01:40:00-05:00",
      phaseCommits: {},
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

  it("maps type: spike to spike", () => {
    const md = `---
type: spike
---
# Spike
`;
    expect(parseFrontmatter(md).type).toBe("spike");
  });

  it("maps type: plan, missing type, and unknown values to plan", () => {
    const planMd = `---
type: plan
---
# Plan
`;
    expect(parseFrontmatter(planMd).type).toBe("plan");

    const missingMd = `---
branch: foo
---
# Plan
`;
    expect(parseFrontmatter(missingMd).type).toBe("plan");
    expect(parseFrontmatter("# No frontmatter").type).toBe("plan");

    const unknownMd = `---
type: feature
---
# Plan
`;
    expect(parseFrontmatter(unknownMd).type).toBe("plan");
  });

  it("parses base_branch and phase_commits", () => {
    const md = `---
base_branch: main
phase_commits:
  1: abc1234
  2: def5678
---
# Plan
`;
    const meta = parseFrontmatter(md);
    expect(meta.baseBranch).toBe("main");
    expect(meta.phaseCommits).toEqual({ 1: "abc1234", 2: "def5678" });
  });

  it("ignores legacy worktree frontmatter keys", () => {
    const md = `---
worktree: .shipper/worktrees/my-plan
---
# Plan
`;
    expect(parseFrontmatter(md)).toEqual(emptyPlanMeta());
  });

  it("normalizes phase_commits keys whether YAML yields numbers or strings", () => {
    const md = `---
phase_commits:
  "1": sha111
  2: sha222
---
# Plan
`;
    expect(parseFrontmatter(md).phaseCommits).toEqual({
      1: "sha111",
      2: "sha222",
    });
  });

  it("skips non-string phase_commits values and invalid keys", () => {
    const md = `---
phase_commits:
  0: zero
  1: valid
  two: bad
  3: 42
---
# Plan
`;
    expect(parseFrontmatter(md).phaseCommits).toEqual({ 1: "valid" });
  });

  it("defaults missing git ledger keys to null or empty object", () => {
    const md = `---
branch: shipper/foo
---
# Plan
`;
    const meta = parseFrontmatter(md);
    expect(meta.baseBranch).toBeNull();
    expect(meta.phaseCommits).toEqual({});
  });
});
