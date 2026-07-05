import { summarizeToolInput } from "./utils.ts";

export function toolCallName(toolCall: Record<string, unknown>): string | null {
  for (const key of Object.keys(toolCall)) {
    if (key === "function") {
      const fn = toolCall.function;
      if (fn && typeof fn === "object" && "name" in fn && typeof fn.name === "string") {
        return fn.name;
      }
    }
    if (/toolcall$/i.test(key) || /question/i.test(key)) {
      return key.replace(/ToolCall$/i, "");
    }
  }
  return null;
}

export function toolCallArgs(toolCall: Record<string, unknown>): Record<string, unknown> {
  for (const key of Object.keys(toolCall)) {
    const value = toolCall[key];
    if (value && typeof value === "object" && "args" in value) {
      const args = (value as { args?: unknown }).args;
      if (args && typeof args === "object") {
        return args as Record<string, unknown>;
      }
    }
    if (key === "function") {
      const fn = toolCall.function;
      if (fn && typeof fn === "object" && "arguments" in fn) {
        const raw = (fn as { arguments?: unknown }).arguments;
        if (typeof raw === "string") {
          try {
            return JSON.parse(raw) as Record<string, unknown>;
          } catch {
            return { arguments: raw };
          }
        }
      }
    }
  }
  return {};
}

function toolCallPayload(toolCall: Record<string, unknown>): Record<string, unknown> | null {
  for (const key of Object.keys(toolCall)) {
    if (/toolcall$/i.test(key)) {
      const value = toolCall[key];
      if (value && typeof value === "object") {
        return value as Record<string, unknown>;
      }
    }
  }
  return null;
}

export function extractToolCallId(
  topLevelCallId: string | undefined,
  toolCall: Record<string, unknown>,
): string | undefined {
  if (topLevelCallId) {
    return topLevelCallId;
  }
  const payload = toolCallPayload(toolCall);
  if (payload && typeof payload.toolCallId === "string") {
    return payload.toolCallId;
  }
  return undefined;
}

function truncate(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function pathFromArgs(args: Record<string, unknown>): string | undefined {
  return (
    (typeof args.path === "string" && args.path) ||
    (typeof args.file_path === "string" && args.file_path) ||
    (typeof args.filePath === "string" && args.filePath) ||
    undefined
  );
}

export function summarizeCursorToolStart(toolCall: Record<string, unknown>): {
  name: string;
  summary: string;
} {
  const name = toolCallName(toolCall) ?? "tool";
  const args = toolCallArgs(toolCall);
  const path = pathFromArgs(args);

  switch (name.toLowerCase()) {
    case "read":
      return { name, summary: path ?? name };
    case "write":
    case "edit":
      return { name, summary: path ?? name };
    case "shell":
    case "terminal":
      if (typeof args.command === "string") {
        return { name: "shell", summary: truncate(args.command) };
      }
      break;
    case "grep":
      if (typeof args.pattern === "string") {
        const inPath = typeof args.path === "string" ? ` in ${args.path}` : "";
        return { name, summary: truncate(`${args.pattern}${inPath}`) };
      }
      break;
    case "glob":
      if (typeof args.glob_pattern === "string") {
        return { name, summary: truncate(args.glob_pattern) };
      }
      if (typeof args.pattern === "string") {
        return { name, summary: truncate(args.pattern) };
      }
      break;
    case "ls":
      return { name, summary: path ?? "." };
    case "delete":
      return { name, summary: path ?? name };
    case "mcp":
      if (typeof args.toolName === "string") {
        return { name, summary: args.toolName };
      }
      break;
    case "todo":
    case "todowrite":
      return { name, summary: "update todos" };
    default:
      break;
  }

  return { name, summary: summarizeToolInput(name, args) };
}

function errorText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return truncate(value, 120);
  }
  if (value && typeof value === "object") {
    if ("message" in value && typeof value.message === "string") {
      return truncate(value.message, 120);
    }
    if ("error" in value && typeof value.error === "string") {
      return truncate(value.error, 120);
    }
  }
  return undefined;
}

function resultPayload(toolCall: Record<string, unknown>): Record<string, unknown> | null {
  const payload = toolCallPayload(toolCall);
  if (!payload || !payload.result || typeof payload.result !== "object") {
    return null;
  }
  return payload.result as Record<string, unknown>;
}

export function summarizeCursorToolResult(toolCall: Record<string, unknown>): {
  ok: boolean;
  resultSummary?: string;
} {
  const name = (toolCallName(toolCall) ?? "tool").toLowerCase();
  const result = resultPayload(toolCall);

  if (!result) {
    return { ok: true };
  }

  if ("error" in result) {
    return { ok: false, resultSummary: errorText(result.error) ?? "failed" };
  }
  if ("failure" in result) {
    return { ok: false, resultSummary: errorText(result.failure) ?? "failed" };
  }

  const success = result.success;
  if (!success || typeof success !== "object") {
    return { ok: true };
  }

  const s = success as Record<string, unknown>;

  switch (name) {
    case "read": {
      const lines = s.totalLines;
      if (typeof lines === "number") {
        return { ok: true, resultSummary: `Read ${lines} lines` };
      }
      break;
    }
    case "write": {
      const lines = s.linesCreated ?? s.linesAdded;
      const size = s.fileSize;
      if (typeof lines === "number" && typeof size === "number") {
        return { ok: true, resultSummary: `Wrote ${lines} lines (${size} bytes)` };
      }
      if (typeof lines === "number") {
        return { ok: true, resultSummary: `Wrote ${lines} lines` };
      }
      break;
    }
    case "edit": {
      const added = s.linesAdded;
      const removed = s.linesRemoved;
      if (typeof added === "number" || typeof removed === "number") {
        const a = typeof added === "number" ? added : 0;
        const r = typeof removed === "number" ? removed : 0;
        return { ok: true, resultSummary: `+${a}/-${r} lines` };
      }
      if (typeof s.message === "string") {
        return { ok: true, resultSummary: truncate(s.message, 60) };
      }
      break;
    }
    case "shell":
    case "terminal": {
      const exitCode = s.exitCode;
      if (typeof exitCode === "number") {
        return exitCode === 0
          ? { ok: true, resultSummary: "exit 0" }
          : { ok: false, resultSummary: `exit ${exitCode}` };
      }
      break;
    }
    case "grep": {
      const count = s.totalMatches ?? s.matchCount ?? s.numMatches;
      if (typeof count === "number") {
        return { ok: true, resultSummary: `${count} matches` };
      }
      break;
    }
    case "glob": {
      const count = s.totalFiles ?? s.fileCount ?? (Array.isArray(s.files) ? s.files.length : undefined);
      if (typeof count === "number") {
        return { ok: true, resultSummary: `${count} files` };
      }
      break;
    }
    case "ls": {
      const count = s.entryCount ?? (Array.isArray(s.entries) ? s.entries.length : undefined);
      if (typeof count === "number") {
        return { ok: true, resultSummary: `${count} entries` };
      }
      break;
    }
    case "delete":
      return { ok: true, resultSummary: "deleted" };
    default:
      break;
  }

  return { ok: true };
}
