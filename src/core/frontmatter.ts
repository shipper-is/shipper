import { parse as parseYaml } from "yaml";

export type PlanMeta = {
  type: "plan" | "spike";
  branch: string | null;
  baseBranch: string | null;
  startedAt: string | null;
  completedAt: string | null;
  phaseCommits: Record<number, string>;
  prUrl: string | null;
  prNumber: number | null;
};

export function emptyPlanMeta(): PlanMeta {
  return {
    type: "plan",
    branch: null,
    baseBranch: null,
    startedAt: null,
    completedAt: null,
    phaseCommits: {},
    prUrl: null,
    prNumber: null,
  };
}

function asPlanType(value: unknown): "plan" | "spike" {
  return value === "spike" ? "spike" : "plan";
}

function asMetaString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asMetaNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function parsePhaseCommits(value: unknown): Record<number, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const result: Record<number, string> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const phaseNum = Number(key);
    if (!Number.isInteger(phaseNum) || phaseNum < 1) continue;
    const sha = asMetaString(val);
    if (sha) result[phaseNum] = sha;
  }
  return result;
}

export function parseFrontmatter(markdown: string): PlanMeta {
  const lines = markdown.split(/\r?\n/);
  if (lines[0] !== "---") {
    return emptyPlanMeta();
  }

  let closingIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      closingIndex = i;
      break;
    }
  }
  if (closingIndex === -1) {
    return emptyPlanMeta();
  }

  const block = lines.slice(1, closingIndex).join("\n");
  try {
    const parsed = parseYaml(block);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return emptyPlanMeta();
    }
    const record = parsed as Record<string, unknown>;
    return {
      type: asPlanType(record.type),
      branch: asMetaString(record.branch),
      baseBranch: asMetaString(record.base_branch),
      startedAt: asMetaString(record.started_at),
      completedAt: asMetaString(record.completed_at),
      phaseCommits: parsePhaseCommits(record.phase_commits),
      prUrl: asMetaString(record.pr_url),
      prNumber: asMetaNumber(record.pr_number),
    };
  } catch {
    return emptyPlanMeta();
  }
}
