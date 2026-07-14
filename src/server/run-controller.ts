import type { AgentEvent, AgentKind, AgentQuestion } from "../agents/types.ts";
import { cursorTranscriptPath } from "../agents/cursor-transcript.ts";
import { groupModelFamilies } from "../agents/model-variants.ts";
import { listModels } from "../agents/models.ts";
import {
  resolveDefaultModel,
  saveModelChoice,
  setProjectConfig,
  type ProjectConfig,
} from "../core/config.ts";
import {
  runBuildLoop,
  runFollowUp,
  runPlanCreation,
  runSpike,
  type AgentRunHandlers,
  type BuildLoopResult,
  type PlanCreationResult,
  type SpikeResult,
} from "../core/orchestrator.ts";
import { DEMO_SCRIPT, runDemoScript } from "../demo/script.ts";
import { findPlanByFilename } from "../core/plan-store.ts";
import type { OrchestratedSkillName } from "../core/skills.ts";
import type {
  AgentQuestion as ProtocolQuestion,
  BuildGitOptions,
  ChatEntry,
  ClientMessage,
  ConfigInfo,
  ModelFamilyDto,
  ModelPickRequest,
  RunState,
  ServerMessage,
  SkillIndicator,
} from "../shared/protocol.ts";
import { defaultBuildGitOptions, idleRunState } from "../shared/protocol.ts";

export const CHAT_MAX_ENTRIES = 500;

export type OrchestratorFns = {
  runBuildLoop: typeof runBuildLoop;
  runPlanCreation: typeof runPlanCreation;
  runFollowUp: typeof runFollowUp;
  runSpike: typeof runSpike;
};

const defaultOrchestrator: OrchestratorFns = {
  runBuildLoop,
  runPlanCreation,
  runFollowUp,
  runSpike,
};

type PendingStart =
  | { kind: "build"; planFilename: string; git: BuildGitOptions }
  | { kind: "plan"; description: string }
  | { kind: "spike"; description: string };

export type RunControllerDeps = {
  repoPath: string;
  getAgent: () => AgentKind | null;
  getConfigInfo: () => ConfigInfo;
  refreshConfigInfo: () => Promise<ConfigInfo>;
  onBroadcast: (msg: ServerMessage) => void;
  onPlanUpdate?: () => void;
  orchestrator?: OrchestratorFns;
};

export type RunController = {
  getRunState: () => RunState;
  getChatEntries: () => ChatEntry[];
  getPendingQuestion: () => ProtocolQuestion | null;
  getModelPickRequest: () => ModelPickRequest | null;
  getQueuedMessages: () => string[];
  handleClientMessage: (msg: ClientMessage) => void;
  startDemo: () => void;
  stopActiveRun: () => void;
  shutdown: () => void;
};

function nextChatId(): string {
  return crypto.randomUUID();
}

function toProtocolQuestion(question: AgentQuestion): ProtocolQuestion {
  return {
    id: question.id,
    items: question.questions.map((item) => ({
      prompt: item.prompt,
      header: item.header,
      allowMultiple: item.multiSelect,
      options: item.options.map((opt, index) => ({
        id: String(index),
        label: opt.label,
      })),
    })),
  };
}

export function applyAgentEvent(
  entries: ChatEntry[],
  event: AgentEvent,
): { entries: ChatEntry[]; append?: ChatEntry; replaceLast?: ChatEntry } {
  const now = Date.now();

  switch (event.type) {
    case "text": {
      if (!event.text) {
        return { entries };
      }
      const last = entries[entries.length - 1];
      if (event.delta === true && last?.kind === "agent-text") {
        const updated: ChatEntry = {
          ...last,
          text: last.text + event.text,
          timestamp: now,
        };
        return {
          entries: [...entries.slice(0, -1), updated],
          replaceLast: updated,
        };
      }
      const entry: ChatEntry = {
        id: nextChatId(),
        kind: "agent-text",
        text: event.text,
        timestamp: now,
      };
      return { entries: [...entries, entry], append: entry };
    }
    case "tool-start": {
      const entry: ChatEntry = {
        id: nextChatId(),
        kind: "tool-start",
        text: event.summary,
        timestamp: now,
        callId: event.callId,
        toolName: event.name,
        pending: true,
      };
      return { entries: [...entries, entry], append: entry };
    }
    case "tool-end": {
      const index = entries.findIndex(
        (entry) => entry.callId === event.callId && entry.kind === "tool-start",
      );
      const entry: ChatEntry = {
        id: index >= 0 ? entries[index]!.id : nextChatId(),
        kind: "tool-end",
        text: event.summary,
        timestamp: now,
        callId: event.callId,
        toolName: event.name,
        pending: false,
      };
      if (index >= 0) {
        const next = [...entries];
        next[index] = {
          ...entry,
          text: `${event.summary}${event.resultSummary ? ` (${event.resultSummary})` : ""}`,
        };
        return { entries: next, replaceLast: next[index] };
      }
      return { entries: [...entries, entry], append: entry };
    }
    case "error": {
      const entry: ChatEntry = {
        id: nextChatId(),
        kind: "error",
        text: event.message,
        timestamp: now,
      };
      return { entries: [...entries, entry], append: entry };
    }
    case "turn-complete": {
      const entry: ChatEntry = {
        id: nextChatId(),
        kind: "turn",
        text: "— turn complete —",
        timestamp: now,
      };
      return { entries: [...entries, entry], append: entry };
    }
    case "done": {
      const entry: ChatEntry = {
        id: nextChatId(),
        kind: "done",
        text: event.result ?? "Done",
        timestamp: now,
      };
      return { entries: [...entries, entry], append: entry };
    }
    case "question":
      return { entries };
    default:
      return { entries };
  }
}

function capEntries(entries: ChatEntry[]): ChatEntry[] {
  return entries.slice(-CHAT_MAX_ENTRIES);
}

function buildSuccessNotice(
  result: Extract<BuildLoopResult, { status: "success" }>,
  planTitle: string,
  planFilename: string,
): string {
  const lines = [
    `Build complete — ${planTitle}`,
    `Phases run: ${result.phasesRun} · Sessions: ${result.sessionsUsed}`,
    `Location: ${result.planLocation === "done" ? ".shipper/done/" : ".shipper/open/"}`,
  ];
  if (result.leftInOpen) {
    lines.push(
      "All tasks are checked but the plan file was left in open/ (the agent did not move it to done/).",
    );
  }
  lines.push(planFilename);
  return lines.join("\n");
}

async function buildModelPickRequest(
  agent: AgentKind,
  skill: OrchestratedSkillName,
): Promise<ModelPickRequest> {
  const models = await listModels(agent);
  const families: ModelFamilyDto[] = groupModelFamilies(models).map((family) => ({
    id: family.id,
    label: family.label,
    variants: family.variants.map((variant) => ({
      id: variant.id,
      label: variant.label,
    })),
  }));
  return { skill, families };
}

function makeSessionPathHandlers(
  repoPath: string,
  agent: AgentKind,
  setRunState: (patch: Partial<RunState>) => void,
): Pick<AgentRunHandlers, "onSessionLog" | "onAgentSessionId"> {
  return {
    onSessionLog: (path) => setRunState({ logPath: path }),
    onAgentSessionId: (sessionId) => {
      if (agent === "cursor") {
        setRunState({ agentTranscriptPath: cursorTranscriptPath(repoPath, sessionId) });
      }
    },
  };
}

export function createRunController(deps: RunControllerDeps): RunController {
  const orchestrator = deps.orchestrator ?? defaultOrchestrator;

  let runState: RunState = idleRunState();
  let chatEntries: ChatEntry[] = [];
  let pendingQuestion: ProtocolQuestion | null = null;
  let modelPickRequest: ModelPickRequest | null = null;
  let pendingStart: PendingStart | null = null;
  let followUpQueue: string[] = [];
  let lastSessionId: string | null = null;
  let lastSkill: SkillIndicator = null;
  let lastPlanFilename: string | null = null;

  let questionResolver: ((answers: Record<string, string | string[]>) => void) | null =
    null;
  let abortController: AbortController | null = null;

  const broadcastQueuedMessages = () => {
    deps.onBroadcast({ type: "queued-messages", messages: [...followUpQueue] });
  };

  const broadcastRunState = () => {
    deps.onBroadcast({ type: "run-state", runState: { ...runState } });
  };

  const setRunState = (patch: Partial<RunState>) => {
    runState = { ...runState, ...patch };
    broadcastRunState();
  };

  const appendNotice = (text: string) => {
    const entry: ChatEntry = {
      id: nextChatId(),
      kind: "notice",
      text,
      timestamp: Date.now(),
    };
    chatEntries = capEntries([...chatEntries, entry]);
    deps.onBroadcast({ type: "chat-append", entry });
  };

  const appendUserMessage = (text: string) => {
    const entry: ChatEntry = {
      id: nextChatId(),
      kind: "user-message",
      text,
      timestamp: Date.now(),
    };
    chatEntries = capEntries([...chatEntries, entry]);
    deps.onBroadcast({ type: "chat-append", entry });
  };

  const handleAgentEvent = (event: AgentEvent) => {
    const result = applyAgentEvent(chatEntries, event);
    chatEntries = capEntries(result.entries);
    if (result.replaceLast) {
      deps.onBroadcast({ type: "chat-replace-last", entry: result.replaceLast });
    } else if (result.append) {
      deps.onBroadcast({ type: "chat-append", entry: result.append });
    }
  };

  const isRunActive = () =>
    runState.status === "running" ||
    runState.status === "waiting-answer" ||
    runState.status === "stopping";

  const clearRun = () => {
    abortController = null;
    questionResolver = null;
    pendingQuestion = null;
    pendingStart = null;
    modelPickRequest = null;
    const { logPath, agentTranscriptPath } = runState;
    runState = { ...idleRunState(), logPath, agentTranscriptPath };
    broadcastRunState();
  };

  const finishBuild = async (
    result: BuildLoopResult,
    planFilename: string,
    planTitle: string,
  ) => {
    lastSessionId = result.lastSessionId;
    lastSkill = "build";
    lastPlanFilename = planFilename;

    if (result.status === "success") {
      appendNotice(buildSuccessNotice(result, planTitle, planFilename));
    } else if (result.status === "cancelled") {
      appendNotice("Build cancelled.");
    } else {
      appendNotice(`Build failed: ${result.message}`);
    }
    deps.onPlanUpdate?.();
    clearRun();
  };

  const finishPlan = (result: PlanCreationResult) => {
    lastSessionId = result.lastSessionId ?? lastSessionId;
    lastSkill = "plan";

    if (result.status === "success") {
      lastPlanFilename = result.plan.filename;
      appendNotice(
        `Plan created — ${result.plan.title}\n${result.plan.filename}\nBuild it now?`,
      );
      deps.onBroadcast({
        type: "plan-created",
        filename: result.plan.filename,
        title: result.plan.title,
      });
      deps.onPlanUpdate?.();
    } else {
      appendNotice(`Plan creation failed: ${result.message}`);
    }
    clearRun();
  };

  const finishSpike = (result: SpikeResult) => {
    lastSessionId = result.lastSessionId ?? lastSessionId;
    lastSkill = "spike";

    if (result.status === "success") {
      lastPlanFilename = result.filename;
      const locationLabel =
        result.location === "done" ? ".shipper/done/" : ".shipper/open/";
      const locationNote =
        result.location === "open"
          ? "\nThe spike file was left in open/ (the agent did not move it to done/)."
          : "";
      appendNotice(`Spike complete — ${result.title}\nLocation: ${locationLabel}${locationNote}`);
      deps.onBroadcast({
        type: "spike-created",
        filename: result.filename,
        title: result.title,
      });
      deps.onPlanUpdate?.();
    } else {
      appendNotice(`Spike failed: ${result.message}`);
    }
    clearRun();
  };

  const runBuild = async (planFilename: string, model: string, git: BuildGitOptions) => {
    const agent = deps.getAgent();
    if (!agent) {
      appendNotice("No agent configured. Open settings to choose one.");
      return;
    }

    const plan = await findPlanByFilename(deps.repoPath, planFilename);
    if (!plan) {
      appendNotice("Plan file not found.");
      return;
    }

    abortController = new AbortController();
    chatEntries = [];
    pendingQuestion = null;
    modelPickRequest = null;
    pendingStart = null;

    runState = {
      status: "running",
      skill: "build",
      planFilename,
      activePhaseNumber: null,
      logPath: null,
      agentTranscriptPath: null,
    };
    broadcastRunState();

    const result = await orchestrator.runBuildLoop(
      deps.repoPath,
      agent,
      planFilename,
      {
        signal: abortController.signal,
        ...makeSessionPathHandlers(deps.repoPath, agent, setRunState),
        onEvent: handleAgentEvent,
        pendingUserMessages: () => {
          if (followUpQueue.length === 0) {
            return [];
          }
          const messages = [...followUpQueue];
          followUpQueue = [];
          broadcastQueuedMessages();
          return messages;
        },
        onQuestion: (question) =>
          new Promise((resolve) => {
            pendingQuestion = toProtocolQuestion(question);
            questionResolver = resolve;
            setRunState({ status: "waiting-answer" });
            deps.onBroadcast({
              type: "question-pending",
              question: pendingQuestion,
              runState: { ...runState },
            });
          }),
        onPhaseStart: (phaseNumber) => setRunState({ activePhaseNumber: phaseNumber }),
        onPlanUpdate: () => deps.onPlanUpdate?.(),
      },
      model,
      git,
    );

    await finishBuild(result, planFilename, plan.title);
  };

  const runPlan = async (description: string, model: string) => {
    const agent = deps.getAgent();
    if (!agent) {
      appendNotice("No agent configured. Open settings to choose one.");
      return;
    }

    abortController = new AbortController();
    chatEntries = [];
    pendingQuestion = null;
    modelPickRequest = null;
    pendingStart = null;

    runState = {
      status: "running",
      skill: "plan",
      planFilename: null,
      activePhaseNumber: null,
      logPath: null,
      agentTranscriptPath: null,
    };
    broadcastRunState();
    appendUserMessage(description.trim());

    const result = await orchestrator.runPlanCreation(
      deps.repoPath,
      agent,
      description.trim(),
      {
        signal: abortController.signal,
        ...makeSessionPathHandlers(deps.repoPath, agent, setRunState),
        onEvent: handleAgentEvent,
        onQuestion: (question) =>
          new Promise((resolve) => {
            pendingQuestion = toProtocolQuestion(question);
            questionResolver = resolve;
            setRunState({ status: "waiting-answer" });
            deps.onBroadcast({
              type: "question-pending",
              question: pendingQuestion,
              runState: { ...runState },
            });
          }),
      },
      model,
    );

    finishPlan(result);
  };

  const runSpikeRun = async (description: string, model: string) => {
    const agent = deps.getAgent();
    if (!agent) {
      appendNotice("No agent configured. Open settings to choose one.");
      return;
    }

    abortController = new AbortController();
    chatEntries = [];
    pendingQuestion = null;
    modelPickRequest = null;
    pendingStart = null;

    runState = {
      status: "running",
      skill: "spike",
      planFilename: null,
      activePhaseNumber: null,
      logPath: null,
      agentTranscriptPath: null,
    };
    broadcastRunState();
    appendUserMessage(description.trim());

    const result = await orchestrator.runSpike(
      deps.repoPath,
      agent,
      description.trim(),
      {
        signal: abortController.signal,
        ...makeSessionPathHandlers(deps.repoPath, agent, setRunState),
        onEvent: handleAgentEvent,
        onPlanUpdate: () => deps.onPlanUpdate?.(),
        onQuestion: (question) =>
          new Promise((resolve) => {
            pendingQuestion = toProtocolQuestion(question);
            questionResolver = resolve;
            setRunState({ status: "waiting-answer" });
            deps.onBroadcast({
              type: "question-pending",
              question: pendingQuestion,
              runState: { ...runState },
            });
          }),
      },
      model,
    );

    finishSpike(result);
  };

  const runFollowUpMessage = async (text: string) => {
    const agent = deps.getAgent();
    if (!agent) {
      appendNotice("No agent configured. Open settings to choose one.");
      return;
    }

    const skill = lastSkill ?? "build";
    const skillName: OrchestratedSkillName =
      skill === "plan"
        ? "shipper-plan"
        : skill === "spike"
          ? "shipper-spike"
          : "shipper-build";
    const model = await resolveDefaultModel(deps.repoPath, agent, skillName);
    if (!model) {
      appendNotice("Choose a default model in settings before sending follow-up messages.");
      return;
    }

    abortController = new AbortController();
    pendingQuestion = null;
    modelPickRequest = null;
    pendingStart = null;

    runState = {
      status: "running",
      skill,
      planFilename: lastPlanFilename,
      activePhaseNumber: null,
      logPath: null,
      agentTranscriptPath: null,
    };
    broadcastRunState();

    const resumeSessionId = agent === "cursor" ? lastSessionId : null;
    const result = await orchestrator.runFollowUp(
      deps.repoPath,
      agent,
      text,
      resumeSessionId,
      {
        signal: abortController.signal,
        ...makeSessionPathHandlers(deps.repoPath, agent, setRunState),
        onEvent: handleAgentEvent,
        onQuestion: (question) =>
          new Promise((resolve) => {
            pendingQuestion = toProtocolQuestion(question);
            questionResolver = resolve;
            setRunState({ status: "waiting-answer" });
            deps.onBroadcast({
              type: "question-pending",
              question: pendingQuestion,
              runState: { ...runState },
            });
          }),
      },
      {
        model,
        planFilename: lastPlanFilename ?? undefined,
      },
    );

    if (result.lastSessionId) {
      lastSessionId = result.lastSessionId;
    }

    if (!result.ok) {
      appendNotice(`Follow-up failed: ${result.error ?? "unknown error"}`);
    }
    clearRun();
  };

  const sendMessage = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    if (pendingQuestion) {
      return;
    }

    appendUserMessage(trimmed);

    if (isRunActive()) {
      followUpQueue.push(trimmed);
      broadcastQueuedMessages();
      appendNotice("Message queued for the next agent session.");
      return;
    }

    void runFollowUpMessage(trimmed);
  };

  const requestModelPick = async (skill: OrchestratedSkillName, pending: PendingStart) => {
    const agent = deps.getAgent();
    if (!agent) {
      appendNotice("No agent configured. Open settings to choose one.");
      return;
    }

    pendingStart = pending;
    try {
      modelPickRequest = await buildModelPickRequest(agent, skill);
      deps.onBroadcast({ type: "needs-model-pick", modelPickRequest });
    } catch (error) {
      pendingStart = null;
      const message = error instanceof Error ? error.message : String(error);
      appendNotice(`Failed to load models: ${message}`);
    }
  };

  const configureModel = async (skill: OrchestratedSkillName) => {
    const agent = deps.getAgent();
    if (!agent) {
      appendNotice("No agent configured. Open settings to choose one.");
      return;
    }

    try {
      modelPickRequest = await buildModelPickRequest(agent, skill);
      deps.onBroadcast({ type: "needs-model-pick", modelPickRequest });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendNotice(`Failed to load models: ${message}`);
    }
  };

  const cancelModelPick = () => {
    modelPickRequest = null;
    pendingStart = null;
    deps.onBroadcast({ type: "model-pick-cleared" });
  };

  const startBuild = async (planFilename: string, git?: BuildGitOptions) => {
    if (isRunActive()) {
      deps.onBroadcast({ type: "notice", text: "A run is already in progress." });
      return;
    }

    const agent = deps.getAgent();
    if (!agent) {
      appendNotice("No agent configured. Open settings to choose one.");
      return;
    }

    const gitOptions = git ?? defaultBuildGitOptions();
    const model = await resolveDefaultModel(deps.repoPath, agent, "shipper-build");
    if (!model) {
      await requestModelPick("shipper-build", { kind: "build", planFilename, git: gitOptions });
      return;
    }

    await runBuild(planFilename, model, gitOptions);
  };

  const startPlan = async (description: string) => {
    if (isRunActive()) {
      deps.onBroadcast({ type: "notice", text: "A run is already in progress." });
      return;
    }

    const trimmed = description.trim();
    if (!trimmed) {
      deps.onBroadcast({ type: "notice", text: "Enter a feature description first." });
      return;
    }

    const agent = deps.getAgent();
    if (!agent) {
      appendNotice("No agent configured. Open settings to choose one.");
      return;
    }

    const model = await resolveDefaultModel(deps.repoPath, agent, "shipper-plan");
    if (!model) {
      await requestModelPick("shipper-plan", { kind: "plan", description: trimmed });
      return;
    }

    await runPlan(trimmed, model);
  };

  const startSpike = async (description: string) => {
    if (isRunActive()) {
      deps.onBroadcast({ type: "notice", text: "A run is already in progress." });
      return;
    }

    const trimmed = description.trim();
    if (!trimmed) {
      deps.onBroadcast({ type: "notice", text: "Enter a task description first." });
      return;
    }

    const agent = deps.getAgent();
    if (!agent) {
      appendNotice("No agent configured. Open settings to choose one.");
      return;
    }

    const model = await resolveDefaultModel(deps.repoPath, agent, "shipper-spike");
    if (!model) {
      await requestModelPick("shipper-spike", { kind: "spike", description: trimmed });
      return;
    }

    await runSpikeRun(trimmed, model);
  };

  const selectModel = async (skill: OrchestratedSkillName, modelId: string) => {
    const agent = deps.getAgent();
    if (!agent) {
      appendNotice("No agent configured. Open settings to choose one.");
      return;
    }

    await saveModelChoice(deps.repoPath, agent, skill, modelId);
    modelPickRequest = null;
    deps.onBroadcast({ type: "model-pick-cleared" });

    const pending = pendingStart;
    pendingStart = null;
    if (!pending) {
      const configInfo = await deps.refreshConfigInfo();
      deps.onBroadcast({ type: "config-info", configInfo });
      return;
    }

    if (pending.kind === "build" && skill === "shipper-build") {
      await runBuild(pending.planFilename, modelId, pending.git);
    } else if (pending.kind === "plan" && skill === "shipper-plan") {
      await runPlan(pending.description, modelId);
    } else if (pending.kind === "spike" && skill === "shipper-spike") {
      await runSpikeRun(pending.description, modelId);
    }
  };

  const stop = () => {
    if (!isRunActive()) {
      return;
    }
    setRunState({ status: "stopping" });
    abortController?.abort();
  };

  const answerQuestion = (questionId: string, answers: Record<string, string | string[]>) => {
    if (!pendingQuestion || pendingQuestion.id !== questionId || !questionResolver) {
      return;
    }

    questionResolver(answers);
    questionResolver = null;
    pendingQuestion = null;
    setRunState({ status: "running" });
    deps.onBroadcast({ type: "question-cleared" });
  };

  const setAgent = async (agent: AgentKind) => {
    await setProjectConfig(deps.repoPath, { agent });
    const configInfo = await deps.refreshConfigInfo();
    deps.onBroadcast({ type: "config-info", configInfo });
  };

  const rescanAgents = async () => {
    const configInfo = await deps.refreshConfigInfo();
    deps.onBroadcast({ type: "config-info", configInfo });
  };

  const startDemo = async () => {
    if (isRunActive()) {
      deps.onBroadcast({ type: "notice", text: "A run is already in progress." });
      return;
    }

    abortController = new AbortController();
    chatEntries = [];
    pendingQuestion = null;
    modelPickRequest = null;
    pendingStart = null;

    runState = {
      status: "running",
      skill: "build",
      planFilename: null,
      activePhaseNumber: null,
      logPath: null,
      agentTranscriptPath: null,
    };
    broadcastRunState();
    appendNotice("Demo mode — scripted agent run for UI verification.");

    const signal = abortController.signal;

    try {
      await runDemoScript(DEMO_SCRIPT, {
        signal,
        onEvent: handleAgentEvent,
        onQuestion: (question) =>
          new Promise<void>((resolve) => {
            pendingQuestion = toProtocolQuestion(question);
            questionResolver = () => {
              resolve();
            };
            setRunState({ status: "waiting-answer" });
            deps.onBroadcast({
              type: "question-pending",
              question: pendingQuestion,
              runState: { ...runState },
            });
          }),
      });

      if (!signal.aborted) {
        appendNotice("Demo complete.");
      } else {
        appendNotice("Demo cancelled.");
      }
    } catch (error) {
      if (!signal.aborted) {
        const message = error instanceof Error ? error.message : String(error);
        appendNotice(`Demo failed: ${message}`);
      }
    }

    clearRun();
  };

  return {
    getRunState: () => runState,
    getChatEntries: () => chatEntries,
    getPendingQuestion: () => pendingQuestion,
    getModelPickRequest: () => modelPickRequest,
    getQueuedMessages: () => [...followUpQueue],
    handleClientMessage(msg: ClientMessage) {
      switch (msg.type) {
        case "start-build":
          void startBuild(msg.planFilename, msg.git);
          break;
        case "start-plan":
          void startPlan(msg.description);
          break;
        case "start-spike":
          void startSpike(msg.description);
          break;
        case "stop-run":
          stop();
          break;
        case "answer-question":
          answerQuestion(msg.questionId, msg.answers);
          break;
        case "select-model":
          void selectModel(msg.skill, msg.modelId);
          break;
        case "configure-model":
          void configureModel(msg.skill);
          break;
        case "cancel-model-pick":
          cancelModelPick();
          break;
        case "set-agent":
          void setAgent(msg.agent);
          break;
        case "rescan-agents":
          void rescanAgents();
          break;
        case "send-message":
          sendMessage(msg.text);
          break;
        default:
          break;
      }
    },
    startDemo: () => {
      void startDemo();
    },
    stopActiveRun: stop,
    shutdown: stop,
  };
}

export async function enrichConfigInfo(
  repoPath: string,
  base: ConfigInfo,
): Promise<ConfigInfo> {
  const agent = base.defaultAgent;
  if (!agent) {
    return base;
  }

  const [planModel, buildModel, spikeModel] = await Promise.all([
    resolveDefaultModel(repoPath, agent, "shipper-plan"),
    resolveDefaultModel(repoPath, agent, "shipper-build"),
    resolveDefaultModel(repoPath, agent, "shipper-spike"),
  ]);

  return {
    ...base,
    models: {
      ...(planModel ? { "shipper-plan": planModel } : {}),
      ...(buildModel ? { "shipper-build": buildModel } : {}),
      ...(spikeModel ? { "shipper-spike": spikeModel } : {}),
    },
  };
}

export async function patchProjectConfig(
  repoPath: string,
  patch: Partial<ProjectConfig>,
): Promise<void> {
  await setProjectConfig(repoPath, patch);
}
