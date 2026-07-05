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

export type PlanSummary = {
  filename: string;
  folder: "open" | "done";
  title: string;
  progress: PlanProgressDto;
  phases: PlanPhaseDto[];
  rawMarkdown: string;
};

export type PlansSnapshot = {
  open: PlanSummary[];
  done: PlanSummary[];
};

export type RunStatus = "idle" | "running" | "waiting-answer" | "stopping";

export type SkillIndicator = "plan" | "build" | "ship" | null;

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
  configInfo: ConfigInfo;
  terminalState: TerminalState;
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
  | ServerConfigInfo;

export type ClientStartBuild = {
  type: "start-build";
  planFilename: string;
};

export type ClientStartPlan = {
  type: "start-plan";
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
  skill: "shipper-plan" | "shipper-build";
  modelId: string;
};

export type ClientSetAgent = {
  type: "set-agent";
  agent: "claude" | "cursor" | "opencode";
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

export type ClientMessage =
  | ClientStartBuild
  | ClientStartPlan
  | ClientStopRun
  | ClientAnswerQuestion
  | ClientSendMessage
  | ClientSelectModel
  | ClientSetAgent
  | ClientTerminalInput
  | ClientTerminalResize
  | ClientTerminalOpen;

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
    skill: z.enum(["shipper-plan", "shipper-build"]),
    modelId: z.string().min(1),
  }),
  z.object({
    type: z.literal("set-agent"),
    agent: z.enum(["claude", "cursor", "opencode"]),
  }),
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
]);

export function parseClientMessage(raw: unknown): ClientMessage | null {
  const result = clientMessageSchema.safeParse(raw);
  return result.success ? result.data : null;
}
