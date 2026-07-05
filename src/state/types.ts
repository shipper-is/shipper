import type { AgentEvent, AgentKind, AgentQuestion, DetectedAgent } from "../agents/types.ts";
import type { UpdateNotice } from "../core/update-check.ts";
import type { PlanFile } from "../core/plan-store.ts";

export type Screen = "home" | "new-plan" | "build" | "settings" | "demo" | "no-agents";

export type ActiveRun = {
  kind: "plan" | "build" | "demo";
  planFilename?: string;
};

export type AppContextValue = {
  repoPath: string;
  screen: Screen;
  setScreen: (screen: Screen) => void;
  detectedAgents: DetectedAgent[];
  selectedAgent: AgentKind | null;
  setSelectedAgent: (agent: AgentKind) => Promise<void>;
  selectedPlan: PlanFile | null;
  setSelectedPlan: (plan: PlanFile | null) => void;
  feedEvents: AgentEvent[];
  appendFeedEvents: (...events: AgentEvent[]) => void;
  clearFeedEvents: () => void;
  pendingQuestion: AgentQuestion | null;
  setPendingQuestion: (question: AgentQuestion | null) => void;
  waitingForAnswer: boolean;
  setWaitingForAnswer: (waiting: boolean) => void;
  activeRun: ActiveRun | null;
  setActiveRun: (run: ActiveRun | null) => void;
  highlightPlanFilename: string | null;
  setHighlightPlanFilename: (filename: string | null) => void;
  updateNotice: UpdateNotice | null;
  rescanAgents: () => Promise<void>;
  demoMode: boolean;
  quit: () => void;
};
