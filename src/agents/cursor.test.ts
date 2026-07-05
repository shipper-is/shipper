import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "./types.ts";

const mockExeca = vi.fn();
vi.mock("execa", () => ({
  execa: (...args: unknown[]) => mockExeca(...args),
}));

vi.mock("./detect.ts", () => ({
  detectAgents: vi.fn().mockResolvedValue([
    { kind: "cursor", binary: "cursor-agent", version: "1.0.0" },
  ]),
}));

const { CursorAdapter } = await import("./cursor.ts");

function createStderrStream(text: string) {
  const stderr = new EventEmitter() as EventEmitter & { setEncoding: (enc: string) => void };
  stderr.setEncoding = () => {};
  const addListener = stderr.on.bind(stderr);
  stderr.on = ((event: string, listener: (...args: unknown[]) => void) => {
    if (event === "data" && text) {
      listener(text);
    }
    return addListener(event, listener);
  }) as typeof stderr.on;
  return stderr;
}

function mockSubprocess(opts: {
  stdout?: string;
  stderr?: string;
  exitCode: number;
}) {
  const stdout = Readable.from([opts.stdout ?? ""]);
  const stderr = opts.stderr ? createStderrStream(opts.stderr) : createStderrStream("");

  const child = Object.assign(Promise.resolve({ exitCode: opts.exitCode }), {
    stdout,
    stderr,
    exitCode: opts.exitCode,
    kill: vi.fn(),
  });

  return child;
}

async function collectAdapterEvents(
  adapter: InstanceType<typeof CursorAdapter>,
  opts: { cwd: string; prompt: string },
  onQuestion?: (question: AgentEvent & { type: "question" }) => Record<string, string | string[]>,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of adapter.start(opts)) {
    events.push(event);
    if (event.type === "question" && onQuestion) {
      adapter.answer(event.question.id, onQuestion(event));
    }
  }
  return events;
}

describe("CursorAdapter", () => {
  beforeEach(() => {
    mockExeca.mockReset();
  });

  it("surfaces stderr when the process exits before a result (unsupported flags)", async () => {
    mockExeca.mockReturnValue(
      mockSubprocess({
        stderr: "error: unknown option '--stream-partial-output'",
        exitCode: 1,
      }),
    );

    const adapter = new CursorAdapter();
    const events = await collectAdapterEvents(adapter, {
      cwd: "/tmp",
      prompt: "hello",
    });

    expect(events.some((e) => e.type === "error")).toBe(true);
    const error = events.find((e) => e.type === "error");
    expect(error?.message).toContain("exited with code 1");
    expect(error?.message).toContain("unknown option");
    expect(mockExeca).toHaveBeenCalledTimes(1);
  });

  it("resumes with --resume after answering a streaming question", async () => {
    const questionJson = JSON.stringify({
      questions: [
        {
          prompt: "Which file?",
          options: [{ label: "a.ts" }, { label: "b.ts" }],
        },
      ],
    });
    const questionBlock = `\`\`\`shipper-question\n${questionJson}\n\`\`\``;
    const firstStdout = [
      JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "resume-session-1",
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: questionBlock }],
        },
        model_call_id: "flush-q",
        timestamp_ms: 1,
      }),
    ].join("\n");

    const secondStdout = JSON.stringify({
      type: "result",
      result: "Created a.ts",
    });

    mockExeca
      .mockReturnValueOnce(mockSubprocess({ stdout: firstStdout, exitCode: 0 }))
      .mockReturnValueOnce(mockSubprocess({ stdout: secondStdout, exitCode: 0 }));

    const adapter = new CursorAdapter();
    const events = await collectAdapterEvents(
      adapter,
      { cwd: "/tmp", prompt: "plan something" },
      () => ({ "Which file?": "a.ts" }),
    );

    expect(mockExeca).toHaveBeenCalledTimes(2);
    const secondArgs = mockExeca.mock.calls[1]![1] as string[];
    expect(secondArgs).toContain("--resume");
    expect(secondArgs).toContain("resume-session-1");

    expect(events.some((e) => e.type === "question")).toBe(true);
    expect(events.some((e) => e.type === "turn-complete")).toBe(true);
    expect(events.some((e) => e.type === "done" && e.result === "Created a.ts")).toBe(true);
  });
});
