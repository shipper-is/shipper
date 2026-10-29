import { describe, expect, it } from "vitest";
import {
  draftIssues,
  payloadForSave,
  readReviewModels,
  setEvidenceText,
  setExtraDirs,
  setGitField,
  setInstruction,
  setModel,
  setPath,
  setReviewSampleRate,
  setSearchEnabled,
  writeReviewModels,
  writeSkillModel,
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

  it("stores a role beside the launch model and returns to a string when the role is cleared", () => {
    const withResearch = writeSkillModel(
      { models: { cursor: { "shipper-plan": "composer-2.5" } } },
      "cursor",
      "shipper-plan",
      { model: "composer-2.5", research: "gpt-5" },
    );
    expect(withResearch).toEqual({
      models: { cursor: { "shipper-plan": { model: "composer-2.5", research: "gpt-5" } } },
    });
    const cleared = writeSkillModel(withResearch, "cursor", "shipper-plan", { model: "composer-2.5" });
    expect(cleared).toEqual({
      models: { cursor: { "shipper-plan": "composer-2.5" } },
    });
  });

  it("keeps unknown nested model keys", () => {
    const next = writeSkillModel(
      {
        models: {
          cursor: {
            "shipper-plan": { model: "big", extra: true },
            "shipper-review": { triage: "opus", note: "keep" },
            custom: "stay",
          },
        },
      },
      "cursor",
      "shipper-plan",
      { model: "big", research: "mid" },
    );
    expect(next).toEqual({
      models: {
        cursor: {
          "shipper-plan": { model: "big", extra: true, research: "mid" },
          "shipper-review": { triage: "opus", note: "keep" },
          custom: "stay",
        },
      },
    });
  });

  it("removes shipper-review when the last field is cleared", () => {
    const cleared = writeReviewModels(
      {
        models: {
          cursor: {
            "shipper-build": "composer-2.5",
            "shipper-review": { triage: "opus" },
          },
        },
      },
      "cursor",
      {},
    );
    expect(cleared).toEqual({
      models: { cursor: { "shipper-build": "composer-2.5" } },
    });
  });

  it("does not append a duplicate review model", () => {
    const draft = {
      models: { cursor: { "shipper-review": { light: ["fast-a", "fast-b"] } } },
    };
    const current = readReviewModels(draft, "cursor");
    const next = writeReviewModels(draft, "cursor", {
      ...current,
      light: [...(current.light ?? []), "fast-a"],
    });
    expect(next).toEqual(draft);
  });

  it("flags a blank role and an empty review list without blocking a one-family list", () => {
    const invalid = draftIssues("local", {
      models: {
        cursor: {
          "shipper-plan": { research: "  " },
          "shipper-review": { light: [] },
        },
      },
    });
    expect(invalid).toEqual([
      { path: "models.cursor.shipper-plan.research", message: "Use a non-empty model id." },
      { path: "models.cursor.shipper-review.light", message: "This list is empty." },
    ]);

    const oneFamily = draftIssues("local", {
      models: {
        cursor: { "shipper-review": { light: ["composer-2.5", "composer-2.5-fast"] } },
      },
    });
    expect(oneFamily).toEqual([]);
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

  it("edits review on the repo layer without dropping sibling keys", () => {
    const next = setReviewSampleRate(
      { review: { sampleRate: 0.05, note: "keep" }, custom: true },
      "0.2",
    );
    expect(next).toEqual({ review: { sampleRate: "0.2", note: "keep" }, custom: true });
    expect(payloadForSave("repo", next)).toEqual({
      review: { sampleRate: 0.2, note: "keep" },
      custom: true,
    });
    expect(
      payloadForSave("repo", setEvidenceText(next, "security", "repro-test, secret-match")),
    ).toMatchObject({
      review: { evidenceKinds: { security: ["repro-test", "secret-match"] } },
    });
  });

  it("does not block a local save on an ignored review value", () => {
    expect(draftIssues("local", { review: { sampleRate: "nope" } })).toEqual([]);
    expect(draftIssues("repo", { review: { sampleRate: "nope" } })).toEqual([
      { path: "review.sampleRate", message: "Use a number from 0 to 1." },
    ]);
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
