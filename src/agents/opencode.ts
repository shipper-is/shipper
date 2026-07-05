import { createOpencodeClient, createOpencodeServer } from "@opencode-ai/sdk";
import type { Event, Part, ToolPart } from "@opencode-ai/sdk";
import { AgentEventBus, QuestionGate, createQuestionId } from "./event-bus.ts";
import { extractQuestionBlocks, formatAnswers } from "./question-protocol.ts";
import type {
  AgentAdapter,
  AgentEvent,
  AgentQuestion,
  AgentStartOptions,
} from "./types.ts";
import { getFreePort, summarizeToolInput } from "./utils.ts";

const DEFAULT_INACTIVITY_MS = 10 * 60 * 1000;

function parseOpencodeModel(model: string): { providerID: string; modelID: string } {
  const idx = model.indexOf("/");
  if (idx === -1) {
    throw new Error(`Invalid opencode model id "${model}" — expected "providerID/modelID"`);
  }
  return { providerID: model.slice(0, idx), modelID: model.slice(idx + 1) };
}

function opencodeErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: { message?: string } }).data;
    if (data?.message) {
      return data.message;
    }
  }
  return fallback;
}

function textFromParts(parts: Part[]): string {
  return parts
    .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function summarizeToolPart(part: ToolPart): { name: string; summary: string } {
  const input =
    part.state.status === "pending" || part.state.status === "running"
      ? part.state.input
      : part.state.input;
  return {
    name: part.tool,
    summary: summarizeToolInput(part.tool, input),
  };
}

export class OpencodeAdapter implements AgentAdapter {
  private bus = new AgentEventBus();
  private gate = new QuestionGate();
  private stopped = false;
  private running = false;
  private serverClose: (() => void) | null = null;
  private sessionId: string | null = null;
  private inactivityMs = DEFAULT_INACTIVITY_MS;
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  private eventAbort: AbortController | null = null;

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
    this.stopped = true;
    this.clearInactivityTimer();
    this.gate.cancelAll();
    this.eventAbort?.abort();
    if (this.sessionId) {
      try {
        // session abort handled in run finally
      } catch {
        // ignore
      }
    }
    this.serverClose?.();
    this.serverClose = null;
    this.bus.close();
  }

  private clearInactivityTimer(): void {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
  }

  private resetInactivityTimer(onTimeout: () => void): void {
    this.clearInactivityTimer();
    if (this.stopped) {
      return;
    }
    this.inactivityTimer = setTimeout(onTimeout, this.inactivityMs);
  }

  private handleEvent(
    event: Event,
    assistantTextByMessage: Map<string, string>,
    seenToolCalls: Set<string>,
  ): void {
    this.resetInactivityTimer(() => undefined);

    if (event.type === "message.part.updated") {
      const { part, delta } = event.properties;
      if (part.type === "text") {
        const chunk = delta ?? part.text;
        if (chunk) {
          this.bus.push({
            type: "text",
            text: chunk,
            ...(delta !== undefined ? { delta: true } : {}),
          });
          const existing = assistantTextByMessage.get(part.messageID) ?? "";
          assistantTextByMessage.set(
            part.messageID,
            delta ? existing + delta : part.text,
          );
        }
      }
      if (part.type === "tool") {
        const { name, summary } = summarizeToolPart(part);
        const callId = part.callID;

        if (
          (part.state.status === "pending" || part.state.status === "running") &&
          !seenToolCalls.has(callId)
        ) {
          seenToolCalls.add(callId);
          this.bus.push({ type: "tool-start", callId, name, summary });
        }

        if (part.state.status === "completed") {
          const output = part.state.output;
          this.bus.push({
            type: "tool-end",
            callId,
            name,
            summary,
            ok: true,
            resultSummary: output ? output.slice(0, 200) : undefined,
          });
        } else if (part.state.status === "error") {
          this.bus.push({
            type: "tool-end",
            callId,
            name,
            summary,
            ok: false,
            resultSummary: part.state.error,
          });
        }
      }
    }

    if (event.type === "session.error") {
      const props = event.properties as { error?: { message?: string } };
      const message = props.error?.message ?? "opencode session error";
      this.bus.push({ type: "error", message });
    }
  }

  private async run(opts: AgentStartOptions): Promise<void> {
    if (this.running) {
      this.bus.push({ type: "error", message: "Adapter already running" });
      this.bus.close();
      return;
    }
    this.running = true;

    let client: ReturnType<typeof createOpencodeClient> | null = null;

    const onInactivity = () => {
      if (this.stopped) {
        return;
      }
      this.bus.push({
        type: "error",
        message:
          "opencode session stalled — possible hang from the built-in question tool. Use the Shipper question protocol instead.",
      });
      void this.stop();
    };

    try {
      const port = await getFreePort();
      const server = await createOpencodeServer({
        hostname: "127.0.0.1",
        port,
        timeout: 30_000,
      });
      client = createOpencodeClient({
        baseUrl: server.url,
        directory: opts.cwd,
      });
      this.serverClose = () => server.close();

      const session = await client.session.create({
        query: { directory: opts.cwd },
      });
      if (session.error || !session.data) {
        throw new Error(
          opencodeErrorMessage(session.error, "Failed to create opencode session"),
        );
      }
      this.sessionId = session.data.id;

      const assistantTextByMessage = new Map<string, string>();
      const seenToolCalls = new Set<string>();
      this.eventAbort = new AbortController();

      const eventsPromise = (async () => {
        const stream = await client!.event.subscribe({
          query: { directory: opts.cwd },
          signal: this.eventAbort!.signal,
        });
        for await (const event of stream.stream) {
          if (this.stopped) {
            break;
          }
          void opts.rawLogger?.logRaw("in", JSON.stringify(event));
          this.resetInactivityTimer(onInactivity);
          this.handleEvent(event, assistantTextByMessage, seenToolCalls);
        }
      })().catch(() => undefined);

      let prompt = opts.prompt;

      while (!this.stopped) {
        this.resetInactivityTimer(onInactivity);

        void opts.rawLogger?.logRaw("out", prompt);

        const response = await client.session.prompt({
          path: { id: this.sessionId },
          query: { directory: opts.cwd },
          body: {
            parts: [{ type: "text", text: prompt }],
            ...(opts.model ? { model: parseOpencodeModel(opts.model) } : {}),
          },
        });

        this.resetInactivityTimer(onInactivity);

        if (response.error) {
          throw new Error(opencodeErrorMessage(response.error, "opencode prompt failed"));
        }

        const responseText = response.data ? textFromParts(response.data.parts) : "";
        const accumulated = [...assistantTextByMessage.values()].join("\n");
        const fullText = responseText || accumulated;
        const protocolItems = extractQuestionBlocks(fullText);

        this.bus.push({ type: "turn-complete" });

        if (protocolItems) {
          const question: AgentQuestion = {
            id: createQuestionId(),
            questions: protocolItems,
          };
          this.bus.push({ type: "question", question });
          const answers = await this.gate.wait(question.id);
          if (this.stopped) {
            break;
          }
          prompt = formatAnswers(question, answers);
          assistantTextByMessage.clear();
          seenToolCalls.clear();
          continue;
        }

        this.bus.push({ type: "done", result: fullText || undefined });
        break;
      }

      await eventsPromise;
    } catch (error) {
      if (!this.stopped) {
        const message = error instanceof Error ? error.message : String(error);
        this.bus.push({ type: "error", message });
      }
    } finally {
      this.clearInactivityTimer();
      this.eventAbort?.abort();
      if (client && this.sessionId) {
        try {
          await client.session.abort({
            path: { id: this.sessionId },
            query: { directory: opts.cwd },
          });
        } catch {
          // ignore cleanup errors
        }
      }
      this.serverClose?.();
      this.serverClose = null;
      this.running = false;
      this.bus.close();
    }
  }
}
