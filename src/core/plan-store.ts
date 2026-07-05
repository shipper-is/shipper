import chokidar, { type FSWatcher } from "chokidar";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

export type ChecklistItem = {
  text: string;
  checked: boolean;
  line: number;
};

export type PlanSection = {
  title: string;
  items: ChecklistItem[];
  checkedCount: number;
  uncheckedCount: number;
};

export type PlanPhase = {
  number: number;
  title: string;
  introLines: string[];
  sections: PlanSection[];
  hasCompletionNotes: boolean;
  checkedCount: number;
  uncheckedCount: number;
};

export type ParsedPlan = {
  title: string;
  phases: PlanPhase[];
  totalChecked: number;
  totalUnchecked: number;
};

export type PlanProgress = {
  totalChecked: number;
  totalUnchecked: number;
  currentPhase: number | null;
  phaseCount: number;
};

export type PlanMeta = {
  type: "plan" | "spike";
  branch: string | null;
  baseBranch: string | null;
  worktree: string | null;
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
    worktree: null,
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
      worktree: asMetaString(record.worktree),
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

export type PlanFile = {
  filename: string;
  path: string;
  folder: "open" | "done";
  origin: "main" | "worktree";
  title: string;
  progress: PlanProgress;
  parsed: ParsedPlan;
  meta: PlanMeta;
};

const PHASE_RE = /^## Phase (\d+)(?::\s*(.*))?$/;
const SECTION_RE = /^### (.+)$/;
const CHECKLIST_RE = /^- \[([ xX])\] (.+)$/;
const TITLE_RE = /^# (.+)$/;
const ANY_HEADING_RE = /^#{1,6} /;
const COMPLETION_NOTES_RE = /^#{1,6}\s+Completion Notes\b/i;

function countItems(items: ChecklistItem[]): { checked: number; unchecked: number } {
  let checked = 0;
  let unchecked = 0;
  for (const item of items) {
    if (item.checked) checked++;
    else unchecked++;
  }
  return { checked, unchecked };
}

function makeSection(title: string, items: ChecklistItem[]): PlanSection {
  const counts = countItems(items);
  return {
    title,
    items,
    checkedCount: counts.checked,
    uncheckedCount: counts.unchecked,
  };
}

function makePhase(
  number: number,
  title: string,
  introLines: string[],
  sections: PlanSection[],
  hasCompletionNotes: boolean,
): PlanPhase {
  let checkedCount = 0;
  let uncheckedCount = 0;
  for (const section of sections) {
    checkedCount += section.checkedCount;
    uncheckedCount += section.uncheckedCount;
  }
  return {
    number,
    title,
    introLines,
    sections,
    hasCompletionNotes,
    checkedCount,
    uncheckedCount,
  };
}

export function parsePlan(markdown: string): ParsedPlan {
  try {
    const lines = markdown.split(/\r?\n/);
    let title = "Untitled Plan";

    for (const line of lines) {
      const titleMatch = TITLE_RE.exec(line);
      if (titleMatch) {
        title = titleMatch[1]!.trim();
        break;
      }
    }

    const phaseStarts: Array<{ index: number; number: number; title: string }> = [];
    for (let i = 0; i < lines.length; i++) {
      const match = PHASE_RE.exec(lines[i]!);
      if (match) {
        phaseStarts.push({
          index: i,
          number: Number.parseInt(match[1]!, 10),
          title: (match[2] ?? "").trim(),
        });
      }
    }

    if (phaseStarts.length === 0) {
      const allItems: ChecklistItem[] = [];
      for (let i = 0; i < lines.length; i++) {
        const check = CHECKLIST_RE.exec(lines[i]!);
        if (check) {
          allItems.push({
            text: check[2]!.trim(),
            checked: check[1] !== " ",
            line: i + 1,
          });
        }
      }
      const section = makeSection("Tasks", allItems);
      const phase = makePhase(1, "", [], [section], false);
      return {
        title,
        phases: allItems.length > 0 ? [phase] : [],
        totalChecked: section.checkedCount,
        totalUnchecked: section.uncheckedCount,
      };
    }

    const phases: PlanPhase[] = [];

    for (let p = 0; p < phaseStarts.length; p++) {
      const start = phaseStarts[p]!;
      const end = p + 1 < phaseStarts.length ? phaseStarts[p + 1]!.index : lines.length;
      const slice = lines.slice(start.index + 1, end);

      let hasCompletionNotes = false;
      const introLines: string[] = [];
      const sections: PlanSection[] = [];
      let currentSection: PlanSection | null = null;
      let currentItems: ChecklistItem[] = [];
      let inIntro = true;

      for (let i = 0; i < slice.length; i++) {
        const line = slice[i]!;
        const absoluteLine = start.index + 2 + i;

        if (COMPLETION_NOTES_RE.test(line)) {
          hasCompletionNotes = true;
          inIntro = false;
          if (currentItems.length > 0) {
            const sectionTitle = currentSection?.title ?? "Tasks";
            sections.push(makeSection(sectionTitle, currentItems));
            currentItems = [];
            currentSection = null;
          }
          continue;
        }

        const sectionMatch = SECTION_RE.exec(line);
        if (sectionMatch) {
          inIntro = false;
          if (currentItems.length > 0) {
            sections.push(
              makeSection(currentSection?.title ?? "Tasks", currentItems),
            );
            currentItems = [];
          }
          currentSection = makeSection(sectionMatch[1]!.trim(), []);
          continue;
        }

        const checkMatch = CHECKLIST_RE.exec(line);
        if (checkMatch) {
          inIntro = false;
          currentItems.push({
            text: checkMatch[2]!.trim(),
            checked: checkMatch[1] !== " ",
            line: absoluteLine,
          });
          continue;
        }

        if (inIntro && line.trim() && !ANY_HEADING_RE.test(line)) {
          introLines.push(line);
        }
      }

      if (currentItems.length > 0) {
        sections.push(makeSection(currentSection?.title ?? "Tasks", currentItems));
      } else if (currentSection && currentSection.items.length > 0) {
        sections.push(currentSection);
      }

      phases.push(
        makePhase(start.number, start.title, introLines, sections, hasCompletionNotes),
      );
    }

    let totalChecked = 0;
    let totalUnchecked = 0;
    for (const phase of phases) {
      totalChecked += phase.checkedCount;
      totalUnchecked += phase.uncheckedCount;
    }

    return { title, phases, totalChecked, totalUnchecked };
  } catch {
    return {
      title: "Untitled Plan",
      phases: [],
      totalChecked: 0,
      totalUnchecked: 0,
    };
  }
}

export function isPhaseComplete(phase: PlanPhase): boolean {
  return (
    phase.hasCompletionNotes ||
    (phase.uncheckedCount === 0 && phase.checkedCount > 0)
  );
}

export function getFirstIncompletePhase(parsed: ParsedPlan): PlanPhase | null {
  for (const phase of parsed.phases) {
    if (!isPhaseComplete(phase)) {
      return phase;
    }
  }
  return null;
}

export function getPlanProgress(parsed: ParsedPlan): PlanProgress {
  let currentPhase: number | null = null;

  for (const phase of parsed.phases) {
    if (!isPhaseComplete(phase)) {
      currentPhase = phase.number;
      break;
    }
  }

  return {
    totalChecked: parsed.totalChecked,
    totalUnchecked: parsed.totalUnchecked,
    currentPhase,
    phaseCount: parsed.phases.length,
  };
}

export async function ensureShipperDirs(repoPath: string): Promise<void> {
  await mkdir(join(repoPath, ".shipper", "open"), { recursive: true });
  await mkdir(join(repoPath, ".shipper", "done"), { recursive: true });
}

async function readPlanFileAt(
  path: string,
  folder: "open" | "done",
  filename: string,
  origin: "main" | "worktree",
): Promise<PlanFile> {
  const markdown = await readFile(path, "utf8");
  const parsed = parsePlan(markdown);
  return {
    filename,
    path,
    folder,
    origin,
    title: parsed.title,
    progress: getPlanProgress(parsed),
    parsed,
    meta: parseFrontmatter(markdown),
  };
}

async function readFolderPlans(
  shipperRoot: string,
  folder: "open" | "done",
  origin: "main" | "worktree",
): Promise<PlanFile[]> {
  const dir = join(shipperRoot, folder);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const mdFiles = entries.filter((f) => f.endsWith(".md")).sort();
  const plans: PlanFile[] = [];
  for (const filename of mdFiles) {
    try {
      plans.push(
        await readPlanFileAt(join(dir, filename), folder, filename, origin),
      );
    } catch {
      // skip unreadable files
    }
  }
  return plans;
}

/** Worktree copy wins when the same filename exists in main and a worktree. */
function dedupePlansByFilename(plans: PlanFile[]): PlanFile[] {
  const byFilename = new Map<string, PlanFile>();
  for (const plan of plans) {
    const existing = byFilename.get(plan.filename);
    if (!existing) {
      byFilename.set(plan.filename, plan);
      continue;
    }
    if (plan.origin === "worktree" && existing.origin === "main") {
      byFilename.set(plan.filename, plan);
    }
  }
  return [...byFilename.values()].sort((a, b) =>
    a.filename.localeCompare(b.filename),
  );
}

async function listWorktreePlans(repoPath: string): Promise<{
  open: PlanFile[];
  done: PlanFile[];
}> {
  const worktreesDir = join(repoPath, ".shipper", "worktrees");
  let entries: string[];
  try {
    entries = await readdir(worktreesDir);
  } catch {
    return { open: [], done: [] };
  }

  const open: PlanFile[] = [];
  const done: PlanFile[] = [];

  for (const entry of entries) {
    const worktreeRoot = join(worktreesDir, entry);
    const shipperRoot = join(worktreeRoot, ".shipper");
    try {
      await stat(shipperRoot);
    } catch {
      continue;
    }
    open.push(...(await readFolderPlans(shipperRoot, "open", "worktree")));
    done.push(...(await readFolderPlans(shipperRoot, "done", "worktree")));
  }

  return { open, done };
}

export async function listPlans(repoPath: string): Promise<{
  open: PlanFile[];
  done: PlanFile[];
}> {
  await ensureShipperDirs(repoPath);

  const mainShipper = join(repoPath, ".shipper");
  const mainOpen = await readFolderPlans(mainShipper, "open", "main");
  const mainDone = await readFolderPlans(mainShipper, "done", "main");
  const worktreePlans = await listWorktreePlans(repoPath);

  return {
    open: dedupePlansByFilename([...mainOpen, ...worktreePlans.open]),
    done: dedupePlansByFilename([...mainDone, ...worktreePlans.done]),
  };
}

export async function findPlanByFilename(
  repoPath: string,
  filename: string,
): Promise<PlanFile | null> {
  const plans = await listPlans(repoPath);
  return (
    plans.open.find((plan) => plan.filename === filename) ??
    plans.done.find((plan) => plan.filename === filename) ??
    null
  );
}

export function watchPlans(
  repoPath: string,
  onChange: () => void,
): FSWatcher {
  const patterns = [
    join(repoPath, ".shipper", "open", "*.md"),
    join(repoPath, ".shipper", "done", "*.md"),
    join(repoPath, ".shipper", "worktrees", "*", ".shipper", "open", "*.md"),
    join(repoPath, ".shipper", "worktrees", "*", ".shipper", "done", "*.md"),
  ];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const watcher = chokidar.watch(patterns, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100 },
  });

  const debounced = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, 200);
  };

  watcher.on("add", debounced);
  watcher.on("change", debounced);
  watcher.on("unlink", debounced);

  return watcher;
}
