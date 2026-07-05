import { z } from "zod";
import { createQuestionId } from "./event-bus.ts";
import {
  extractToolCallId,
  summarizeCursorToolResult,
  summarizeCursorToolStart,
  toolCallArgs,
  toolCallName,
} from "./cursor-tools.ts";
import { extractQuestionBlocks } from "./question-protocol.ts";
import type { AgentEvent, AgentQuestion, AgentQuestionItem } from "./types.ts";

export const cursorEventSchema = z
  .object({
    type: z.string(),
    subtype: z.string().optional(),
    session_id: z.string().optional(),
    call_id: z.string().optional(),
    timestamp_ms: z.number().optional(),
    model_call_id: z.string().optional(),
    message: z
      .object({
        role: z.string().optional(),
        content: z
          .array(
            z
              .object({
                type: z.string().optional(),
                text: z.string().optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough()
      .optional(),
    tool_call: z.record(z.string(), z.unknown()).optional(),
    result: z.string().optional(),
  })
  .passthrough();

export type CursorEvent = z.infer<typeof cursorEventSchema>;

export function assistantText(event: CursorEvent): string {
  const chunks =
    event.message?.content
      ?.filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text!) ?? [];
  return chunks.join("");
}

function askQuestionItemsFromArgs(args: Record<string, unknown>): AgentQuestionItem[] | null {
  const rawQuestions = args.questions;
  if (!Array.isArray(rawQuestions)) {
    return null;
  }

  const items: AgentQuestionItem[] = [];
  for (const raw of rawQuestions) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const question =
      ("question" in raw && typeof raw.question === "string" && raw.question) ||
      ("prompt" in raw && typeof raw.prompt === "string" && raw.prompt);
    if (!question) {
      continue;
    }
    const optionsRaw = "options" in raw && Array.isArray(raw.options) ? raw.options : [];
    const options = optionsRaw
      .filter(
        (o: unknown): o is { label: string; description?: string } =>
          !!o &&
          typeof o === "object" &&
          "label" in o &&
          typeof (o as { label: unknown }).label === "string",
      )
      .map((o: { label: string; description?: string }) => ({
        label: o.label,
        description: o.description,
      }));
    if (options.length < 2) {
      continue;
    }
    items.push({
      prompt: question,
      header: "header" in raw && typeof raw.header === "string" ? raw.header : undefined,
      multiSelect:
        "multiSelect" in raw
          ? Boolean(raw.multiSelect)
          : "allow_multiple" in raw
            ? Boolean(raw.allow_multiple)
            : false,
      options: options.slice(0, 4),
    });
  }

  return items.length > 0 ? items : null;
}

// Discriminators verified against captured stream-json (see __fixtures__/cursor-stream.ndjson):
// - streaming delta: timestamp_ms present, model_call_id absent
// - buffered flush: model_call_id present (also has timestamp_ms)
// - legacy/non-partial: neither field present
function isStreamingDelta(event: CursorEvent): boolean {
  return event.timestamp_ms != null && event.model_call_id == null;
}

function isBufferedFlush(event: CursorEvent): boolean {
  return event.model_call_id != null;
}

export class CursorStreamParser {
  sessionId: string | null = null;
  pendingQuestion: AgentQuestion | null = null;
  finalResult: string | undefined;
  sawResult = false;

  private assistantBuffer = "";
  private defensiveQuestion: AgentQuestionItem[] | null = null;
  private startedTools = new Map<string, { name: string; summary: string }>();
  private fallbackToolCounter = 0;
  /** True after a streaming delta until the next model_call_id buffered flush. */
  private sawStreamingDelta = false;

  handleLine(line: string): AgentEvent[] {
    const trimmed = line.trim();
    if (!trimmed) {
      return [];
    }

    let event: CursorEvent;
    try {
      const parsed = JSON.parse(trimmed);
      const validated = cursorEventSchema.safeParse(parsed);
      event = validated.success ? validated.data : ({ type: "unknown" } as CursorEvent);
    } catch {
      return [{ type: "text", text: trimmed }];
    }

    const events: AgentEvent[] = [];

    if (event.type === "system" && event.subtype === "init" && event.session_id) {
      this.sessionId = event.session_id;
    }

    if (event.type === "assistant") {
      events.push(...this.handleAssistant(event));
    }

    if (event.type === "tool_call" && event.subtype === "started" && event.tool_call) {
      events.push(...this.handleToolStarted(event));
    }

    if (event.type === "tool_call" && event.subtype === "completed" && event.tool_call) {
      events.push(...this.handleToolCompleted(event));
    }

    if (event.type === "result") {
      this.handleResult(event);
    }

    return events;
  }

  private handleAssistant(event: CursorEvent): AgentEvent[] {
    const text = assistantText(event);
    if (!text) {
      return [];
    }

    if (isBufferedFlush(event)) {
      this.sawStreamingDelta = false;
      this.assistantBuffer += text;
      const protocolItems = extractQuestionBlocks(text);
      if (protocolItems) {
        this.pendingQuestion = { id: createQuestionId(), questions: protocolItems };
      }
      return [];
    }

    if (isStreamingDelta(event)) {
      this.sawStreamingDelta = true;
      return [{ type: "text", text, delta: true }];
    }

    // Legacy CLI or post-delta summary flush without model_call_id: buffer only if
    // deltas already displayed this content; otherwise emit standalone text.
    if (this.sawStreamingDelta) {
      this.assistantBuffer += text;
      const protocolItems = extractQuestionBlocks(text);
      if (protocolItems) {
        this.pendingQuestion = { id: createQuestionId(), questions: protocolItems };
      }
      return [];
    }

    this.assistantBuffer += text;
    const protocolItems = extractQuestionBlocks(text);
    if (protocolItems) {
      this.pendingQuestion = { id: createQuestionId(), questions: protocolItems };
    }
    return [{ type: "text", text }];
  }

  private handleToolStarted(event: CursorEvent): AgentEvent[] {
    const toolCall = event.tool_call!;
    const { name, summary } = summarizeCursorToolStart(toolCall);
    const callId =
      extractToolCallId(event.call_id, toolCall) ?? `cursor-${++this.fallbackToolCounter}`;

    this.startedTools.set(callId, { name, summary });
    const events: AgentEvent[] = [{ type: "tool-start", callId, name, summary }];

    if (/askquestion/i.test(name)) {
      const items = askQuestionItemsFromArgs(toolCallArgs(toolCall));
      if (items) {
        this.defensiveQuestion = items;
      }
    }

    return events;
  }

  private handleToolCompleted(event: CursorEvent): AgentEvent[] {
    const toolCall = event.tool_call!;
    const callId =
      extractToolCallId(event.call_id, toolCall) ?? `cursor-${++this.fallbackToolCounter}`;
    const started = this.startedTools.get(callId);
    const name = started?.name ?? toolCallName(toolCall) ?? "tool";
    const summary = started?.summary ?? summarizeCursorToolStart(toolCall).summary;
    const { ok, resultSummary } = summarizeCursorToolResult(toolCall);

    this.startedTools.delete(callId);

    if (/askquestion/i.test(name) && this.defensiveQuestion && !this.pendingQuestion) {
      this.pendingQuestion = { id: createQuestionId(), questions: this.defensiveQuestion };
      this.defensiveQuestion = null;
    }

    return [{ type: "tool-end", callId, name, summary, ok, resultSummary }];
  }

  private handleResult(event: CursorEvent): void {
    this.sawResult = true;
    this.finalResult = event.result;
    const protocolItems = extractQuestionBlocks(event.result ?? this.assistantBuffer);
    if (protocolItems) {
      this.pendingQuestion = { id: createQuestionId(), questions: protocolItems };
    }
  }
}
