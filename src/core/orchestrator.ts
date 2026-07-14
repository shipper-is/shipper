import { createAdapter } from "../agents/index.ts";
import type {
  AgentAdapter,
  AgentEvent,
  AgentKind,
  AgentQuestion,
  AgentStartOptions,
} from "../agents/types.ts";
import { setProjectConfig } from "./config.ts";
import {
  findPlanByFilename,
  getFirstIncompletePhase,
  isPhaseComplete,
  listPlans,
  type PlanFile,
  type PlanPhase,
} from "./plan-store.ts";
import { buildBuildPrompt, buildFollowUpPrompt, buildPlanPrompt, buildSpikePrompt, appendPendingUserMessages } from "./prompts.ts";
import { RunLogger } from "./run-logger.ts";
import { installSkillsGlobally } from "./skills.ts";
import { defaultBuildGitOptions, type BuildGitOptions } from "../shared/protocol.ts";

export type AgentRunHandlers = {
  onEvent: (event: AgentEvent) => void;
  onQuestion: (question: AgentQuestion) => Promise<Record<string, string | string[]>>;
  onSessionLog?: (logPath: string) => void;
  onAgentSessionId?: (sessionId: string) => void;
  signal?: AbortSignal;
  logger?: RunLogger;
};

export type AgentRunResult = {
  ok: boolean;
  error?: string;
};

export type PlanCreationResult =
  | { status: "success"; plan: PlanFile; lastSessionId: string | null }
  | { status: "error"; message: string; lastSessionId?: string | null };

export type SpikeHandlers = AgentRunHandlers & {
  onPlanUpdate?: () => void;
};

export type SpikeResult =
  | {
      status: "success";
      filename: string;
      title: string;
      location: "open" | "done";
      lastSessionId: string | null;
    }
  | { status: "error"; message: string; lastSessionId?: string | null };

export type BuildLoopHandlers = AgentRunHandlers & {
  onPhaseStart?: (phaseNumber: number) => void;
  onPhaseComplete?: (phaseNumber: number) => void;
  onPlanUpdate?: () => void;
  onSessionLog?: (logPath: string) => void;
  pendingUserMessages?: () => string[];
};

export type BuildLoopResult =
  | {
      status: "success";
      sessionsUsed: number;
      phasesRun: number;
      planLocation: "open" | "done";
      leftInOpen?: boolean;
      lastSessionId: string | null;
    }
  | { status: "error"; message: string; sessionsUsed: number; lastSessionId: string | null }
  | { status: "cancelled"; sessionsUsed: number; lastSessionId: string | null };

export type FollowUpResult = AgentRunResult & { lastSessionId: string | null };

type PhaseSnapshot = {
  checkedCount: number;
  hasCompletionNotes: boolean;
};

function phaseSnapshot(phase: PlanPhase | undefined): PhaseSnapshot {
  return {
    checkedCount: phase?.checkedCount ?? 0,
    hasCompletionNotes: phase?.hasCompletionNotes ?? false,
  };
}

function madePhaseProgress(before: PhaseSnapshot, after: PhaseSnapshot): boolean {
  return (
    after.checkedCount > before.checkedCount ||
    (!before.hasCompletionNotes && after.hasCompletionNotes)
  );
}

function planRelativePath(folder: "open" | "done", filename: string): string {
  return `.shipper/${folder}/${filename}`;
}

function isPlanFullyComplete(plan: PlanFile): boolean {
  if (plan.folder === "done") {
    return true;
  }
  if (plan.parsed.phases.length === 0) {
    return false;
  }
  return plan.parsed.phases.every(isPhaseComplete);
}

export async function consumeAgentRun(
  adapter: AgentAdapter,
  opts: AgentStartOptions,
  handlers: AgentRunHandlers,
): Promise<AgentRunResult> {
  let lastError: string | undefined;
  let reportedSessionId: string | null = null;
  const logger = handlers.logger;

  const reportSessionId = () => {
    const sessionId = adapter.sessionId;
    if (sessionId && sessionId !== reportedSessionId) {
      reportedSessionId = sessionId;
      handlers.onAgentSessionId?.(sessionId);
    }
  };

  const startOpts: AgentStartOptions = logger
    ? {
        ...opts,
        rawLogger: {
          logRaw: (direction, payload) => logger.logRaw(direction, payload),
        },
      }
    : opts;

  try {
    reportSessionId();
    for await (const event of adapter.start(startOpts)) {
      if (handlers.signal?.aborted) {
        await adapter.stop();
        await logger?.close({ ok: false, error: "Cancelled" });
        return { ok: false, error: "Cancelled" };
      }

      handlers.onEvent(event);
      void logger?.logEvent(event);
      reportSessionId();

      if (event.type === "question") {
        const answers = await handlers.onQuestion(event.question);
        if (handlers.signal?.aborted) {
          await adapter.stop();
          await logger?.close({ ok: false, error: "Cancelled" });
          return { ok: false, error: "Cancelled" };
        }
        void logger?.logMeta({ type: "answers", answers });
        adapter.answer(event.question.id, answers);
        continue;
      }

      if (event.type === "error") {
        lastError = event.message;
      }
    }
  } catch (error) {
    if (handlers.signal?.aborted) {
      await adapter.stop().catch(() => undefined);
      await logger?.close({ ok: false, error: "Cancelled" });
      return { ok: false, error: "Cancelled" };
    }
    const message = error instanceof Error ? error.message : String(error);
    await logger?.close({ ok: false, error: message });
    return { ok: false, error: message };
  } finally {
    await adapter.stop().catch(() => undefined);
  }

  reportSessionId();

  if (handlers.signal?.aborted) {
    await logger?.close({ ok: false, error: "Cancelled" });
    return { ok: false, error: "Cancelled" };
  }

  const ok = !lastError;
  await logger?.close({ ok, error: lastError });
  return { ok, error: lastError };
}

function findNewOpenPlan(beforeFilenames: Set<string>, openPlans: PlanFile[]): PlanFile | null {
  const created = openPlans.filter((plan) => !beforeFilenames.has(plan.filename));
  if (created.length === 0) {
    return null;
  }
  return created[created.length - 1] ?? null;
}

function findNewPlan(
  beforeFilenames: Set<string>,
  openPlans: PlanFile[],
  donePlans: PlanFile[],
): { plan: PlanFile; location: "open" | "done" } | null {
  const newOpen = openPlans.filter((plan) => !beforeFilenames.has(plan.filename));
  const newDone = donePlans.filter((plan) => !beforeFilenames.has(plan.filename));
  const created = [...newOpen, ...newDone];
  if (created.length === 0) {
    return null;
  }
  const plan = created[created.length - 1]!;
  const location = newDone.some((p) => p.filename === plan.filename) ? "done" : "open";
  return { plan, location };
}

export async function runPlanCreation(
  repoPath: string,
  agent: AgentKind,
  featureDescription: string,
  handlers: AgentRunHandlers,
  model?: string,
): Promise<PlanCreationResult> {
  const beforePlans = await listPlans(repoPath);
  const beforeFilenames = new Set(beforePlans.open.map((plan) => plan.filename));

  await installSkillsGlobally([agent]);

  const prompt = buildPlanPrompt(featureDescription, agent);
  const adapter = createAdapter(agent);
  const logger = handlers.logger ?? (await RunLogger.create(agent));
  handlers.onSessionLog?.(logger.path);
  const runResult = await consumeAgentRun(
    adapter,
    { cwd: repoPath, prompt, ...(model ? { model } : {}) },
    { ...handlers, logger },
  );
  const lastSessionId = adapter.sessionId;

  const afterPlans = await listPlans(repoPath);
  const newPlan = findNewOpenPlan(beforeFilenames, afterPlans.open);

  if (newPlan) {
    await setProjectConfig(repoPath, { lastPlan: newPlan.filename });
    return { status: "success", plan: newPlan, lastSessionId };
  }

  if (!runResult.ok) {
    return {
      status: "error",
      message: runResult.error ?? "Plan creation failed",
      lastSessionId,
    };
  }

  return {
    status: "error",
    message: "Agent finished but no new plan file appeared in .shipper/open/",
    lastSessionId,
  };
}

export async function runSpike(
  repoPath: string,
  agent: AgentKind,
  description: string,
  handlers: SpikeHandlers,
  model?: string,
): Promise<SpikeResult> {
  const beforePlans = await listPlans(repoPath);
  const beforeFilenames = new Set([
    ...beforePlans.open.map((plan) => plan.filename),
    ...beforePlans.done.map((plan) => plan.filename),
  ]);

  await installSkillsGlobally([agent]);

  const prompt = buildSpikePrompt(description, agent);
  const adapter = createAdapter(agent);
  const logger = handlers.logger ?? (await RunLogger.create(agent));
  handlers.onSessionLog?.(logger.path);
  const runResult = await consumeAgentRun(
    adapter,
    { cwd: repoPath, prompt, ...(model ? { model } : {}) },
    { ...handlers, logger },
  );
  const lastSessionId = adapter.sessionId;

  handlers.onPlanUpdate?.();

  const afterPlans = await listPlans(repoPath);
  const newSpike = findNewPlan(beforeFilenames, afterPlans.open, afterPlans.done);

  if (newSpike) {
    await setProjectConfig(repoPath, { lastPlan: newSpike.plan.filename });
    return {
      status: "success",
      filename: newSpike.plan.filename,
      title: newSpike.plan.title,
      location: newSpike.location,
      lastSessionId,
    };
  }

  if (!runResult.ok) {
    return {
      status: "error",
      message: runResult.error ?? "Spike failed",
      lastSessionId,
    };
  }

  return {
    status: "error",
    message: "Agent finished but no new spike file appeared in .shipper/open/ or .shipper/done/",
    lastSessionId,
  };
}

export async function runBuildLoop(
  repoPath: string,
  agent: AgentKind,
  planFilename: string,
  handlers: BuildLoopHandlers,
  model?: string,
  gitOptions?: BuildGitOptions,
): Promise<BuildLoopResult> {
  const git = gitOptions ?? defaultBuildGitOptions();
  const initialPlan = await findPlanByFilename(repoPath, planFilename);
  if (!initialPlan) {
    return { status: "error", message: "Plan file not found", sessionsUsed: 0, lastSessionId: null };
  }

  if (initialPlan.folder === "done" || isPlanFullyComplete(initialPlan)) {
    return {
      status: "success",
      sessionsUsed: 0,
      phasesRun: 0,
      planLocation: initialPlan.folder,
      leftInOpen: initialPlan.folder === "open",
      lastSessionId: null,
    };
  }

  const maxSessions = initialPlan.parsed.phases.length * 2 + 2;
  let sessionsUsed = 0;
  let lastSessionId: string | null = null;
  const phasesRun = new Set<number>();
  let consecutiveStrikes = 0;
  let lastStrikingPhase: number | null = null;

  while (sessionsUsed < maxSessions) {
    if (handlers.signal?.aborted) {
      return { status: "cancelled", sessionsUsed, lastSessionId };
    }

    const plan = await findPlanByFilename(repoPath, planFilename);
    if (!plan) {
      return {
        status: "error",
        message: "Plan file disappeared",
        sessionsUsed,
        lastSessionId,
      };
    }

    if (plan.folder === "done") {
      return {
        status: "success",
        sessionsUsed,
        phasesRun: phasesRun.size,
        planLocation: "done",
        lastSessionId,
      };
    }

    if (isPlanFullyComplete(plan)) {
      return {
        status: "success",
        sessionsUsed,
        phasesRun: phasesRun.size,
        planLocation: "open",
        leftInOpen: true,
        lastSessionId,
      };
    }

    const targetPhase = getFirstIncompletePhase(plan.parsed);
    if (!targetPhase) {
      return {
        status: "success",
        sessionsUsed,
        phasesRun: phasesRun.size,
        planLocation: plan.folder,
        leftInOpen: plan.folder === "open",
        lastSessionId,
      };
    }

    handlers.onPhaseStart?.(targetPhase.number);

    const beforeSnapshot = phaseSnapshot(
      plan.parsed.phases.find((phase) => phase.number === targetPhase.number),
    );

    await installSkillsGlobally([agent]);

    const pendingMessages = handlers.pendingUserMessages?.() ?? [];
    let prompt = buildBuildPrompt(
      planRelativePath(plan.folder, planFilename),
      targetPhase.number,
      agent,
      git,
    );
    if (pendingMessages.length > 0) {
      prompt = appendPendingUserMessages(prompt, pendingMessages);
    }
    const adapter = createAdapter(agent);
    const sessionLogger = handlers.logger ?? (await RunLogger.create(agent));
    handlers.onSessionLog?.(sessionLogger.path);
    const runResult = await consumeAgentRun(
      adapter,
      { cwd: repoPath, prompt, ...(model ? { model } : {}) },
      { ...handlers, logger: sessionLogger },
    );
    sessionsUsed++;
    phasesRun.add(targetPhase.number);
    lastSessionId = adapter.sessionId;

    if (handlers.signal?.aborted) {
      return { status: "cancelled", sessionsUsed, lastSessionId };
    }

    if (!runResult.ok) {
      return {
        status: "error",
        message: runResult.error ?? "Agent session failed",
        sessionsUsed,
        lastSessionId,
      };
    }

    const afterPlan = await findPlanByFilename(repoPath, planFilename);
    if (!afterPlan) {
      return {
        status: "error",
        message: "Plan file disappeared after session",
        sessionsUsed,
        lastSessionId,
      };
    }

    handlers.onPlanUpdate?.();

    const afterPhase = afterPlan.parsed.phases.find(
      (phase) => phase.number === targetPhase.number,
    );
    const afterSnapshot = phaseSnapshot(afterPhase);

    if (!madePhaseProgress(beforeSnapshot, afterSnapshot)) {
      if (lastStrikingPhase === targetPhase.number) {
        consecutiveStrikes++;
      } else {
        consecutiveStrikes = 1;
        lastStrikingPhase = targetPhase.number;
      }

      if (consecutiveStrikes >= 2) {
        return {
          status: "error",
          message: `Build stalled on Phase ${targetPhase.number}: no progress after two consecutive sessions. Inspect the plan file and re-run build.`,
          sessionsUsed,
          lastSessionId,
        };
      }
    } else {
      consecutiveStrikes = 0;
      lastStrikingPhase = null;
    }

    handlers.onPhaseComplete?.(targetPhase.number);

    if (afterPlan.folder === "done" || isPlanFullyComplete(afterPlan)) {
      return {
        status: "success",
        sessionsUsed,
        phasesRun: phasesRun.size,
        planLocation: afterPlan.folder,
        leftInOpen: afterPlan.folder === "open",
        lastSessionId,
      };
    }
  }

  return {
    status: "error",
    message: `Build loop exceeded session limit (${maxSessions}). Inspect the plan and re-run build.`,
    sessionsUsed,
    lastSessionId,
  };
}

export async function runFollowUp(
  repoPath: string,
  agent: AgentKind,
  message: string,
  resumeSessionId: string | null,
  handlers: AgentRunHandlers,
  options?: { model?: string; planFilename?: string },
): Promise<FollowUpResult> {
  let planRelative: string | undefined;
  if (options?.planFilename) {
    const plan = await findPlanByFilename(repoPath, options.planFilename);
    if (plan) {
      planRelative = planRelativePath(plan.folder, plan.filename);
    }
  }

  const prompt = buildFollowUpPrompt(message, agent, {
    planRelativePath: planRelative,
    resuming: Boolean(resumeSessionId),
  });

  const adapter = createAdapter(agent);
  const logger = handlers.logger ?? (await RunLogger.create(agent));
  handlers.onSessionLog?.(logger.path);
  const runResult = await consumeAgentRun(
    adapter,
    {
      cwd: repoPath,
      prompt,
      ...(resumeSessionId ? { resumeSessionId } : {}),
      ...(options?.model ? { model: options.model } : {}),
    },
    { ...handlers, logger },
  );

  return {
    ...runResult,
    lastSessionId: adapter.sessionId,
  };
}
