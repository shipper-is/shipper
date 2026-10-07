import { describe, expect, it } from "vitest";
import {
  draftIssues,
  payloadForSave,
  setExtraDirs,
  setGitField,
  setInstruction,
  setModel,
  setPath,
  setSearchEnabled,
} from "./config-draft.ts";

describe("config draft", () => {
  it("keeps sibling git fields and unknown keys", () => {
    const next = setGitField(
      { git: { branchPrefix: "feat/", extra: true }, other: 1 },
      "commitEachPhase",
      false,
    );
    expect(next).toEqual({
      git: { branchPrefix: "feat/", extra: true, commitEachPhase: false },
      other: 1,
    });
  });

  it("removes git when the last field is cleared", () => {
    expect(setGitField({ git: { commitEachPhase: true } }, "commitEachPhase", undefined)).toEqual({});
  });

  it("removes an empty paths object", () => {
    expect(setPath({ paths: { plans: "docs/plans" } }, "plans", "")).toEqual({});
  });

  it("keeps other skills when one model is cleared", () => {
    const next = setModel(
      {
        models: {
          cursor: { "shipper-build": "composer-2.5", "shipper-plan": "gpt" },
          claude: { "shipper-build": "opus" },
        },
      },
      "cursor",
      "shipper-build",
      undefined,
    );
    expect(next).toEqual({
      models: {
        cursor: { "shipper-plan": "gpt" },
        claude: { "shipper-build": "opus" },
      },
    });
  });

  it("drops an empty instruction and keeps unknown instruction keys", () => {
    const next = setInstruction(
      { instructions: { all: "Hello", "shipper-plan": "Plans", custom: "stay" } },
      "all",
      "",
    );
    expect(next).toEqual({ instructions: { "shipper-plan": "Plans", custom: "stay" } });
  });

  it("treats an empty extra-dirs list as set, and removal as not set", () => {
    const listed = setExtraDirs({ search: { enabled: true } }, []);
    expect(listed).toEqual({ search: { enabled: true, extraDirs: [] } });
    expect(setExtraDirs(listed, undefined)).toEqual({ search: { enabled: true } });
    expect(setSearchEnabled({ search: { extraDirs: ["docs/adr"] } }, undefined)).toEqual({
      search: { extraDirs: ["docs/adr"] },
    });
  });

  it("builds a full local payload without paths, keeping unknown keys", () => {
    const draft = {
      custom: { keep: true },
      paths: { plans: "docs/plans" },
      embeddings: { idleMinutes: 5 },
      state: { latestKnownVersion: "0.2.3" },
      git: { commitEachPhase: false, branchPrefix: "shipper/" },
    };
    expect(payloadForSave("local", draft)).toEqual({
      custom: { keep: true },
      embeddings: { idleMinutes: 5 },
      state: { latestKnownVersion: "0.2.3" },
      git: { commitEachPhase: false, branchPrefix: "shipper/" },
    });
  });

  it("omits machine keys on the global layer and normalizes repo paths", () => {
    const draft = {
      custom: { keep: true },
      paths: { plans: "docs/plans/" },
      embeddings: { idleMinutes: 5 },
      state: { latestKnownVersion: "0.2.3" },
      git: { commitEachPhase: false },
      search: { extraDirs: ["docs/adr/"] },
    };
    expect(payloadForSave("global", draft)).toEqual({
      custom: { keep: true },
      git: { commitEachPhase: false },
      search: { extraDirs: ["docs/adr"] },
    });
    expect(payloadForSave("repo", draft)).toEqual({
      custom: { keep: true },
      paths: { plans: "docs/plans" },
      embeddings: { idleMinutes: 5 },
      state: { latestKnownVersion: "0.2.3" },
      git: { commitEachPhase: false },
      search: { extraDirs: ["docs/adr"] },
    });
  });

  it("flags invalid paths, duplicates, prefixes, and blank extra dirs", () => {
    const invalid = draftIssues("repo", { paths: { plans: "../x" } });
    expect(invalid.some((issue) => issue.path === "paths.plans")).toBe(true);

    const duplicate = draftIssues("repo", { paths: { spikes: ".shipper/plans" } });
    expect(duplicate.some((issue) => issue.path === "paths.spikes")).toBe(true);

    const prefix = draftIssues("local", { git: { branchPrefix: "feat prefix" } });
    expect(prefix).toEqual([
      { path: "git.branchPrefix", message: "Use only letters, digits, and . _ / -" },
    ]);

    const extra = draftIssues("local", { search: { extraDirs: [""] } });
    expect(extra[0]?.path).toBe("search.extraDirs.0");
  });
});
