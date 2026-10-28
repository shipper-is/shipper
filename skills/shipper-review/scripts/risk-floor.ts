import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  LANES,
  loadConfig,
  parseArgs,
  type Lane,
  type ReviewConfig,
  type RiskRule,
  type Tier,
} from "./config.ts";

export type ChangedFile = { path: string; status: string; additions: number; deletions: number };

export type FileFloor = ChangedFile & { rules: string[]; heavyLanes: Lane[] };

export type Unit = {
  id: string;
  files: string[];
  rules: string[];
  floor: Record<Lane, Tier>;
  sampled: boolean;
  coChange: Array<{ path: string; count: number }>;
};

export type FloorReport = {
  target: "branch" | "uncommitted";
  base: string;
  mergeBase: string;
  head: string;
  files: FileFloor[];
  units: Unit[];
  budget: {
    files: number;
    changedLines: number;
    limits: ReviewConfig["budget"];
    exceeded: boolean;
  };
  warnings: string[];
};

export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (c === "*") {
      re += "[^/]*";
    } else if (c === "?") {
      re += "[^/]";
    } else if (c === "{") {
      const end = glob.indexOf("}", i);
      if (end === -1) {
        re += "\\{";
      } else {
        re += `(?:${glob
          .slice(i + 1, end)
          .split(",")
          .map((alt) => alt.replace(/[.+^$()|[\]\\]/g, "\\$&"))
          .join("|")})`;
        i = end;
      }
    } else {
      re += c.replace(/[.+^$()|[\]\\{}]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`, "i");
}

/** Patterns without a slash match the file name; patterns with one match the whole repo-relative path. */
export function matchesGlob(path: string, glob: string): boolean {
  const target = glob.includes("/") ? path : basename(path);
  return globToRegExp(glob).test(target);
}

export function applyRules(file: ChangedFile, rules: RiskRule[], ignore: string[] = []): FileFloor {
  const ignored = ignore.some((glob) => matchesGlob(file.path, glob));
  const matched = ignored
    ? []
    : rules.filter((rule) => rule.paths.some((glob) => matchesGlob(file.path, glob)));
  const heavy = new Set(matched.flatMap((rule) => rule.lanes));
  return {
    ...file,
    rules: matched.map((r) => r.name),
    heavyLanes: LANES.filter((l) => heavy.has(l)),
  };
}

const TEST_DIR = /(^|\/)(__tests__|tests?|spec)\//;
const TEST_FILE = /(\.(test|spec)\.[^/]+$)|(_test\.[^/]+$)|((^|\/)test_[^/]+$)/;

export function isTestFile(path: string): boolean {
  return TEST_DIR.test(path) || TEST_FILE.test(path);
}

export function fileStem(path: string): string {
  return basename(path)
    .replace(/\.(test|spec)(?=\.)/, "")
    .replace(/\.[^.]+$/, "")
    .replace(/_test$/, "")
    .replace(/^test_/, "");
}

/** Units are directories; a test joins the unit of the changed source file it shares a stem with. */
export function groupUnits(paths: string[]): Map<string, string[]> {
  const units = new Map<string, string[]>();
  const add = (id: string, path: string) => units.set(id, [...(units.get(id) ?? []), path]);
  const sources = paths.filter((p) => !isTestFile(p));
  for (const path of sources) add(dirname(path), path);
  for (const path of paths.filter(isTestFile)) {
    const partner = sources.find((s) => fileStem(s) === fileStem(path));
    add(partner ? dirname(partner) : dirname(path), path);
  }
  return units;
}

export function isSampled(head: string, unitId: string, rate: number): boolean {
  if (rate <= 0) return false;
  const hex = createHash("sha256").update(`${head}:${unitId}`).digest("hex").slice(0, 8);
  return parseInt(hex, 16) / 0xffffffff < rate;
}

export function buildReport(input: {
  target: "branch" | "uncommitted";
  base: string;
  mergeBase: string;
  head: string;
  files: ChangedFile[];
  config: ReviewConfig;
  coChange?: (
    unitId: string,
    unitFiles: string[],
    changed: Set<string>,
  ) => Array<{ path: string; count: number }>;
  warnings?: string[];
}): FloorReport {
  const { config } = input;
  const files = input.files.map((f) => applyRules(f, config.riskFloor, config.floorIgnore));
  const byPath = new Map(files.map((f) => [f.path, f]));
  const changed = new Set(files.map((f) => f.path));

  const units: Unit[] = [...groupUnits(files.map((f) => f.path))].map(([id, unitFiles]) => {
    const members = unitFiles.map((p) => byPath.get(p)!);
    const heavy = new Set(members.flatMap((f) => f.heavyLanes));
    const rules = [...new Set(members.flatMap((f) => f.rules))];
    const sampled = heavy.size === 0 && isSampled(input.head, id, config.sampleRate);
    const floor = Object.fromEntries(
      LANES.map((lane) => [lane, sampled || heavy.has(lane) ? "heavy" : "light"]),
    ) as Record<Lane, Tier>;
    return {
      id,
      files: unitFiles,
      rules: sampled ? [...rules, "sample"] : rules,
      floor,
      sampled,
      coChange: input.coChange?.(id, unitFiles, changed) ?? [],
    };
  });
  units.sort((a, b) => a.id.localeCompare(b.id));

  const changedLines = files.reduce((sum, f) => sum + f.additions + f.deletions, 0);
  const limits = config.budget;
  return {
    target: input.target,
    base: input.base,
    mergeBase: input.mergeBase,
    head: input.head,
    files,
    units,
    budget: {
      files: files.length,
      changedLines,
      limits,
      exceeded: files.length > limits.maxFiles || changedLines > limits.maxChangedLines,
    },
    warnings: input.warnings ?? [],
  };
}

export function parseNumstat(numstat: string, nameStatus: string): ChangedFile[] {
  const statuses = new Map<string, string>();
  for (const line of nameStatus.split("\n")) {
    const [status, path] = line.split("\t");
    if (status && path) statuses.set(path, status.charAt(0));
  }
  const files: ChangedFile[] = [];
  for (const line of numstat.split("\n")) {
    const [add, del, path] = line.split("\t");
    if (add === undefined || del === undefined || !path) continue;
    files.push({
      path,
      status: statuses.get(path) ?? "M",
      additions: add === "-" ? 0 : Number(add),
      deletions: del === "-" ? 0 : Number(del),
    });
  }
  return files;
}

export function countCoChange(log: string, unitFiles: string[], changed: Set<string>) {
  const counts = new Map<string, number>();
  const unit = new Set(unitFiles);
  for (const commit of log.split("@@").slice(1)) {
    const paths = commit.split("\n").filter(Boolean);
    if (paths.length > 50 || !paths.some((p) => unit.has(p))) continue;
    for (const p of paths) {
      if (!changed.has(p)) counts.set(p, (counts.get(p) ?? 0) + 1);
    }
  }
  return [...counts]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([path, count]) => ({ path, count }));
}

async function git(repo: string, args: string[]): Promise<string> {
  return (await Bun.$`git -C ${repo} ${args}`.quiet().text()).trim();
}

async function defaultBase(repo: string): Promise<string> {
  try {
    return (await git(repo, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])) || "main";
  } catch {
    return "main";
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repo = typeof args.repo === "string" ? args.repo : process.cwd();
  const uncommitted = args.uncommitted === true;
  const { config, warnings } = await loadConfig(repo);

  const base = uncommitted
    ? "HEAD"
    : typeof args.base === "string"
      ? args.base
      : await defaultBase(repo);
  const mergeBase = uncommitted
    ? await git(repo, ["rev-parse", "HEAD"])
    : await git(repo, ["merge-base", base, "HEAD"]);
  const head = await git(repo, ["rev-parse", "--short", "HEAD"]);

  const tracked = parseNumstat(
    await git(repo, ["diff", "--numstat", "--no-renames", mergeBase]),
    await git(repo, ["diff", "--name-status", "--no-renames", mergeBase]),
  );
  const untracked = (await git(repo, ["ls-files", "--others", "--exclude-standard"]))
    .split("\n")
    .filter(Boolean);
  for (const path of untracked) {
    const text = await readFile(join(repo, path), "utf8").catch(() => "");
    tracked.push({
      path,
      status: "A",
      additions: text ? text.split("\n").length : 0,
      deletions: 0,
    });
  }

  const logs = new Map<string, string>();
  const groups = groupUnits(tracked.map((f) => f.path));
  if (groups.size <= 40) {
    for (const [id, unitFiles] of groups) {
      const log = await git(repo, [
        "log",
        "-n",
        "200",
        "--format=@@",
        "--name-only",
        mergeBase,
        "--",
        ...unitFiles,
      ]).catch(() => "");
      logs.set(id, log);
    }
  } else {
    warnings.push(`co-change history skipped: ${groups.size} units exceeds 40`);
  }

  const report = buildReport({
    target: uncommitted ? "uncommitted" : "branch",
    base,
    mergeBase,
    head,
    files: tracked,
    config,
    warnings,
    coChange: (id, unitFiles, changed) => countCoChange(logs.get(id) ?? "", unitFiles, changed),
  });

  const json = JSON.stringify(report, null, 2);
  if (typeof args.out === "string") {
    await Bun.write(args.out, json);
  } else {
    console.log(json);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
