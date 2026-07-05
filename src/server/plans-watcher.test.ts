import { describe, expect, it } from "vitest";
import {
  getPlanProgress,
  parsePlan,
  emptyPlanMeta,
  parseFrontmatter,
  type PlanFile,
} from "../core/plan-store.ts";
import { planFileToSummary, phaseToDto } from "./plans-watcher.ts";
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
      title: parsed.title,
      progress: getPlanProgress(parsed),
      parsed,
      meta: emptyPlanMeta(),
    };

    const summary = planFileToSummary(plan, SAMPLE_MARKDOWN);

    expect(summary.filename).toBe("test-plan.md");
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
      title: parsed.title,
      progress: getPlanProgress(parsed),
      parsed,
      meta,
    };

    const summary = planFileToSummary(plan, markdownWithMeta);

    expect(summary.meta).toEqual({
      branch: "shipper/plan-completion-metadata",
      startedAt: "2026-07-04T22:15:00-05:00",
      completedAt: "2026-07-05T01:40:00-05:00",
      prUrl: "https://github.com/owner/repo/pull/123",
      prNumber: 123,
    });
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
