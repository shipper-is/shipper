import { describe, expect, it } from "vitest";
import { buildBuildPrompt } from "./prompts.ts";

describe("buildBuildPrompt git instructions", () => {
  it("omits git instructions when no options are given", () => {
    const prompt = buildBuildPrompt(".shipper/open/foo.md", 1, "cursor");
    expect(prompt).not.toContain("Git workflow:");
  });

  it("instructs current-branch mode without branch frontmatter", () => {
    const prompt = buildBuildPrompt(".shipper/open/foo.md", 1, "cursor", {
      mode: "current-branch",
      commitEachPhase: true,
    });
    expect(prompt).toContain("work directly on the currently checked-out branch");
    expect(prompt).toContain("Commit after completing the phase");
  });

  it("instructs feature-branch mode when requested", () => {
    const prompt = buildBuildPrompt(".shipper/open/foo.md", 2, "cursor", {
      mode: "new-branch",
      commitEachPhase: true,
    });
    expect(prompt).toContain("feature-branch mode");
  });

  it("instructs no commits when commitEachPhase is false", () => {
    const prompt = buildBuildPrompt(".shipper/open/foo.md", 1, "cursor", {
      mode: "current-branch",
      commitEachPhase: false,
    });
    expect(prompt).toContain("Do not make any git commits");
    expect(prompt).not.toContain("Commit after completing the phase");
  });
});
