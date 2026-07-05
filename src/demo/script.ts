import type { AgentEvent, AgentQuestion } from "../agents/types.ts";

export const DEMO_QUESTION: AgentQuestion = {
  id: "demo-q1",
  questions: [
    {
      prompt: "Which filename should the demo script use?",
      header: "Filename",
      options: [
        { label: "hello.ts", description: "TypeScript entry" },
        { label: "hello.js", description: "JavaScript entry" },
        { label: "index.ts", description: "Default index" },
      ],
    },
    {
      prompt: "Include a README?",
      header: "Docs",
      multiSelect: true,
      options: [
        { label: "README.md" },
        { label: "CHANGELOG.md" },
      ],
    },
  ],
};

export type DemoScriptStep =
  | { delayMs: number; event: AgentEvent }
  | { delayMs: number; question: AgentQuestion };

export const DEMO_SCRIPT: DemoScriptStep[] = [
  { delayMs: 400, event: { type: "text", text: "Starting demo agent run…" } },
  {
    delayMs: 600,
    event: {
      type: "tool-start",
      callId: "demo-read-1",
      name: "Read",
      summary: "package.json",
    },
  },
  {
    delayMs: 400,
    event: {
      type: "tool-end",
      callId: "demo-read-1",
      name: "Read",
      summary: "package.json",
      ok: true,
      resultSummary: "Read 42 lines",
    },
  },
  {
    delayMs: 500,
    event: {
      type: "text",
      text: "I'll scaffold a small hello-world script. First I need a couple of choices from you.",
    },
  },
  { delayMs: 300, question: DEMO_QUESTION },
  {
    delayMs: 800,
    event: {
      type: "text",
      text: "Thanks — creating files with your selections.",
    },
  },
  {
    delayMs: 400,
    event: {
      type: "tool-start",
      callId: "demo-write-1",
      name: "Write",
      summary: "src/hello.ts",
    },
  },
  {
    delayMs: 300,
    event: {
      type: "tool-end",
      callId: "demo-write-1",
      name: "Write",
      summary: "src/hello.ts",
      ok: true,
      resultSummary: "Wrote 12 lines (384 bytes)",
    },
  },
  { delayMs: 300, event: { type: "turn-complete" } },
  { delayMs: 200, event: { type: "done", result: "Demo complete" } },
];

export async function runDemoScript(
  script: DemoScriptStep[],
  handlers: {
    onEvent: (event: AgentEvent) => void;
    onQuestion: (question: AgentQuestion) => Promise<void>;
    signal: AbortSignal;
  },
): Promise<void> {
  for (const step of script) {
    if (handlers.signal.aborted) {
      return;
    }
    await sleep(step.delayMs, handlers.signal);
    if (handlers.signal.aborted) {
      return;
    }
    if ("question" in step) {
      await handlers.onQuestion(step.question);
    } else {
      handlers.onEvent(step.event);
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}
