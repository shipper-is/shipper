import type { AgentEvent } from "../agents/types.ts";

const FEED_TAIL_LINES = 20;

function formatToolLine(
  name: string,
  summary: string,
  ok?: boolean,
  resultSummary?: string,
): string {
  if (ok === undefined) {
    return `[tool] ${name}: ${summary}`;
  }
  const marker = ok ? "✓" : "✕";
  const result = resultSummary ? ` (${resultSummary})` : "";
  return `[tool] ${marker} ${name}: ${summary}${result}`;
}

export function formatFeedTail(events: AgentEvent[]): string[] {
  const lines: string[] = [];
  const toolIndexByCallId = new Map<string, number>();

  for (const event of events) {
    if (event.type === "text") {
      for (const line of event.text.split("\n")) {
        if (line.trim()) {
          lines.push(line);
        }
      }
    } else if (event.type === "tool-start") {
      toolIndexByCallId.set(event.callId, lines.length);
      lines.push(formatToolLine(event.name, event.summary));
    } else if (event.type === "tool-end") {
      const formatted = formatToolLine(
        event.name,
        event.summary,
        event.ok,
        event.resultSummary,
      );
      const index = toolIndexByCallId.get(event.callId);
      if (index !== undefined) {
        lines[index] = formatted;
        toolIndexByCallId.delete(event.callId);
      } else {
        lines.push(formatted);
      }
    } else if (event.type === "error") {
      lines.push(`[error] ${event.message}`);
    } else if (event.type === "done" && event.result) {
      lines.push(event.result);
    }
  }
  return lines.slice(-FEED_TAIL_LINES);
}
