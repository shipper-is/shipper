import { z } from "zod";

export type PlanProgressDto = {
  totalChecked: number;
  totalUnchecked: number;
  currentPhase: number | null;
  phaseCount: number;
};

export type PlanPhaseSectionDto = {
  title: string;
  checkedCount: number;
  uncheckedCount: number;
};

export type PlanPhaseDto = {
  number: number;
  title: string;
  checkedCount: number;
  uncheckedCount: number;
  complete: boolean;
  sections: PlanPhaseSectionDto[];
};

export type PlanMetaDto = {
  type: "plan" | "spike";
  branch: string | null;
  startedAt: string | null;
  completedAt: string | null;
  prUrl: string | null;
  prNumber: number | null;
};

export type PlanSummary = {
  filename: string;
  folder: "open" | "done";
  title: string;
  progress: PlanProgressDto;
  phases: PlanPhaseDto[];
  rawMarkdown: string;
  meta: PlanMetaDto;
};

export type PlansSnapshot = {
  open: PlanSummary[];
  done: PlanSummary[];
};

export type RunStatus = "idle" | "running" | "waiting-answer" | "stopping";

export type SkillIndicator = "plan" | "build" | "ship" | "spike" | null;

export type RunState = {
  status: RunStatus;
  skill: SkillIndicator;
  planFilename: string | null;
  activePhaseNumber: number | null;
  logPath: string | null;
};

export type ChatEntryKind =
  | "agent-text"
  | "user-message"
  | "tool-start"
  | "tool-end"
  | "turn"
  | "done"
  | "error"
  | "notice";

export type ChatEntry = {
  id: string;
  kind: ChatEntryKind;
  text: string;
  timestamp: number;
  callId?: string;
  toolName?: string;
  pending?: boolean;
};

export type AgentQuestionOption = {
  id: string;
  label: string;
};

export type AgentQuestionItem = {
  prompt: string;
  header?: string;
  options: AgentQuestionOption[];
  allowMultiple?: boolean;
};

export type AgentQuestion = {
  id: string;
  items: AgentQuestionItem[];
};

export type DetectedAgent = {
  kind: "claude" | "cursor" | "opencode";
  available: boolean;
  label: string;
};

export type ConfigInfo = {
  repoPath: string;
  defaultAgent: "claude" | "cursor" | "opencode" | null;
  detectedAgents: DetectedAgent[];
  models?: {
    "shipper-plan"?: string;
    "shipper-build"?: string;
    "shipper-spike"?: string;
  };
};

export type ModelVariantDto = {
  id: string;
  label: string;
};

export type ModelFamilyDto = {
  id: string;
  label: string;
  variants: ModelVariantDto[];
};

export type ModelPickRequest = {
  skill: "shipper-plan" | "shipper-build" | "shipper-spike";
  families: ModelFamilyDto[];
};

export type TerminalState = {
  available: boolean;
  active: boolean;
  message: string | null;
};

export type ServerSnapshot = {
  type: "snapshot";
  plans: PlansSnapshot;
  runState: RunState;
  chatEntries: ChatEntry[];
  pendingQuestion: AgentQuestion | null;
  modelPickRequest: ModelPickRequest | null;
  queuedMessages: string[];
  configInfo: ConfigInfo;
  terminalState: TerminalState;
};

export type ServerQueuedMessages = {
  type: "queued-messages";
  messages: string[];
};

export type ServerPlansUpdated = {
  type: "plans-updated";
  plans: PlansSnapshot;
};

export type ServerChatAppend = {
  type: "chat-append";
  entry: ChatEntry;
};

export type ServerChatReplaceLast = {
  type: "chat-replace-last";
  entry: ChatEntry;
};

export type ServerRunState = {
  type: "run-state";
  runState: RunState;
};

export type ServerQuestionPending = {
  type: "question-pending";
  question: AgentQuestion;
  runState: RunState;
};

export type ServerQuestionCleared = {
  type: "question-cleared";
};

export type ServerTerminalState = {
  type: "terminal-state";
  terminalState: TerminalState;
};

export type ServerNotice = {
  type: "notice";
  text: string;
};

export type ServerConfigInfo = {
  type: "config-info";
  configInfo: ConfigInfo;
};

export type ServerNeedsModelPick = {
  type: "needs-model-pick";
  modelPickRequest: ModelPickRequest;
};

export type ServerModelPickCleared = {
  type: "model-pick-cleared";
};

export type ServerPlanCreated = {
  type: "plan-created";
  filename: string;
  title: string;
};

export type ServerSpikeCreated = {
  type: "spike-created";
  filename: string;
  title: string;
};

/** Marker type — terminal output uses binary WebSocket frames, not JSON. */
export type ServerTerminalData = {
  type: "terminal-data";
};

export type ServerMessage =
  | ServerSnapshot
  | ServerPlansUpdated
  | ServerChatAppend
  | ServerChatReplaceLast
  | ServerRunState
  | ServerQuestionPending
  | ServerQuestionCleared
  | ServerTerminalState
  | ServerNotice
  | ServerConfigInfo
  | ServerNeedsModelPick
  | ServerModelPickCleared
  | ServerPlanCreated
  | ServerSpikeCreated
  | ServerQueuedMessages;

export type ClientStartBuild = {
  type: "start-build";
  planFilename: string;
};

export type ClientStartPlan = {
  type: "start-plan";
  description: string;
};

export type ClientStartSpike = {
  type: "start-spike";
  description: string;
};

export type ClientStopRun = {
  type: "stop-run";
};

export type ClientAnswerQuestion = {
  type: "answer-question";
  questionId: string;
  answers: Record<string, string | string[]>;
};

export type ClientSendMessage = {
  type: "send-message";
  text: string;
};

export type ClientSelectModel = {
  type: "select-model";
  skill: "shipper-plan" | "shipper-build" | "shipper-spike";
  modelId: string;
};

export type ClientConfigureModel = {
  type: "configure-model";
  skill: "shipper-plan" | "shipper-build" | "shipper-spike";
};

export type ClientCancelModelPick = {
  type: "cancel-model-pick";
};

export type ClientSetAgent = {
  type: "set-agent";
  agent: "claude" | "cursor" | "opencode";
};

export type ClientRescanAgents = {
  type: "rescan-agents";
};

export type ClientTerminalInput = {
  type: "terminal-input";
  data: string;
};

export type ClientTerminalResize = {
  type: "terminal-resize";
  cols: number;
  rows: number;
};

export type ClientTerminalOpen = {
  type: "terminal-open";
};

export type ClientSavePlan = {
  type: "save-plan";
  planFilename: string;
  markdown: string;
};

export type ClientMessage =
  | ClientStartBuild
  | ClientStartPlan
  | ClientStartSpike
  | ClientStopRun
  | ClientAnswerQuestion
  | ClientSendMessage
  | ClientSelectModel
  | ClientConfigureModel
  | ClientCancelModelPick
  | ClientSetAgent
  | ClientRescanAgents
  | ClientTerminalInput
  | ClientTerminalResize
  | ClientTerminalOpen
  | ClientSavePlan;

export const idleRunState = (): RunState => ({
  status: "idle",
  skill: null,
  planFilename: null,
  activePhaseNumber: null,
  logPath: null,
});

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("start-build"),
    planFilename: z.string().min(1),
  }),
  z.object({
    type: z.literal("start-plan"),
    description: z.string(),
  }),
  z.object({
    type: z.literal("start-spike"),
    description: z.string(),
  }),
  z.object({ type: z.literal("stop-run") }),
  z.object({
    type: z.literal("answer-question"),
    questionId: z.string().min(1),
    answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  }),
  z.object({
    type: z.literal("send-message"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("select-model"),
    skill: z.enum(["shipper-plan", "shipper-build", "shipper-spike"]),
    modelId: z.string().min(1),
  }),
  z.object({
    type: z.literal("configure-model"),
    skill: z.enum(["shipper-plan", "shipper-build", "shipper-spike"]),
  }),
  z.object({ type: z.literal("cancel-model-pick") }),
  z.object({
    type: z.literal("set-agent"),
    agent: z.enum(["claude", "cursor", "opencode"]),
  }),
  z.object({ type: z.literal("rescan-agents") }),
  z.object({
    type: z.literal("terminal-input"),
    data: z.string(),
  }),
  z.object({
    type: z.literal("terminal-resize"),
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
  }),
  z.object({ type: z.literal("terminal-open") }),
  z.object({
    type: z.literal("save-plan"),
    planFilename: z.string().min(1),
    markdown: z.string(),
  }),
]);

export function parseClientMessage(raw: unknown): ClientMessage | null {
  const result = clientMessageSchema.safeParse(raw);
  return result.success ? result.data : null;
}
