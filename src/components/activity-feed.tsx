import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { AgentEvent } from "../agents/types.ts";

const MAX_EVENTS = 500;

type FeedLine =
  | { kind: "text"; text: string }
  | {
      kind: "tool";
      callId: string;
      name: string;
      summary: string;
      ok?: boolean;
      resultSummary?: string;
    }
  | { kind: "error"; message: string }
  | { kind: "turn"; label: string }
  | { kind: "done"; result?: string };

function eventsToLines(events: AgentEvent[]): FeedLine[] {
  const out: FeedLine[] = [];
  const toolIndexByCallId = new Map<string, number>();

  for (const event of events) {
    switch (event.type) {
      case "text": {
        if (!event.text) {
          break;
        }
        for (const line of event.text.split("\n")) {
          out.push({ kind: "text", text: line });
        }
        break;
      }
      case "tool-start": {
        const index = out.length;
        toolIndexByCallId.set(event.callId, index);
        out.push({
          kind: "tool",
          callId: event.callId,
          name: event.name,
          summary: event.summary,
        });
        break;
      }
      case "tool-end": {
        const index = toolIndexByCallId.get(event.callId);
        const completed: FeedLine = {
          kind: "tool",
          callId: event.callId,
          name: event.name,
          summary: event.summary,
          ok: event.ok,
          resultSummary: event.resultSummary,
        };
        if (index !== undefined) {
          out[index] = completed;
          toolIndexByCallId.delete(event.callId);
        } else {
          out.push(completed);
        }
        break;
      }
      case "error":
        out.push({ kind: "error", message: event.message });
        break;
      case "turn-complete":
        out.push({ kind: "turn", label: "— turn complete —" });
        break;
      case "done":
        out.push({ kind: "done", result: event.result });
        break;
      case "question":
        break;
      default:
        break;
    }
  }

  return out;
}

type ActivityFeedProps = {
  events: AgentEvent[];
  paused?: boolean;
  maxVisibleLines?: number;
};

export function ActivityFeed({
  events,
  paused = false,
  maxVisibleLines = 20,
}: ActivityFeedProps) {
  const visible = useMemo(() => {
    const bounded = events.slice(-MAX_EVENTS);
    const lines = eventsToLines(bounded);
    return lines.slice(-maxVisibleLines);
  }, [events, maxVisibleLines]);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {paused && (
        <Text dimColor italic>
          Activity paused — waiting for your answer
        </Text>
      )}
      {visible.length === 0 ? (
        <Text dimColor>No activity yet.</Text>
      ) : (
        visible.map((line, index) => {
          const key = `${line.kind}-${index}`;
          switch (line.kind) {
            case "text":
              return (
                <Text key={key} dimColor wrap="wrap">
                  {line.text}
                </Text>
              );
            case "tool": {
              const completed = line.ok !== undefined;
              if (completed) {
                return (
                  <Text key={key} color={line.ok ? "green" : "red"}>
                    {line.ok ? "✓ " : "✕ "}
                    <Text bold>{line.name}</Text>
                    <Text dimColor> {line.summary}</Text>
                    {line.resultSummary ? (
                      <Text dimColor> ({line.resultSummary})</Text>
                    ) : null}
                  </Text>
                );
              }
              return (
                <Text key={key}>
                  <Text color="blue">⚙ </Text>
                  <Text bold>{line.name}</Text>
                  <Text dimColor> {line.summary}</Text>
                </Text>
              );
            }
            case "error":
              return (
                <Text key={key} color="red" wrap="wrap">
                  ✕ {line.message}
                </Text>
              );
            case "turn":
              return (
                <Text key={key} dimColor>
                  {line.label}
                </Text>
              );
            case "done":
              return (
                <Text key={key} color="green">
                  ✓ Done{line.result ? `: ${line.result}` : ""}
                </Text>
              );
            default:
              return null;
          }
        })
      )}
    </Box>
  );
}

export { MAX_EVENTS as ACTIVITY_FEED_MAX_EVENTS };
