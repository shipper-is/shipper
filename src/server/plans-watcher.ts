import { readFile, writeFile } from "node:fs/promises";
import {
  isPhaseComplete,
  listPlans,
  watchPlans,
  type PlanFile,
  type PlanPhase,
} from "../core/plan-store.ts";
import type {
  PlanPhaseDto,
  PlanSummary,
  PlansSnapshot,
} from "../shared/protocol.ts";

export function planFileToSummary(plan: PlanFile, rawMarkdown: string): PlanSummary {
  return {
    filename: plan.filename,
    path: plan.path,
    folder: plan.folder,
    title: plan.title,
    progress: {
      totalChecked: plan.progress.totalChecked,
      totalUnchecked: plan.progress.totalUnchecked,
      currentPhase: plan.progress.currentPhase,
      phaseCount: plan.progress.phaseCount,
    },
    phases: plan.parsed.phases.map(phaseToDto),
    rawMarkdown,
    meta: plan.meta,
  };
}

export function phaseToDto(phase: PlanPhase): PlanPhaseDto {
  return {
    number: phase.number,
    title: phase.title,
    checkedCount: phase.checkedCount,
    uncheckedCount: phase.uncheckedCount,
    complete: isPhaseComplete(phase),
    sections: phase.sections.map((section) => ({
      title: section.title,
      checkedCount: section.checkedCount,
      uncheckedCount: section.uncheckedCount,
    })),
  };
}

async function loadPlanSummary(plan: PlanFile): Promise<PlanSummary> {
  const markdown = await readFile(plan.path, "utf8");
  return planFileToSummary(plan, markdown);
}

export async function loadPlansSnapshot(repoPath: string): Promise<PlansSnapshot> {
  const listed = await listPlans(repoPath);
  const open: PlanSummary[] = [];
  for (const plan of listed.open) {
    open.push(await loadPlanSummary(plan));
  }
  const done: PlanSummary[] = [];
  for (const plan of listed.done) {
    done.push(await loadPlanSummary(plan));
  }
  return { open, done };
}

export async function savePlanMarkdown(
  plans: PlansSnapshot,
  planFilename: string,
  markdown: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const summary =
    plans.open.find((plan) => plan.filename === planFilename) ??
    plans.done.find((plan) => plan.filename === planFilename);
  if (!summary) {
    return { ok: false, error: "Plan not found." };
  }
  if (summary.folder !== "open") {
    return { ok: false, error: "Only open plans can be edited." };
  }
  await writeFile(summary.path, markdown, "utf8");
  return { ok: true };
}

export type PlansWatcher = {
  getPlans: () => PlansSnapshot;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  refresh: () => Promise<PlansSnapshot>;
  savePlan: (
    planFilename: string,
    markdown: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
};

export function createPlansWatcher(
  repoPath: string,
  onUpdate: (plans: PlansSnapshot) => void,
): PlansWatcher {
  let current: PlansSnapshot = { open: [], done: [] };
  let watcher: ReturnType<typeof watchPlans> | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const refresh = async () => {
    if (stopped) return;
    current = await loadPlansSnapshot(repoPath);
    onUpdate(current);
  };

  const scheduleRefresh = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void refresh();
    }, 0);
  };

  return {
    getPlans: () => current,
    savePlan: async (planFilename, markdown) => {
      const result = await savePlanMarkdown(current, planFilename, markdown);
      if (result.ok) {
        await refresh();
      }
      return result;
    },
    refresh: async () => {
      await refresh();
      return current;
    },
    start: async () => {
      stopped = false;
      await refresh();
      watcher = watchPlans(repoPath, scheduleRefresh);
    },
    stop: async () => {
      stopped = true;
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
      await watcher?.close();
      watcher = null;
    },
  };
}
