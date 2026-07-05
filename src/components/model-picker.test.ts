import { describe, expect, it } from "vitest";
import {
  EFFORT_LABELS,
  familyHasVariants,
  getFamilyContexts,
  getFamilyEfforts,
  groupModelFamilies,
  hasSpeedChoice,
  parseModelVariant,
  resolveVariantChoice,
} from "../agents/model-variants.ts";
import type { ModelOption } from "../agents/models.ts";
import { filterItems, listWindow } from "../components/searchable-list.tsx";

const OPUS_VARIANTS: ModelOption[] = [
  { id: "claude-opus-4-8-medium", label: "Opus 4.8 1M Medium" },
  { id: "claude-opus-4-8-high", label: "Opus 4.8 1M" },
  { id: "claude-opus-4-8-high-fast", label: "Opus 4.8 1M Fast" },
  { id: "claude-opus-4-8-thinking-high", label: "Opus 4.8 1M Thinking" },
  { id: "claude-opus-4-8-thinking-high-fast", label: "Opus 4.8 1M Thinking Fast" },
];

describe("parseModelVariant", () => {
  it("extracts effort, context, and speed from cursor slugs", () => {
    expect(parseModelVariant(OPUS_VARIANTS[1]!)).toMatchObject({
      familyId: "claude-opus-4-8",
      effort: "high",
      context: "1m",
      fast: false,
    });
    expect(parseModelVariant(OPUS_VARIANTS[2]!)).toMatchObject({
      familyId: "claude-opus-4-8",
      effort: "high",
      fast: true,
    });
    expect(parseModelVariant(OPUS_VARIANTS[4]!)).toMatchObject({
      familyId: "claude-opus-4-8-thinking",
      effort: "high",
      fast: true,
    });
  });
});

describe("groupModelFamilies", () => {
  it("groups variants under separate standard and thinking families", () => {
    const families = groupModelFamilies([
      ...OPUS_VARIANTS,
      { id: "composer-2.5", label: "Composer 2.5" },
      { id: "auto", label: "Auto" },
    ]);

    expect(families.map((family) => family.id).sort()).toEqual([
      "auto",
      "claude-opus-4-8",
      "claude-opus-4-8-thinking",
      "composer-2.5",
    ]);
    expect(familyHasVariants(families.find((family) => family.id === "claude-opus-4-8")!)).toBe(
      true,
    );
    expect(familyHasVariants(families.find((family) => family.id === "auto")!)).toBe(false);
  });
});

describe("variant resolution", () => {
  const family = groupModelFamilies(OPUS_VARIANTS).find(
    (entry) => entry.id === "claude-opus-4-8",
  )!;

  it("lists context and effort options for a family", () => {
    expect(getFamilyContexts(family)).toEqual(["1m"]);
    expect(getFamilyEfforts(family, "1m")).toEqual(["medium", "high"]);
    expect(hasSpeedChoice(family, "high", "1m")).toBe(true);
    expect(hasSpeedChoice(family, "medium", "1m")).toBe(false);
  });

  it("resolves the concrete slug for a chosen variant", () => {
    expect(
      resolveVariantChoice(family, { context: "1m", effort: "high", fast: true }),
    ).toBe("claude-opus-4-8-high-fast");
    expect(EFFORT_LABELS.high).toBe("High");
  });
});

describe("searchable list helpers", () => {
  const items = [
    { id: "a", label: "Alpha" },
    { id: "b", label: "Beta" },
  ];

  it("filters items by label or id", () => {
    expect(filterItems(items, "bet")).toEqual([items[1]]);
  });

  it("windows long lists", () => {
    expect(listWindow(10, 20, 8)).toEqual({ start: 3, end: 11 });
  });
});
