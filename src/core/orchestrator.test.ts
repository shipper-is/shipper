import { mkdtempSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAdapter, AgentEvent } from "../agents/types.ts";
import { consumeAgentRun, runBuildLoop, runFollowUp, runSpike } from "./orchestrator.ts";
import { appendPendingUserMessages, buildFollowUpPrompt } from "./prompts.ts";

const mockCreateAdapter = vi.fn<(kind: string) => AgentAdapter>();
vi.mock("../agents/index.ts", () => ({
  createAdapter: (kind: string) => mockCreateAdapter(kind),
}));
vi.mock("./skills.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./skills.ts")>();
  return {
    ...actual,
    installSkills: vi.fn().mockResolvedValue(undefined),
  };
});

function mockAdapter(events: AgentEvent[], sessionId: string | null = null): AgentAdapter {
  return {
    sessionId,
    async *start() {
      for (const event of events) {
        yield event;
      }
    },
    answer() {},
    async stop() {},
  };
}

const SIMPLE_PLAN = `# Test Plan

## Phase 1: First
### Section
- [ ] task one
- [ ] task two

## Phase 2: Second
### Section
- [ ] task three
`;

const PHASE1_DONE_PLAN = `# Test Plan

## Phase 1: First
### Section
- [x] task one
- [x] task two

### Completion Notes
- done

## Phase 2: Second
### Section
- [ ] task three
`;

const ALL_DONE_PLAN = `# Test Plan

## Phase 1: First
### Section
- [x] task one
- [x] task two

### Completion Notes
- done

## Phase 2: Second
### Section
- [x] task three

### Completion Notes
- done
`;

async function writePlan(repoPath: string, markdown: string, folder: "open" | "done" = "open") {
  await mkdir(join(repoPath, ".shipper", folder), { recursive: true });
  await writeFile(join(repoPath, ".shipper", folder, "test-plan.md"), markdown, "utf8");
}

describe("consumeAgentRun", () => {
  it("forwards events and resolves questions", async () => {
    const seen: AgentEvent[] = [];
    let answered: Record<string, string | string[]> | undefined;

    const adapter = mockAdapter([
      { type: "text", text: "hello" },
      {
        type: "question",
        question: {
          id: "q1",
          questions: [
            {
              prompt: "Pick one",
              options: [{ label: "a" }, { label: "b" }],
            },
          ],
        },
      },
      { type: "done", result: "ok" },
    ]);

    const result = await consumeAgentRun(
      adapter,
      { cwd: "/tmp", prompt: "test" },
      {
        onEvent: (event) => seen.push(event),
        onQuestion: async () => {
          answered = { "Pick one": "a" };
          return answered;
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(seen).toHaveLength(3);
    expect(answered).toEqual({ "Pick one": "a" });
  });

  it("returns error when stream emits error", async () => {
    const adapter = mockAdapter([{ type: "error", message: "boom" }]);
    const result = await consumeAgentRun(
      adapter,
      { cwd: "/tmp", prompt: "test" },
      {
        onEvent: () => {},
        onQuestion: async () => ({}),
      },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe("boom");
  });

  it("forwards passthrough events without special handling", async () => {
    const seen: AgentEvent[] = [];
    const adapter = mockAdapter([
      { type: "text", text: "Hello", delta: true },
      { type: "text", text: " world", delta: true },
      {
        type: "tool-start",
        callId: "1",
        name: "read",
        summary: "file.ts",
      },
      {
        type: "tool-end",
        callId: "1",
        name: "read",
        summary: "file.ts",
        ok: true,
        resultSummary: "Read 10 lines",
      },
      { type: "turn-complete" },
      { type: "done", result: "finished" },
    ]);

    const result = await consumeAgentRun(
      adapter,
      { cwd: "/tmp", prompt: "test" },
      {
        onEvent: (event) => seen.push(event),
        onQuestion: async () => ({}),
      },
    );

    expect(result.ok).toBe(true);
    expect(seen).toHaveLength(6);
    expect(seen.filter((e) => e.type === "tool-start")).toHaveLength(1);
    expect(seen.filter((e) => e.type === "tool-end")).toHaveLength(1);
    expect(seen.filter((e) => e.type === "text" && e.delta)).toHaveLength(2);
  });
});

describe("runBuildLoop", () => {
  let repoPath: string;

  beforeEach(() => {
    repoPath = mkdtempSync(join(tmpdir(), "shipper-build-"));
    mockCreateAdapter.mockReset();
  });

  it("returns success immediately when plan is already complete", async () => {
    await writePlan(repoPath, ALL_DONE_PLAN);

    const result = await runBuildLoop(repoPath, "cursor", "test-plan.md", {
      onEvent: () => {},
      onQuestion: async () => ({}),
    });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.sessionsUsed).toBe(0);
      expect(result.leftInOpen).toBe(true);
    }
    expect(mockCreateAdapter).not.toHaveBeenCalled();
  });

  it("completes phases sequentially and detects done folder", async () => {
    await writePlan(repoPath, SIMPLE_PLAN);
    let call = 0;

    mockCreateAdapter.mockImplementation(() => ({
      sessionId: null,
      async *start() {
        call++;
        if (call === 1) {
          await writePlan(repoPath, PHASE1_DONE_PLAN);
        } else if (call === 2) {
          await writePlan(repoPath, ALL_DONE_PLAN);
          await mkdir(join(repoPath, ".shipper", "done"), { recursive: true });
          await rename(
            join(repoPath, ".shipper", "open", "test-plan.md"),
            join(repoPath, ".shipper", "done", "test-plan.md"),
          );
        }
        yield { type: "done", result: "ok" };
      },
      answer() {},
      async stop() {},
    }));

    const result = await runBuildLoop(repoPath, "cursor", "test-plan.md", {
      onEvent: () => {},
      onQuestion: async () => ({}),
    });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.planLocation).toBe("done");
      expect(result.sessionsUsed).toBe(2);
      expect(result.phasesRun).toBe(2);
    }
  });

  it("succeeds when all boxes checked but file left in open/", async () => {
    await writePlan(repoPath, SIMPLE_PLAN);

    mockCreateAdapter.mockImplementation(() => ({
      sessionId: null,
      async *start() {
        await writePlan(repoPath, ALL_DONE_PLAN);
        yield { type: "done", result: "ok" };
      },
      answer() {},
      async stop() {},
    }));

    const result = await runBuildLoop(repoPath, "cursor", "test-plan.md", {
      onEvent: () => {},
      onQuestion: async () => ({}),
    });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.leftInOpen).toBe(true);
      expect(result.planLocation).toBe("open");
    }
  });

  it("aborts after two consecutive no-progress sessions on the same phase", async () => {
    await writePlan(repoPath, SIMPLE_PLAN);

    mockCreateAdapter.mockImplementation(() =>
      mockAdapter([{ type: "done", result: "no changes" }]),
    );

    const result = await runBuildLoop(repoPath, "cursor", "test-plan.md", {
      onEvent: () => {},
      onQuestion: async () => ({}),
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toContain("stalled on Phase 1");
      expect(result.sessionsUsed).toBe(2);
    }
  });

  it("resets stall counter when progress is made", async () => {
    await writePlan(repoPath, SIMPLE_PLAN);
    let call = 0;

    mockCreateAdapter.mockImplementation(() => ({
      sessionId: null,
      async *start() {
        call++;
        if (call === 2) {
          await writePlan(repoPath, PHASE1_DONE_PLAN);
        }
        yield { type: "done", result: "ok" };
      },
      answer() {},
      async stop() {},
    }));

    const result = await runBuildLoop(repoPath, "cursor", "test-plan.md", {
      onEvent: () => {},
      onQuestion: async () => ({}),
    });

    expect(mockCreateAdapter.mock.calls.length).toBeGreaterThanOrEqual(2);
    if (result.status === "error") {
      expect(result.message).not.toContain("stalled on Phase 1");
    }
  });

  it("respects the session cap", async () => {
    const tasks = Array.from({ length: 10 }, (_, i) => `- [ ] task ${i + 1}`).join("\n");
    const bigPhasePlan = `# Test Plan

## Phase 1: Big
### Section
${tasks}
`;
    await writePlan(repoPath, bigPhasePlan);

    let call = 0;
    mockCreateAdapter.mockImplementation(() => ({
      sessionId: null,
      async *start() {
        call++;
        const checked = Array.from({ length: call }, (_, i) => `- [x] task ${i + 1}`).join("\n");
        const unchecked = Array.from({ length: 10 - call }, (_, i) => `- [ ] task ${call + i + 1}`).join("\n");
        const markdown = `# Test Plan

## Phase 1: Big
### Section
${checked}
${unchecked}
`;
        await writePlan(repoPath, markdown);
        yield { type: "done", result: "ok" };
      },
      answer() {},
      async stop() {},
    }));

    const result = await runBuildLoop(repoPath, "cursor", "test-plan.md", {
      onEvent: () => {},
      onQuestion: async () => ({}),
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toContain("session limit");
      expect(result.sessionsUsed).toBe(4);
    }
  });

  it("reports cancellation", async () => {
    await writePlan(repoPath, SIMPLE_PLAN);
    const controller = new AbortController();
    controller.abort();

    const result = await runBuildLoop(repoPath, "cursor", "test-plan.md", {
      signal: controller.signal,
      onEvent: () => {},
      onQuestion: async () => ({}),
    });

    expect(result.status).toBe("cancelled");
    if (result.status === "cancelled") {
      expect(result.sessionsUsed).toBe(0);
    }
  });
});

describe("runFollowUp", () => {
  let repoPath: string;

  beforeEach(() => {
    repoPath = mkdtempSync(join(tmpdir(), "shipper-followup-"));
    mockCreateAdapter.mockReset();
  });

  it("passes resumeSessionId to the adapter for cursor", async () => {
    let startOpts: { resumeSessionId?: string } | undefined;
    mockCreateAdapter.mockImplementation(() => ({
      sessionId: "new-session",
      async *start(opts) {
        startOpts = opts;
        yield { type: "done", result: "ok" };
      },
      answer() {},
      async stop() {},
    }));

    const result = await runFollowUp(
      repoPath,
      "cursor",
      "please continue",
      "resume-abc",
      { onEvent: () => {}, onQuestion: async () => ({}) },
    );

    expect(result.ok).toBe(true);
    expect(result.lastSessionId).toBe("new-session");
    expect(startOpts?.resumeSessionId).toBe("resume-abc");
  });
});

describe("runSpike", () => {
  let repoPath: string;

  beforeEach(() => {
    repoPath = mkdtempSync(join(tmpdir(), "shipper-spike-"));
    mockCreateAdapter.mockReset();
  });

  const SPIKE_FILE = `---
type: spike
---
# My Spike

- [ ] do the thing
`;

  it("succeeds when a new spike file appears in open/", async () => {
    mockCreateAdapter.mockImplementation(() => ({
      sessionId: "spike-session-1",
      async *start() {
        await mkdir(join(repoPath, ".shipper", "open"), { recursive: true });
        await writeFile(join(repoPath, ".shipper", "open", "my-spike.md"), SPIKE_FILE, "utf8");
        yield { type: "done", result: "ok" };
      },
      answer() {},
      async stop() {},
    }));

    const result = await runSpike(repoPath, "cursor", "Add a widget", {
      onEvent: () => {},
      onQuestion: async () => ({}),
    });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.filename).toBe("my-spike.md");
      expect(result.title).toBe("My Spike");
      expect(result.location).toBe("open");
      expect(result.lastSessionId).toBe("spike-session-1");
    }
  });

  it("succeeds when a new spike file appears in done/", async () => {
    mockCreateAdapter.mockImplementation(() => ({
      sessionId: "spike-session-2",
      async *start() {
        await mkdir(join(repoPath, ".shipper", "done"), { recursive: true });
        await writeFile(join(repoPath, ".shipper", "done", "finished-spike.md"), SPIKE_FILE, "utf8");
        yield { type: "done", result: "ok" };
      },
      answer() {},
      async stop() {},
    }));

    const result = await runSpike(repoPath, "cursor", "Ship a fix", {
      onEvent: () => {},
      onQuestion: async () => ({}),
    });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.filename).toBe("finished-spike.md");
      expect(result.location).toBe("done");
    }
  });

  it("returns error when no new spike file appears", async () => {
    mockCreateAdapter.mockImplementation(() =>
      mockAdapter([{ type: "done", result: "ok" }], "spike-session-3"),
    );

    const result = await runSpike(repoPath, "cursor", "Ghost spike", {
      onEvent: () => {},
      onQuestion: async () => ({}),
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toContain("no new spike file");
      expect(result.lastSessionId).toBe("spike-session-3");
    }
  });
});

describe("prompt helpers", () => {
  it("appends pending user messages to build prompts", () => {
    const prompt = appendPendingUserMessages("base prompt", ["fix tests", "update docs"]);
    expect(prompt).toContain("Messages from the user since the last session:");
    expect(prompt).toContain("- fix tests");
    expect(prompt).toContain("- update docs");
    expect(prompt.startsWith("base prompt")).toBe(true);
  });

  it("builds follow-up prompt with plan context when not resuming", () => {
    const prompt = buildFollowUpPrompt("ship it", "cursor", {
      planRelativePath: ".shipper/open/foo.md",
      resuming: false,
    });
    expect(prompt).toContain("continues work on the plan");
    expect(prompt).toContain(".shipper/open/foo.md");
    expect(prompt).toContain("ship it");
  });

  it("omits plan context when resuming", () => {
    const prompt = buildFollowUpPrompt("ship it", "cursor", {
      planRelativePath: ".shipper/open/foo.md",
      resuming: true,
    });
    expect(prompt).not.toContain("continues work on the plan");
    expect(prompt).toContain("ship it");
  });
});
