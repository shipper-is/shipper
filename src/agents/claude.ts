import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AskUserQuestionInput } from "@anthropic-ai/claude-agent-sdk/sdk-tools";
import { AgentEventBus, QuestionGate, createQuestionId } from "./event-bus.ts";
import type {
  AgentAdapter,
  AgentEvent,
  AgentQuestionItem,
  AgentStartOptions,
} from "./types.ts";
import { extractAssistantText, summarizeToolInput } from "./utils.ts";

function toAgentQuestion(input: AskUserQuestionInput): AgentQuestionItem[] {
  return input.questions.map((q) => ({
    prompt: q.question,
    header: q.header,
    multiSelect: "multiSelect" in q ? Boolean(q.multiSelect) : false,
    options: q.options.map((o) => ({
      label: o.label,
      description: o.description,
    })),
  }));
}

function formatClaudeAnswers(
  questions: AgentQuestionItem[],
  answers: Record<string, string | string[]>,
): Record<string, string> {
  const formatted: Record<string, string> = {};
  for (const q of questions) {
    const raw = answers[q.prompt];
    if (raw === undefined) {
      continue;
    }
    formatted[q.prompt] = Array.isArray(raw) ? raw.join(", ") : raw;
  }
  return formatted;
}

export class ClaudeAdapter implements AgentAdapter {
  private bus = new AgentEventBus();
  private gate = new QuestionGate();
  private activeQuery: Awaited<ReturnType<typeof query>> | null = null;
  private abort = new AbortController();
  private running = false;
  private toolCallCounter = 0;

  get sessionId(): string | null {
    return null;
  }

  start(opts: AgentStartOptions): AsyncIterable<AgentEvent> {
    void this.run(opts);
    return this.iterate();
  }

  private async *iterate(): AsyncGenerator<AgentEvent, void> {
    yield* this.bus.iterate();
  }

  answer(questionId: string, answers: Record<string, string | string[]>): void {
    this.gate.answer(questionId, answers);
  }

  async stop(): Promise<void> {
    this.abort.abort();
    this.gate.cancelAll();
    this.activeQuery?.close();
    this.activeQuery = null;
    this.bus.close();
  }

  private async run(opts: AgentStartOptions): Promise<void> {
    if (this.running) {
      this.bus.push({ type: "error", message: "Adapter already running" });
      this.bus.close();
      return;
    }
    this.running = true;
    this.toolCallCounter = 0;

    try {
      const pendingQuestions = new Map<string, AgentQuestionItem[]>();

      const q = query({
        prompt: opts.prompt,
        options: {
          cwd: opts.cwd,
          abortController: this.abort,
          permissionMode: "acceptEdits",
          ...(opts.model ? { model: opts.model } : {}),
          canUseTool: async (toolName, input) => {
            if (toolName === "AskUserQuestion") {
              const questionInput = input as unknown as AskUserQuestionInput;
              const items = toAgentQuestion(questionInput);
              const id = createQuestionId();
              pendingQuestions.set(id, items);
              this.bus.push({
                type: "question",
                question: { id, questions: items },
              });
              const answers = await this.gate.wait(id);
              pendingQuestions.delete(id);
              return {
                behavior: "allow" as const,
                updatedInput: {
                  ...input,
                  answers: formatClaudeAnswers(items, answers),
                },
              };
            }
            return { behavior: "allow" as const };
          },
        },
      });
      this.activeQuery = q;

      for await (const message of q) {
        void opts.rawLogger?.logRaw("in", JSON.stringify(message));
        this.handleMessage(message);
      }
    } catch (error) {
      if (!this.abort.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error);
        this.bus.push({ type: "error", message });
      }
    } finally {
      this.running = false;
      this.bus.close();
    }
  }

  private handleMessage(message: SDKMessage): void {
    if (message.type === "assistant") {
      const text = extractAssistantText(message.message.content);
      if (text) {
        this.bus.push({ type: "text", text });
      }

      for (const block of message.message.content) {
        if (
          block &&
          typeof block === "object" &&
          "type" in block &&
          block.type === "tool_use" &&
          "name" in block &&
          typeof block.name === "string"
        ) {
          const input =
            "input" in block && block.input && typeof block.input === "object"
              ? (block.input as Record<string, unknown>)
              : {};
          const callId =
            "id" in block && typeof block.id === "string"
              ? block.id
              : `claude-${++this.toolCallCounter}`;
          this.bus.push({
            type: "tool-start",
            callId,
            name: block.name,
            summary: summarizeToolInput(block.name, input),
          });
        }
      }
      return;
    }

    if (message.type === "result") {
      if (message.subtype === "success") {
        this.bus.push({ type: "done", result: message.result });
      } else {
        this.bus.push({
          type: "error",
          message: message.errors?.join("; ") || "Claude agent run failed",
        });
      }
      return;
    }

    if (message.type === "system" && message.subtype === "turn_complete") {
      this.bus.push({ type: "turn-complete" });
    }
  }
}
