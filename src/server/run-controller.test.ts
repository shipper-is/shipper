import { describe, expect, it, vi, beforeEach } from "vitest";
import type { BuildLoopResult } from "../core/orchestrator.ts";
import {
  applyAgentEvent,
  createRunController,
  type OrchestratorFns,
} from "./run-controller.ts";
import { idleRunState } from "../shared/protocol.ts";

vi.mock("../core/config.ts", () => ({
  resolveDefaultModel: vi.fn(async () => "test-model"),
  saveModelChoice: vi.fn(async () => undefined),
  setProjectConfig: vi.fn(async () => ({})),
}));

vi.mock("../core/plan-store.ts", () => ({
  findPlanByFilename: vi.fn(async () => ({
    filename: "foo.md",
    title: "Foo",
    folder: "open",
    path: "/repo/.shipper/open/foo.md",
    progress: { totalChecked: 0, totalUnchecked: 1, currentPhase: 1, phaseCount: 1 },
    parsed: { title: "Foo", phases: [] },
  })),
}));

function makeEntry(kind: "agent-text" | "user-message", text: string) {
  return {
    id: "existing",
    kind,
    text,
    timestamp: 1,
  };
}

describe("applyAgentEvent", () => {
  it("merges delta text into trailing agent-text entry", () => {
    const entries = [makeEntry("agent-text", "hello")];
    const result = applyAgentEvent(entries, { type: "text", text: " world", delta: true });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.text).toBe("hello world");
    expect(result.replaceLast).toBeDefined();
    expect(result.append).toBeUndefined();
  });

  it("does not merge delta text into a user message", () => {
    const entries = [makeEntry("user-message", "hello")];
    const result = applyAgentEvent(entries, { type: "text", text: " world", delta: true });
    expect(result.entries).toHaveLength(2);
    expect(result.entries[1]!.kind).toBe("agent-text");
    expect(result.entries[1]!.text).toBe(" world");
  });

  it("updates tool-start entries on tool-end", () => {
    const start = applyAgentEvent([], {
      type: "tool-start",
      callId: "c1",
      name: "read",
      summary: "Reading file",
    });
    const end = applyAgentEvent(start.entries, {
      type: "tool-end",
      callId: "c1",
      name: "read",
      summary: "Reading file",
      ok: true,
      resultSummary: "done",
    });
    expect(end.entries).toHaveLength(1);
    expect(end.entries[0]!.pending).toBe(false);
    expect(end.entries[0]!.text).toContain("done");
  });
});

describe("createRunController", () => {
  const repoPath = "/repo";
  const broadcasts: unknown[] = [];

  beforeEach(() => {
    broadcasts.length = 0;
  });

  const baseDeps = () => ({
    repoPath,
    getAgent: () => "cursor" as const,
    getConfigInfo: () => ({
      repoPath,
      defaultAgent: "cursor" as const,
      detectedAgents: [],
    }),
    refreshConfigInfo: async () => ({
      repoPath,
      defaultAgent: "cursor" as const,
      detectedAgents: [],
    }),
    onBroadcast: (msg: unknown) => broadcasts.push(msg),
    onPlanUpdate: vi.fn(),
  });

  it("rejects a second run while one is active", async () => {
    let resolveBuild: ((value: BuildLoopResult) => void) | undefined;

    const orchestrator: OrchestratorFns = {
      runBuildLoop: vi.fn(
        () =>
          new Promise<BuildLoopResult>((resolve) => {
            resolveBuild = resolve;
          }),
      ),
      runPlanCreation: vi.fn(),
    };

    const controller = createRunController({
      ...baseDeps(),
      orchestrator,
    });

    void controller.handleClientMessage({
      type: "start-build",
      planFilename: "foo.md",
    });

    await vi.waitFor(() => {
      expect(controller.getRunState().status).toBe("running");
    });

    controller.handleClientMessage({
      type: "start-build",
      planFilename: "bar.md",
    });

    expect(broadcasts.some((msg) => (msg as { type: string }).type === "notice")).toBe(true);
    resolveBuild?.({ status: "cancelled", sessionsUsed: 0 });
    await vi.waitFor(() => {
      expect(controller.getRunState().status).toBe("idle");
    });
  });

  it("resolves pending questions and clears state", async () => {
    const orchestrator: OrchestratorFns = {
      runBuildLoop: vi.fn(async (_repo, _agent, _file, handlers) => {
        await handlers.onQuestion({
          id: "q1",
          questions: [
            {
              prompt: "Pick one",
              options: [{ label: "A" }, { label: "B" }],
            },
          ],
        });
        return {
          status: "success",
          sessionsUsed: 1,
          phasesRun: 1,
          planLocation: "open",
        } satisfies BuildLoopResult;
      }),
      runPlanCreation: vi.fn(),
    };

    const controller = createRunController({
      ...baseDeps(),
      orchestrator,
    });

    void controller.handleClientMessage({
      type: "start-build",
      planFilename: "foo.md",
    });

    await vi.waitFor(() => {
      expect(controller.getPendingQuestion()).not.toBeNull();
    });

    controller.handleClientMessage({
      type: "answer-question",
      questionId: "q1",
      answers: { "Pick one": "A" },
    });

    expect(controller.getPendingQuestion()).toBeNull();
    expect(controller.getRunState().status).toBe("running");
    expect(broadcasts.some((msg) => (msg as { type: string }).type === "question-cleared")).toBe(
      true,
    );

    await vi.waitFor(() => {
      expect(controller.getRunState().status).toBe("idle");
    });
  });

  it("starts idle", () => {
    const controller = createRunController(baseDeps());
    expect(controller.getRunState()).toEqual(idleRunState());
    expect(controller.getChatEntries()).toEqual([]);
  });
});
