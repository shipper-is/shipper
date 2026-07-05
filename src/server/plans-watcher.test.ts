import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getPlanProgress,
  parsePlan,
  emptyPlanMeta,
  parseFrontmatter,
  type PlanFile,
} from "../core/plan-store.ts";
import {
  loadPlansSnapshot,
  planFileToSummary,
  phaseToDto,
  savePlanMarkdown,
} from "./plans-watcher.ts";
import { parseClientMessage } from "../shared/protocol.ts";

const SAMPLE_MARKDOWN = `# Test Plan

## Phase 1: First phase

### Section 1.1

- [x] Done task
- [ ] Pending task

### Completion Notes
Phase 1 notes.
`;

describe("parseClientMessage", () => {
  it("accepts valid client messages", () => {
    expect(parseClientMessage({ type: "stop-run" })).toEqual({ type: "stop-run" });
    expect(
      parseClientMessage({
        type: "start-build",
        planFilename: "foo.md",
      }),
    ).toEqual({ type: "start-build", planFilename: "foo.md" });
    expect(
      parseClientMessage({
        type: "save-plan",
        planFilename: "foo.md",
        markdown: "# Plan",
      }),
    ).toEqual({ type: "save-plan", planFilename: "foo.md", markdown: "# Plan" });
  });

  it("rejects unknown or malformed messages", () => {
    expect(parseClientMessage({ type: "nope" })).toBeNull();
    expect(parseClientMessage({ type: "start-build" })).toBeNull();
    expect(parseClientMessage("stop-run")).toBeNull();
  });
});

describe("planFileToSummary", () => {
  it("maps PlanFile fields into a serializable PlanSummary", () => {
    const parsed = parsePlan(SAMPLE_MARKDOWN);
    const plan: PlanFile = {
      filename: "test-plan.md",
      path: "/repo/.shipper/open/test-plan.md",
      folder: "open",
      origin: "main",
      title: parsed.title,
      progress: getPlanProgress(parsed),
      parsed,
      meta: emptyPlanMeta(),
    };

    const summary = planFileToSummary(plan, SAMPLE_MARKDOWN);

    expect(summary.filename).toBe("test-plan.md");
    expect(summary.path).toBe("/repo/.shipper/open/test-plan.md");
    expect(summary.folder).toBe("open");
    expect(summary.title).toBe("Test Plan");
    expect(summary.rawMarkdown).toBe(SAMPLE_MARKDOWN);
    expect(summary.progress.totalChecked).toBe(1);
    expect(summary.progress.totalUnchecked).toBe(1);
    expect(summary.phases).toHaveLength(1);
    expect(summary.phases[0]!.complete).toBe(true);
    expect(summary.phases[0]!.sections[0]!.title).toBe("Section 1.1");
    expect(summary.meta).toEqual(emptyPlanMeta());
  });

  it("passes through frontmatter meta on the DTO", () => {
    const markdownWithMeta = `---
branch: shipper/plan-completion-metadata
started_at: "2026-07-04T22:15:00-05:00"
completed_at: "2026-07-05T01:40:00-05:00"
pr_url: https://github.com/owner/repo/pull/123
pr_number: 123
---
${SAMPLE_MARKDOWN}`;
    const parsed = parsePlan(markdownWithMeta);
    const meta = parseFrontmatter(markdownWithMeta);
    const plan: PlanFile = {
      filename: "done-plan.md",
      path: "/repo/.shipper/done/done-plan.md",
      folder: "done",
      origin: "main",
      title: parsed.title,
      progress: getPlanProgress(parsed),
      parsed,
      meta,
    };

    const summary = planFileToSummary(plan, markdownWithMeta);

    expect(summary.meta).toEqual({
      type: "plan",
      branch: "shipper/plan-completion-metadata",
      baseBranch: null,
      worktree: null,
      startedAt: "2026-07-04T22:15:00-05:00",
      completedAt: "2026-07-05T01:40:00-05:00",
      phaseCommits: {},
      prUrl: "https://github.com/owner/repo/pull/123",
      prNumber: 123,
    });
  });
});

describe("savePlanMarkdown", () => {
  it("writes to the worktree plan path from the snapshot", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "shipper-plans-watcher-"));
    const worktreeOpen = join(
      repoPath,
      ".shipper",
      "worktrees",
      "edit-me",
      ".shipper",
      "open",
    );
    await mkdir(worktreeOpen, { recursive: true });
    const planPath = join(worktreeOpen, "edit-me.md");
    const original = `---
type: plan
worktree: .shipper/worktrees/edit-me
---
# Edit Me

## Phase 1: One

### S

- [ ] task
`;
    await writeFile(planPath, original, "utf8");
    await mkdir(join(repoPath, ".shipper", "open"), { recursive: true });
    await mkdir(join(repoPath, ".shipper", "done"), { recursive: true });

    const snapshot = await loadPlansSnapshot(repoPath);
    const updated = original.replace("- [ ] task", "- [x] task");
    const result = await savePlanMarkdown(snapshot, "edit-me.md", updated);

    expect(result).toEqual({ ok: true });
    expect(await readFile(planPath, "utf8")).toBe(updated);

    await rm(repoPath, { recursive: true, force: true });
  });
});

describe("phaseToDto", () => {
  it("marks incomplete phases correctly", () => {
    const incompleteMarkdown = `# Test Plan

## Phase 1: First phase

### Section 1.1

- [ ] Pending task
`;
    const parsed = parsePlan(incompleteMarkdown);
    const phase = parsed.phases[0]!;
    const dto = phaseToDto(phase);
    expect(dto.complete).toBe(false);
    expect(dto.checkedCount).toBe(0);
    expect(dto.uncheckedCount).toBe(1);
  });
});
