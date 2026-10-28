import { readFile } from "node:fs/promises";
import { LANES, loadConfig, parseArgs, type Lane, type ReviewConfig, type Tier } from "./config.ts";
import type { FloorReport } from "./risk-floor.ts";

export type Severity = "critical" | "high" | "medium" | "low";
export type FindingStatus = "open" | "fixed" | "dismissed" | "disputed";

export type Finding = {
  id: string;
  lane: Lane;
  persona: string;
  severity: Severity;
  blocker: boolean;
  location: string;
  summary: string;
  authorFamily: string;
  evidence?: { kind: string; ref: string } | null;
  verification: { result: "upheld" | "deleted" | "not-run"; verifierFamily?: string };
  status?: FindingStatus;
  dismissedBy?: string;
};

export type LaneResult = {
  status: "completed" | "failed" | "skipped";
  reason?: string;
  coverage: Array<{ unit: string; tier: Tier }>;
  scannersSkipped?: string[];
};

export type Scorecard = {
  commit: string;
  lanes: Record<Lane, LaneResult>;
  findings: Finding[];
  selfConsistency?: Array<{ unit: string; lane: Lane; agreed: boolean }>;
  budgetExceeded?: boolean;
};

export type Verdict = "ready" | "fix" | "escalate";
export type LaneGrade = "pass" | "suggest" | "block" | "failed" | "skipped";

export type PolicyResult = {
  verdict: Verdict;
  reasons: string[];
  lanes: Record<Lane, LaneGrade>;
  blockers: string[];
  demoted: Array<{ id: string; reason: string }>;
  header: string;
  frontmatter: Record<string, string>;
};

const VERDICT_LABEL: Record<Verdict, string> = {
  ready: "READY FOR HUMAN REVIEW",
  fix: "SEND BACK TO AUTHOR",
  escalate: "ESCALATE TO A HUMAN",
};

const SEVERITIES = ["critical", "high", "medium", "low"];
const STATUSES = ["open", "fixed", "dismissed", "disputed"];
const RESULTS = ["upheld", "deleted", "not-run"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Returns the problems that make a scorecard unusable; an empty list means it is valid. */
export function validateScorecard(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["scorecard must be a JSON object"];
  if (typeof value.commit !== "string") errors.push("commit must be a string");
  if (!isRecord(value.lanes)) {
    errors.push("lanes must be an object keyed by lane");
  } else {
    for (const lane of LANES) {
      const result = value.lanes[lane];
      if (!isRecord(result)) {
        errors.push(`lanes.${lane} is missing`);
        continue;
      }
      if (!["completed", "failed", "skipped"].includes(result.status as string)) {
        errors.push(`lanes.${lane}.status must be completed, failed, or skipped`);
      }
      if (!Array.isArray(result.coverage)) errors.push(`lanes.${lane}.coverage must be an array`);
    }
  }
  if (!Array.isArray(value.findings)) {
    errors.push("findings must be an array");
  } else {
    value.findings.forEach((f, i) => {
      if (!isRecord(f)) return errors.push(`findings[${i}] must be an object`);
      if (typeof f.id !== "string") errors.push(`findings[${i}].id must be a string`);
      if (!(LANES as readonly string[]).includes(f.lane as string))
        errors.push(`findings[${i}].lane is unknown`);
      if (!SEVERITIES.includes(f.severity as string))
        errors.push(`findings[${i}].severity is invalid`);
      if (typeof f.blocker !== "boolean") errors.push(`findings[${i}].blocker must be a boolean`);
      if (typeof f.authorFamily !== "string")
        errors.push(`findings[${i}].authorFamily must be a string`);
      if (f.status !== undefined && !STATUSES.includes(f.status as string)) {
        errors.push(`findings[${i}].status is invalid`);
      }
      if (!isRecord(f.verification) || !RESULTS.includes(f.verification.result as string)) {
        errors.push(`findings[${i}].verification.result must be upheld, deleted, or not-run`);
      }
    });
  }
  return errors;
}

function isActive(f: Finding): boolean {
  if (f.verification.result === "deleted") return false;
  const status = f.status ?? "open";
  if (status === "fixed") return false;
  if (status === "dismissed") return f.lane === "security" && !f.dismissedBy?.trim();
  return true;
}

/**
 * Why a finding marked as a blocker cannot block, or null when it can. "demote" turns it into a
 * suggestion; "unconfirmed" means it is proven but lacked an independent check, so a human decides.
 */
export function blockerProblem(
  f: Finding,
  config: ReviewConfig,
): { kind: "demote" | "unconfirmed"; reason: string } | null {
  const demote = (reason: string) => ({ kind: "demote" as const, reason });
  if (f.severity !== "critical" && f.severity !== "high")
    return demote("blockers must be critical or high severity");
  if (!f.evidence?.kind || !f.evidence.ref) return demote("no evidence attached");
  if (!config.evidenceKinds[f.lane].includes(f.evidence.kind)) {
    return demote(`evidence kind "${f.evidence.kind}" is not accepted for the ${f.lane} lane`);
  }
  if (f.verification.result !== "upheld") return demote("not upheld by a verifier");
  const verifier = f.verification.verifierFamily?.trim().toLowerCase();
  if (!verifier) return { kind: "unconfirmed", reason: "verifier family not recorded" };
  if (verifier === f.authorFamily.trim().toLowerCase()) {
    return { kind: "unconfirmed", reason: "verified only by the same model family as the author" };
  }
  return null;
}

export function evaluate(
  scorecard: Scorecard,
  floor: FloorReport,
  config: ReviewConfig,
): PolicyResult {
  const escalate: string[] = [];
  const fix: string[] = [];
  const blockers: string[] = [];
  const demoted: PolicyResult["demoted"] = [];
  const blockingLanes = new Set<Lane>();
  const suggestLanes = new Set<Lane>();

  if (floor.budget.exceeded) {
    escalate.push(
      `diff exceeds the review budget (${floor.budget.files} files, ${floor.budget.changedLines} changed lines)`,
    );
  }
  if (scorecard.budgetExceeded) escalate.push("review exceeded its token or time budget");
  if (
    scorecard.commit &&
    floor.head &&
    !scorecard.commit.startsWith(floor.head) &&
    !floor.head.startsWith(scorecard.commit)
  ) {
    escalate.push(
      `scorecard commit ${scorecard.commit} does not match reviewed head ${floor.head}`,
    );
  }

  for (const lane of LANES) {
    const result = scorecard.lanes[lane];
    if (result.status === "failed")
      escalate.push(`${lane} lane did not complete${result.reason ? `: ${result.reason}` : ""}`);
    if (lane === "security" && result.status !== "completed")
      escalate.push("security lane must complete (fails closed)");
    if (lane === "security" && result.scannersSkipped?.length) {
      escalate.push(`security scanners skipped: ${result.scannersSkipped.join(", ")}`);
    }
    if (result.status !== "completed") {
      const heavy = floor.units.filter((u) => u.floor[lane] === "heavy").map((u) => u.id);
      if (result.status === "skipped" && heavy.length) {
        escalate.push(
          `${lane} lane skipped but the risk floor requires heavy review of ${heavy.join(", ")}`,
        );
      }
      continue;
    }
    const covered = new Map(result.coverage.map((c) => [c.unit, c.tier]));
    for (const unit of floor.units) {
      const tier = covered.get(unit.id);
      if (!tier) {
        escalate.push(`${lane} lane did not review unit ${unit.id}`);
      } else if (unit.floor[lane] === "heavy" && tier !== "heavy") {
        escalate.push(
          `${lane} lane reviewed ${unit.id} at light tier below its heavy floor (${unit.rules.join(", ")})`,
        );
      }
    }
  }

  for (const check of scorecard.selfConsistency ?? []) {
    if (!check.agreed)
      escalate.push(`self-consistency runs disagreed on ${check.lane} for ${check.unit}`);
  }

  for (const f of scorecard.findings.filter(isActive)) {
    const severe = f.severity === "critical" || f.severity === "high";
    if (!f.blocker) {
      suggestLanes.add(f.lane);
      if (f.lane === "security" && severe)
        escalate.push(
          `${f.id}: ${f.severity} security finding without proof needs a security reviewer`,
        );
      continue;
    }
    const problem = blockerProblem(f, config);
    if (problem?.kind === "demote") {
      demoted.push({ id: f.id, reason: problem.reason });
      suggestLanes.add(f.lane);
      if (f.lane === "security")
        escalate.push(`${f.id}: security blocker could not be confirmed (${problem.reason})`);
      continue;
    }
    blockers.push(f.id);
    blockingLanes.add(f.lane);
    if (problem) {
      escalate.push(`${f.id}: blocker ${problem.reason}`);
    } else if (f.lane === "security") {
      escalate.push(
        `${f.id}: confirmed security finding; only a named security reviewer can dismiss it`,
      );
    } else if (f.status === "disputed") {
      escalate.push(`${f.id}: author disputes a confirmed blocker`);
    } else {
      fix.push(`${f.id}: ${f.summary}`);
    }
  }

  const lanes = Object.fromEntries(
    LANES.map((lane) => {
      const status = scorecard.lanes[lane].status;
      const grade: LaneGrade =
        status === "failed"
          ? "failed"
          : status === "skipped"
            ? "skipped"
            : blockingLanes.has(lane)
              ? "block"
              : suggestLanes.has(lane)
                ? "suggest"
                : "pass";
      return [lane, grade];
    }),
  ) as Record<Lane, LaneGrade>;

  const verdict: Verdict = escalate.length ? "escalate" : fix.length ? "fix" : "ready";
  const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const header = [
    `Verdict: ${VERDICT_LABEL[verdict]}`,
    `QUIPS: ${LANES.map((l) => `${title(l)} ${lanes[l].toUpperCase()}`).join(" · ")}`,
  ].join("\n");

  return {
    verdict,
    reasons: [...escalate, ...fix],
    lanes,
    blockers,
    demoted,
    header,
    frontmatter: { verdict, ...lanes },
  };
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.floor !== "string" || typeof args.scorecard !== "string") {
    throw new Error(
      "usage: bun policy.ts --floor <floor.json> --scorecard <scorecard.json> [--repo <path>]",
    );
  }
  const repo = typeof args.repo === "string" ? args.repo : process.cwd();
  const { config } = await loadConfig(repo);
  const floor = (await readJson(args.floor)) as FloorReport;
  const scorecard = await readJson(args.scorecard);
  const errors = validateScorecard(scorecard);
  if (errors.length) {
    console.error(`invalid scorecard:\n- ${errors.join("\n- ")}`);
    process.exit(2);
  }
  console.log(JSON.stringify(evaluate(scorecard as Scorecard, floor, config), null, 2));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
