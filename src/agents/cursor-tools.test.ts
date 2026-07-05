import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  summarizeCursorToolResult,
  summarizeCursorToolStart,
} from "./cursor-tools.ts";

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(fixtureDir, "__fixtures__", "cursor-stream.ndjson");

function toolCallsFromFixture(): Array<{ started: Record<string, unknown>; completed: Record<string, unknown> }> {
  const lines = readFileSync(fixturePath, "utf8").trim().split("\n");
  const started = new Map<string, Record<string, unknown>>();
  const pairs: Array<{ started: Record<string, unknown>; completed: Record<string, unknown> }> = [];

  for (const line of lines) {
    const event = JSON.parse(line) as {
      type?: string;
      subtype?: string;
      call_id?: string;
      tool_call?: Record<string, unknown>;
    };
    if (event.type !== "tool_call" || !event.tool_call || !event.call_id) {
      continue;
    }
    if (event.subtype === "started") {
      started.set(event.call_id, event.tool_call);
    }
    if (event.subtype === "completed") {
      const s = started.get(event.call_id);
      if (s) {
        pairs.push({ started: s, completed: event.tool_call });
      }
    }
  }
  return pairs;
}

describe("summarizeCursorToolStart", () => {
  it("summarizes fixture tool kinds", () => {
    for (const { started } of toolCallsFromFixture()) {
      const summary = summarizeCursorToolStart(started);
      expect(summary.name).toBeTruthy();
      expect(summary.summary).toBeTruthy();
    }

    const editPair = toolCallsFromFixture().find((p) =>
      Object.keys(p.started).some((k) => k === "editToolCall"),
    );
    expect(editPair).toBeDefined();
    expect(summarizeCursorToolStart(editPair!.started)).toEqual({
      name: "edit",
      summary: "/tmp/shipper-fixture-capture/hello.ts",
    });

    const readPair = toolCallsFromFixture().find((p) =>
      Object.keys(p.started).some((k) => k === "readToolCall"),
    );
    expect(summarizeCursorToolStart(readPair!.started)).toEqual({
      name: "read",
      summary: "/tmp/shipper-fixture-capture/hello.ts",
    });

    const shellPair = toolCallsFromFixture().find((p) =>
      Object.keys(p.started).some((k) => k === "shellToolCall"),
    );
    expect(summarizeCursorToolStart(shellPair!.started).name).toBe("shell");
    expect(summarizeCursorToolStart(shellPair!.started).summary).toContain("ls -la");
  });

  it("falls back for unknown tool kinds", () => {
    const summary = summarizeCursorToolStart({
      mysteryToolCall: { args: { foo: "bar", baz: 1 } },
    });
    expect(summary.name).toBe("mystery");
    expect(summary.summary).toContain("foo");
  });
});

describe("summarizeCursorToolResult", () => {
  it("summarizes fixture completed tools", () => {
    for (const { completed } of toolCallsFromFixture()) {
      const result = summarizeCursorToolResult(completed);
      expect(typeof result.ok).toBe("boolean");
    }

    const readPair = toolCallsFromFixture().find((p) =>
      Object.keys(p.completed).some((k) => k === "readToolCall"),
    );
    expect(summarizeCursorToolResult(readPair!.completed)).toEqual({
      ok: true,
      resultSummary: "Read 4 lines",
    });

    const shellPair = toolCallsFromFixture().find((p) =>
      Object.keys(p.completed).some((k) => k === "shellToolCall"),
    );
    expect(summarizeCursorToolResult(shellPair!.completed)).toEqual({
      ok: true,
      resultSummary: "exit 0",
    });
  });

  it("reports error results", () => {
    expect(
      summarizeCursorToolResult({
        shellToolCall: {
          args: { command: "false" },
          result: { error: "command failed" },
        },
      }),
    ).toEqual({ ok: false, resultSummary: "command failed" });
  });

  it("handles missing result payload gracefully", () => {
    expect(
      summarizeCursorToolResult({
        readToolCall: { args: { path: "x.ts" } },
      }),
    ).toEqual({ ok: true });
  });
});
