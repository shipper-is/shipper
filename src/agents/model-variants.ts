import type { ModelOption } from "./models.ts";

export type ModelEffort =
  | "default"
  | "none"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "extra-high"
  | "max";

export type ParsedModelVariant = {
  id: string;
  label: string;
  familyId: string;
  familyLabel: string;
  effort: ModelEffort;
  context?: string;
  fast: boolean;
};

export type ModelFamily = {
  id: string;
  label: string;
  variants: ParsedModelVariant[];
};

const EFFORT_SUFFIXES: { suffix: string; effort: ModelEffort }[] = [
  { suffix: "-extra-high", effort: "extra-high" },
  { suffix: "-xhigh", effort: "xhigh" },
  { suffix: "-high", effort: "high" },
  { suffix: "-medium", effort: "medium" },
  { suffix: "-low", effort: "low" },
  { suffix: "-max", effort: "max" },
  { suffix: "-none", effort: "none" },
];

const EFFORT_ORDER: ModelEffort[] = [
  "none",
  "low",
  "medium",
  "default",
  "high",
  "xhigh",
  "extra-high",
  "max",
];

export const EFFORT_LABELS: Record<ModelEffort, string> = {
  default: "Standard",
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  "extra-high": "Extra High",
  max: "Max",
};

export function parseContextFromLabel(label: string): string | undefined {
  const match = label.match(/\b(\d+)\s*([mMgG])\b/);
  if (!match) {
    return undefined;
  }
  return `${match[1]!}${match[2]!.toLowerCase()}`;
}

export function contextLabel(context?: string): string {
  if (!context) {
    return "Default";
  }
  return `${context.toUpperCase()} context`;
}

function stripDecorations(label: string): string {
  return label
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+\d+\s*[mMgG]\b/g, "")
    .replace(/\s+Fast\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseModelVariant(model: ModelOption): ParsedModelVariant {
  let slug = model.id;
  let fast = false;

  if (slug.endsWith("-fast")) {
    fast = true;
    slug = slug.slice(0, -5);
  }

  let effort: ModelEffort = "default";
  for (const entry of EFFORT_SUFFIXES) {
    if (slug.endsWith(entry.suffix)) {
      effort = entry.effort;
      slug = slug.slice(0, -entry.suffix.length);
      break;
    }
  }

  const context = parseContextFromLabel(model.label);

  return {
    id: model.id,
    label: model.label,
    familyId: slug,
    familyLabel: stripDecorations(model.label),
    effort,
    context,
    fast,
  };
}

function familyLabelFromVariants(variants: ParsedModelVariant[]): string {
  const preferred =
    variants.find((variant) => variant.effort === "default" && !variant.fast) ??
    variants.find((variant) => variant.effort === "medium" && !variant.fast) ??
    variants.find((variant) => !variant.fast) ??
    variants[0];

  if (!preferred) {
    return "Unknown model";
  }

  const related = variants.filter((variant) => variant.familyId === preferred.familyId);
  const shortest = [...related].sort((a, b) => a.label.length - b.label.length)[0];
  return stripDecorations(shortest?.label ?? preferred.label);
}

export function groupModelFamilies(models: ModelOption[]): ModelFamily[] {
  const variants = models.map(parseModelVariant);
  const families = new Map<string, ParsedModelVariant[]>();

  for (const variant of variants) {
    const current = families.get(variant.familyId) ?? [];
    current.push(variant);
    families.set(variant.familyId, current);
  }

  return [...families.entries()]
    .map(([id, familyVariants]) => ({
      id,
      label: familyLabelFromVariants(familyVariants),
      variants: familyVariants,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function familyHasVariants(family: ModelFamily): boolean {
  const efforts = new Set(family.variants.map((variant) => variant.effort));
  const contexts = new Set(
    family.variants.map((variant) => variant.context).filter((value): value is string => !!value),
  );
  const hasFastChoice = family.variants.some((variant) => variant.fast)
    && family.variants.some((variant) => !variant.fast);

  return efforts.size > 1 || contexts.size > 1 || hasFastChoice;
}

export function getFamilyContexts(family: ModelFamily): string[] {
  const contexts = new Set<string>();
  for (const variant of family.variants) {
    if (variant.context) {
      contexts.add(variant.context);
    }
  }
  return [...contexts].sort();
}

export function getFamilyEfforts(
  family: ModelFamily,
  context?: string,
): ModelEffort[] {
  const efforts = new Set<ModelEffort>();
  for (const variant of family.variants) {
    if (context && variant.context && variant.context !== context) {
      continue;
    }
    efforts.add(variant.effort);
  }

  return [...efforts].sort(
    (a, b) => EFFORT_ORDER.indexOf(a) - EFFORT_ORDER.indexOf(b),
  );
}

export function hasSpeedChoice(
  family: ModelFamily,
  effort: ModelEffort,
  context?: string,
): boolean {
  let hasStandard = false;
  let hasFast = false;

  for (const variant of family.variants) {
    if (variant.effort !== effort) {
      continue;
    }
    if (context && variant.context && variant.context !== context) {
      continue;
    }
    if (variant.fast) {
      hasFast = true;
    } else {
      hasStandard = true;
    }
  }

  return hasStandard && hasFast;
}

export function resolveVariantChoice(
  family: ModelFamily,
  choice: { context?: string; effort: ModelEffort; fast: boolean },
): string | undefined {
  const match = family.variants.find((variant) => {
    if (variant.effort !== choice.effort || variant.fast !== choice.fast) {
      return false;
    }
    if (choice.context) {
      return variant.context === choice.context;
    }
    return true;
  });

  return match?.id;
}

export function parseSavedModelChoice(
  models: ModelOption[],
  modelId: string,
): {
  familyId: string;
  context?: string;
  effort: ModelEffort;
  fast: boolean;
} | null {
  const model = models.find((entry) => entry.id === modelId);
  if (!model) {
    return null;
  }

  const parsed = parseModelVariant(model);
  return {
    familyId: parsed.familyId,
    context: parsed.context,
    effort: parsed.effort,
    fast: parsed.fast,
  };
}
