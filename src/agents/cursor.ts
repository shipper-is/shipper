import { execa, type Subprocess } from "execa";
import { AgentEventBus, QuestionGate } from "./event-bus.ts";
import { formatAnswers } from "./question-protocol.ts";
import { CursorStreamParser } from "./cursor-stream.ts";
import type {
  AgentAdapter,
  AgentEvent,
  AgentQuestion,
  AgentStartOptions,
} from "./types.ts";

const STDERR_TAIL_BYTES = 4_096;

function tailBuffer(buffer: string, maxBytes: number): string {
  if (Buffer.byteLength(buffer, "utf8") <= maxBytes) {
    return buffer;
  }
  let slice = buffer;
  while (slice.length > 0 && Buffer.byteLength(slice, "utf8") > maxBytes) {
    slice = slice.slice(Math.ceil(slice.length * 0.1));
  }
  return slice;
}

export class CursorAdapter implements AgentAdapter {
  private bus = new AgentEventBus();
  private gate = new QuestionGate();
  private chatId: string | null = null;
  private child: Subprocess | null = null;
  private stopped = false;
  private running = false;

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
    this.gate.cancelAll();
    if (this.child) {
      this.child.kill("SIGTERM");
      await Promise.race([
        this.child,
        new Promise((resolve) => setTimeout(resolve, 3_000)),
      ]).catch(() => undefined);
      if (this.child.exitCode === null) {
        this.child.kill("SIGKILL");
      }
      this.child = null;
    }
    this.bus.close();
  }

  private async run(opts: AgentStartOptions): Promise<void> {
    if (this.running) {
      this.bus.push({ type: "error", message: "Adapter already running" });
      this.bus.close();
      return;
    }
    this.running = true;

    try {
      let prompt = opts.prompt;
      let isResume = false;

      while (!this.stopped) {
        const completed = await this.spawnProcess(
          opts.cwd,
          prompt,
          isResume,
          opts.rawLogger,
          opts.model,
        );
        if (completed.kind === "error") {
          this.bus.push({ type: "error", message: completed.message });
          break;
        }

        if (completed.pendingQuestion) {
          const answers = await this.gate.wait(completed.pendingQuestion.id);
          if (this.stopped) {
            break;
          }
          prompt = formatAnswers(completed.pendingQuestion, answers);
          isResume = true;
          this.bus.push({ type: "turn-complete" });
          continue;
        }

        if (completed.finalResult !== undefined) {
          this.bus.push({ type: "done", result: completed.finalResult });
        } else if (!completed.sawResult) {
          this.bus.push({ type: "error", message: "Cursor agent exited without a result event" });
        }
        break;
      }
    } catch (error) {
      if (!this.stopped) {
        const message = error instanceof Error ? error.message : String(error);
        this.bus.push({ type: "error", message });
      }
    } finally {
      this.running = false;
      this.bus.close();
    }
  }

  private async spawnProcess(
    cwd: string,
    prompt: string,
    resume: boolean,
    rawLogger?: AgentStartOptions["rawLogger"],
    model?: string,
  ): Promise<
    | {
        kind: "ok";
        pendingQuestion?: AgentQuestion;
        finalResult?: string;
        sawResult: boolean;
      }
    | { kind: "error"; message: string }
  > {
    const binary = await this.resolveBinary();
    const args = [
      "-p",
      "--force",
      "--output-format",
      "stream-json",
      "--stream-partial-output",
      "--workspace",
      cwd,
    ];
    if (model) {
      args.push("--model", model);
    }
    if (resume && this.chatId) {
      args.push("--resume", this.chatId);
    }
    args.push(prompt);

    void rawLogger?.logRaw("out", JSON.stringify({ binary, args: args.slice(0, -1), prompt }));

    this.child = execa(binary, args, {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      env: { ...process.env, CI: "1" },
    });

    const parser = new CursorStreamParser();
    let stderrTail = "";

    const stderr = this.child.stderr;
    if (stderr) {
      stderr.setEncoding("utf8");
      stderr.on("data", (chunk: string) => {
        stderrTail = tailBuffer(stderrTail + chunk, STDERR_TAIL_BYTES);
      });
    }

    const stdout = this.child.stdout;
    if (!stdout) {
      return { kind: "error", message: "Cursor agent produced no stdout stream" };
    }

    stdout.setEncoding("utf8");
    let lineBuffer = "";

    for await (const chunk of stdout) {
      if (this.stopped) {
        break;
      }
      lineBuffer += chunk;
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";

      for (const line of lines) {
        void rawLogger?.logRaw("in", line.trim());
        for (const event of parser.handleLine(line)) {
          this.bus.push(event);
        }
      }
    }

    if (lineBuffer.trim()) {
      void rawLogger?.logRaw("in", lineBuffer.trim());
      for (const event of parser.handleLine(lineBuffer)) {
        this.bus.push(event);
      }
    }

    try {
      await this.child;
    } catch {
      // Non-zero exit is handled below using exitCode and stderr.
    }

    if (parser.sessionId) {
      this.chatId = parser.sessionId;
    }

    const exitCode = this.child.exitCode;
    this.child = null;

    if (this.stopped) {
      return { kind: "ok", sawResult: parser.sawResult };
    }

    if (exitCode !== 0 && !parser.sawResult && !parser.pendingQuestion) {
      const stderrSuffix = stderrTail.trim() ? `: ${stderrTail.trim()}` : "";
      return {
        kind: "error",
        message: `Cursor agent exited with code ${exitCode ?? "unknown"}${stderrSuffix}`,
      };
    }

    if (parser.pendingQuestion) {
      this.bus.push({ type: "question", question: parser.pendingQuestion });
      return { kind: "ok", pendingQuestion: parser.pendingQuestion, sawResult: parser.sawResult };
    }

    return {
      kind: "ok",
      finalResult: parser.finalResult,
      sawResult: parser.sawResult,
    };
  }

  private async resolveBinary(): Promise<string> {
    const { detectAgents } = await import("./detect.ts");
    const agents = await detectAgents();
    const cursor = agents.find((a) => a.kind === "cursor");
    return cursor?.binary ?? "cursor-agent";
  }
}
