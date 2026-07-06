import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  emptyPlanMeta,
  findPlanByFilename,
  getPlanProgress,
  listPlans,
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

describe("listPlans", () => {
  async function makeRepoLayout(): Promise<string> {
    const repoPath = await mkdtemp(join(tmpdir(), "shipper-plan-store-"));
    await mkdir(join(repoPath, ".shipper", "open"), { recursive: true });
    await mkdir(join(repoPath, ".shipper", "done"), { recursive: true });
    return repoPath;
  }

  const SIMPLE_PLAN = `---
type: plan
---
# Test Plan

## Phase 1: One

### S

- [ ] task
`;

  it("lists plans from the main checkout open and done folders", async () => {
    const repoPath = await makeRepoLayout();
    await writeFile(join(repoPath, ".shipper", "open", "my-plan.md"), SIMPLE_PLAN, "utf8");

    const plans = await listPlans(repoPath);
    expect(plans.open).toHaveLength(1);
    expect(plans.open[0]!.filename).toBe("my-plan.md");
    expect(plans.open[0]!.path).toBe(join(repoPath, ".shipper", "open", "my-plan.md"));

    await rm(repoPath, { recursive: true, force: true });
  });

  it("removes leftover symlinks in open, done, and plans folders", async () => {
    const repoPath = await makeRepoLayout();
    const realPlanPath = join(repoPath, ".shipper", "open", "real-plan.md");
    await writeFile(realPlanPath, SIMPLE_PLAN, "utf8");

    const danglingLink = join(repoPath, ".shipper", "open", "stale-link.md");
    await symlink("../worktrees/gone/.shipper/open/stale-link.md", danglingLink);

    const plansDir = join(repoPath, ".shipper", "plans");
    await mkdir(plansDir, { recursive: true });
    const legacyLink = join(plansDir, "legacy.md");
    await symlink("../worktrees/old/.shipper/open/legacy.md", legacyLink);

    const plans = await listPlans(repoPath);
    expect(plans.open).toHaveLength(1);
    expect(plans.open[0]!.filename).toBe("real-plan.md");

    const { lstat } = await import("node:fs/promises");
    await expect(lstat(danglingLink)).rejects.toThrow();
    await expect(lstat(legacyLink)).rejects.toThrow();

    await rm(repoPath, { recursive: true, force: true });
  });

  it("findPlanByFilename resolves main-checkout plans", async () => {
    const repoPath = await makeRepoLayout();
    await writeFile(join(repoPath, ".shipper", "open", "find-me.md"), SIMPLE_PLAN, "utf8");

    const plan = await findPlanByFilename(repoPath, "find-me.md");
    expect(plan).not.toBeNull();
    expect(plan!.path).toBe(join(repoPath, ".shipper", "open", "find-me.md"));

    await rm(repoPath, { recursive: true, force: true });
  });
});
