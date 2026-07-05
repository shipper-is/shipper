import { readFile } from "node:fs/promises";
import { join } from "node:path";
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

async function loadPlanSummary(
  repoPath: string,
  plan: PlanFile,
): Promise<PlanSummary> {
  const markdown = await readFile(
    join(repoPath, ".shipper", plan.folder, plan.filename),
    "utf8",
  );
  return planFileToSummary(plan, markdown);
}

export async function loadPlansSnapshot(repoPath: string): Promise<PlansSnapshot> {
  const listed = await listPlans(repoPath);
  const open: PlanSummary[] = [];
  for (const plan of listed.open) {
    open.push(await loadPlanSummary(repoPath, plan));
  }
  const done: PlanSummary[] = [];
  for (const plan of listed.done) {
    done.push(await loadPlanSummary(repoPath, plan));
  }
  return { open, done };
}

export type PlansWatcher = {
  getPlans: () => PlansSnapshot;
  start: () => Promise<void>;
  stop: () => Promise<void>;
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
