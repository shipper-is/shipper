import { describe, expect, it } from "vitest";
import { validateArtifactDir } from "./config-schema.ts";

describe("validateArtifactDir", () => {
  it("normalizes a trailing slash", () => {
    expect(validateArtifactDir("docs/plans/")).toEqual({ ok: true, dir: "docs/plans" });
  });

  it("resolves dot segments without leaving the repo", () => {
    expect(validateArtifactDir("./a/../b")).toEqual({ ok: true, dir: "b" });
  });

  it("rejects a parent escape", () => {
    const result = validateArtifactDir("../x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/escapes/i);
  });

  it("rejects an absolute path", () => {
    const result = validateArtifactDir("/abs");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/absolute/i);
  });

  it("rejects a backslash", () => {
    const result = validateArtifactDir("a\\b");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/backslash/i);
  });

  it("rejects a .git segment", () => {
    const result = validateArtifactDir(".git/x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/\.git/);
  });

  it("rejects a node_modules segment", () => {
    const result = validateArtifactDir("x/node_modules");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/node_modules/);
  });
});
