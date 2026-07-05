import { describe, expect, it } from "vitest";
import {
  getFamilyEfforts,
  groupModelFamilies,
  parseModelVariant,
  resolveVariantChoice,
} from "./model-variants.ts";
import type { ModelOption } from "./models.ts";

const CODEX_VARIANTS: ModelOption[] = [
  { id: "gpt-5.3-codex-low", label: "Codex 5.3 Low" },
  { id: "gpt-5.3-codex", label: "Codex 5.3" },
  { id: "gpt-5.3-codex-high-fast", label: "Codex 5.3 High Fast" },
];

describe("model variant grouping", () => {
  it("groups codex effort and speed variants", () => {
    const family = groupModelFamilies(CODEX_VARIANTS)[0]!;
    expect(family.id).toBe("gpt-5.3-codex");
    expect(getFamilyEfforts(family)).toEqual(["low", "default", "high"]);
    expect(resolveVariantChoice(family, { effort: "default", fast: false })).toBe("gpt-5.3-codex");
    expect(resolveVariantChoice(family, { effort: "high", fast: true })).toBe(
      "gpt-5.3-codex-high-fast",
    );
  });

  it("treats simple models as single-variant families", () => {
    const family = groupModelFamilies([{ id: "gemini-3.1-pro", label: "Gemini 3.1 Pro" }])[0]!;
    expect(parseModelVariant(family.variants[0]!)).toMatchObject({
      familyId: "gemini-3.1-pro",
      effort: "default",
      fast: false,
    });
  });
});
