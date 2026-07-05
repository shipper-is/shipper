import { describe, expect, it } from "vitest";
import { getPlanProgress, parsePlan, type PlanFile } from "../core/plan-store.ts";
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
