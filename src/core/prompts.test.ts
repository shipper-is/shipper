import { describe, expect, it } from "vitest";
import { buildBuildPrompt, buildLoopPrompt } from "./prompts.ts";

describe("buildBuildPrompt git instructions", () => {
  it("omits git instructions when no options are given", () => {
    const prompt = buildBuildPrompt(".shipper/plans/open/foo.md", 1, "cursor");
    expect(prompt).not.toContain("Git workflow:");
  });

  it("instructs current-branch mode without branch frontmatter", () => {
    const prompt = buildBuildPrompt(".shipper/plans/open/foo.md", 1, "cursor", {
      mode: "current-branch",
      commitEachPhase: true,
    });
    expect(prompt).toContain("work directly on the currently checked-out branch");
    expect(prompt).toContain("Commit after completing each phase");
  });

  it("instructs feature-branch mode when requested", () => {
    const prompt = buildBuildPrompt(".shipper/plans/open/foo.md", 2, "cursor", {
      mode: "new-branch",
      commitEachPhase: true,
    });
    expect(prompt).toContain("feature-branch mode");
  });

  it("instructs no commits when commitEachPhase is false", () => {
    const prompt = buildBuildPrompt(".shipper/plans/open/foo.md", 1, "cursor", {
      mode: "current-branch",
      commitEachPhase: false,
    });
    expect(prompt).toContain("Do not make any git commits");
    expect(prompt).not.toContain("Commit after completing each phase");
  });
});

describe("buildLoopPrompt", () => {
  it("points at the shipper-loop skill and the plan path", () => {
    const prompt = buildLoopPrompt(".shipper/plans/open/foo.md", "cursor");
    expect(prompt).toContain("shipper-loop");
    expect(prompt).toContain("Complete the plan at `.shipper/plans/open/foo.md`");
    expect(prompt).toContain("Orchestrate every remaining phase");
  });

  it("includes git preferences when provided", () => {
    const prompt = buildLoopPrompt(".shipper/plans/open/foo.md", "cursor", {
      mode: "new-branch",
      commitEachPhase: true,
    });
    expect(prompt).toContain("feature-branch mode");
    expect(prompt).toContain("Commit after completing each phase");
  });
});
