export type AgentKind = "claude" | "cursor" | "opencode";

export type AgentQuestionOption = {
  label: string;
  description?: string;
};

export type AgentQuestionItem = {
  prompt: string;
  header?: string;
  multiSelect?: boolean;
  options: AgentQuestionOption[];
};

export type AgentQuestion = {
  id: string;
  questions: AgentQuestionItem[];
};

export type AgentEvent =
  | { type: "text"; text: string; delta?: boolean }
  | { type: "tool-start"; callId: string; name: string; summary: string }
  | {
      type: "tool-end";
      callId: string;
      name: string;
      summary: string;
      ok: boolean;
      resultSummary?: string;
    }
  | { type: "question"; question: AgentQuestion }
  | { type: "turn-complete" }
  | { type: "error"; message: string }
  | { type: "done"; result?: string };

export type AgentRawLogger = {
  logRaw(direction: "in" | "out", payload: string): void | Promise<void>;
};

export type AgentStartOptions = {
  cwd: string;
  prompt: string;
  model?: string;
  rawLogger?: AgentRawLogger;
};

export interface AgentAdapter {
  start(opts: AgentStartOptions): AsyncIterable<AgentEvent>;
  answer(questionId: string, answers: Record<string, string | string[]>): void;
  stop(): Promise<void>;
}

export type DetectedAgent = {
  kind: AgentKind;
  binary: string;
  version: string;
};
