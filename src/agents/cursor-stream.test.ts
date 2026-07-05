import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CursorStreamParser } from "./cursor-stream.ts";
import { extractQuestionBlocks } from "./question-protocol.ts";

// Regenerate: cursor-agent -p --force --output-format stream-json --stream-partial-output \
//   --workspace /tmp/scratch "Create hello.ts, read it back, run ls" > src/agents/__fixtures__/cursor-stream.ndjson
// Or copy payload lines from ~/.config/shipper/logs/*-cursor.ndjson (type:"raw", direction:"in").

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(fixtureDir, "__fixtures__", "cursor-stream.ndjson");

function loadFixtureLines(): string[] {
  return readFileSync(fixturePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

describe("CursorStreamParser", () => {
  it("parses the captured fixture with deltas, tools, and result", () => {
    const parser = new CursorStreamParser();
    const allEvents = loadFixtureLines().flatMap((line) => parser.handleLine(line));

    const textEvents = allEvents.filter((e) => e.type === "text");
    const deltaTexts = textEvents.filter((e) => e.delta === true).map((e) => e.text);
    const nonDeltaTexts = textEvents.filter((e) => !e.delta).map((e) => e.text);

    expect(parser.sessionId).toBeTruthy();
    expect(parser.sawResult).toBe(true);
    expect(parser.finalResult).toContain("hello.ts");

    expect(deltaTexts.length).toBeGreaterThan(5);
    expect(nonDeltaTexts).toHaveLength(0);

    const combinedDelta = deltaTexts.join("");
    expect(combinedDelta).toContain("Creating");
    expect(combinedDelta).toContain("hello.ts");

    const toolStarts = allEvents.filter((e) => e.type === "tool-start");
    const toolEnds = allEvents.filter((e) => e.type === "tool-end");
    expect(toolStarts.length).toBeGreaterThanOrEqual(3);
    expect(toolEnds).toHaveLength(toolStarts.length);

    const editEnd = toolEnds.find((e) => e.name === "edit");
    expect(editEnd?.ok).toBe(true);
    expect(editEnd?.resultSummary).toMatch(/lines|Wrote/i);

    const readEnd = toolEnds.find((e) => e.name === "read");
    expect(readEnd?.ok).toBe(true);
    expect(readEnd?.resultSummary).toBe("Read 4 lines");

    const shellEnd = toolEnds.find((e) => e.name === "shell");
    expect(shellEnd?.ok).toBe(true);
    expect(shellEnd?.resultSummary).toBe("exit 0");

    for (const start of toolStarts) {
      const end = toolEnds.find((e) => e.callId === start.callId);
      expect(end).toBeDefined();
      expect(end!.name).toBe(start.name);
    }
  });

  it("does not duplicate buffered flush text as display events", () => {
    const parser = new CursorStreamParser();
    const lines = loadFixtureLines();
    const allEvents = lines.flatMap((line) => parser.handleLine(line));
    const displayText = allEvents
      .filter((e) => e.type === "text")
      .map((e) => e.text)
      .join("");

    const bufferedLine = lines.find((l) => l.includes('"model_call_id"') && l.includes('"assistant"'));
    expect(bufferedLine).toBeTruthy();
    const bufferedText = JSON.parse(bufferedLine!).message.content[0].text as string;

    const occurrences = displayText.split(bufferedText.trim()).length - 1;
    expect(occurrences).toBe(1);

    const nonDeltaCount = allEvents.filter((e) => e.type === "text" && !e.delta).length;
    expect(nonDeltaCount).toBe(0);
  });

  it("detects shipper-question blocks from buffered text, not individual deltas", () => {
    const questionJson = JSON.stringify({
      questions: [
        {
          prompt: "Which file?",
          options: [{ label: "a.ts" }, { label: "b.ts" }],
        },
      ],
    });
    const block = `\`\`\`shipper-question\n${questionJson}\n\`\`\``;
    const partA = block.slice(0, 20);
    const partB = block.slice(20);

    const parser = new CursorStreamParser();
    parser.handleLine(
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: partA }] },
        timestamp_ms: 1,
      }),
    );
    expect(parser.pendingQuestion).toBeNull();

    parser.handleLine(
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: partB }] },
        timestamp_ms: 2,
      }),
    );
    expect(parser.pendingQuestion).toBeNull();

    parser.handleLine(
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: block }] },
        model_call_id: "flush-1",
        timestamp_ms: 3,
      }),
    );

    expect(parser.pendingQuestion).not.toBeNull();
    expect(parser.pendingQuestion!.questions).toHaveLength(1);
    expect(parser.pendingQuestion!.questions[0]!.prompt).toBe("Which file?");
    expect(extractQuestionBlocks(partA)).toBeNull();
  });

  it("falls back to non-delta text when neither streaming marker is present", () => {
    const parser = new CursorStreamParser();
    const events = parser.handleLine(
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Legacy full message." }],
        },
      }),
    );

    expect(events).toEqual([{ type: "text", text: "Legacy full message." }]);
  });
});
