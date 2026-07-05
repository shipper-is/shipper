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

vi.mock("../agents/models.ts", () => ({
  listModels: vi.fn(async () => [{ id: "model-a", label: "Model A" }]),
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
      runFollowUp: vi.fn(),
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
    resolveBuild?.({ status: "cancelled", sessionsUsed: 0, lastSessionId: null });
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
          lastSessionId: "session-1",
        } satisfies BuildLoopResult;
      }),
      runPlanCreation: vi.fn(),
      runFollowUp: vi.fn(),
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

  it("opens and saves model configuration from settings", async () => {
    const refreshConfigInfo = vi.fn(async () => ({
      repoPath,
      defaultAgent: "cursor" as const,
      detectedAgents: [],
      models: { "shipper-plan": "model-a" },
    }));

    const controller = createRunController({
      ...baseDeps(),
      refreshConfigInfo,
    });

    void controller.handleClientMessage({
      type: "configure-model",
      skill: "shipper-plan",
    });

    await vi.waitFor(() => {
      expect(controller.getModelPickRequest()).not.toBeNull();
    });

    expect(broadcasts.some((msg) => (msg as { type: string }).type === "needs-model-pick")).toBe(
      true,
    );

    void controller.handleClientMessage({
      type: "select-model",
      skill: "shipper-plan",
      modelId: "model-a",
    });

    await vi.waitFor(() => {
      expect(controller.getModelPickRequest()).toBeNull();
    });

    expect(refreshConfigInfo).toHaveBeenCalled();
    expect(broadcasts.some((msg) => (msg as { type: string }).type === "config-info")).toBe(true);
    expect(broadcasts.some((msg) => (msg as { type: string }).type === "model-pick-cleared")).toBe(
      true,
    );
  });

  it("cancels model pick and clears pending start", async () => {
    const { resolveDefaultModel } = await import("../core/config.ts");
    vi.mocked(resolveDefaultModel).mockResolvedValueOnce(undefined);

    const controller = createRunController(baseDeps());

    void controller.handleClientMessage({
      type: "start-plan",
      description: "Add widgets",
    });

    await vi.waitFor(() => {
      expect(controller.getModelPickRequest()).not.toBeNull();
    });

    controller.handleClientMessage({ type: "cancel-model-pick" });

    expect(controller.getModelPickRequest()).toBeNull();
    expect(broadcasts.some((msg) => (msg as { type: string }).type === "model-pick-cleared")).toBe(
      true,
    );
    expect(controller.getRunState().status).toBe("idle");
  });

  it("queues follow-up messages during an active build", async () => {
    let resolveBuild: ((value: BuildLoopResult) => void) | undefined;
    let pendingUserMessages: (() => string[]) | undefined;

    const orchestrator: OrchestratorFns = {
      runBuildLoop: vi.fn((_repo, _agent, _file, handlers) => {
        pendingUserMessages = handlers.pendingUserMessages;
        return new Promise<BuildLoopResult>((resolve) => {
          resolveBuild = resolve;
        });
      }),
      runPlanCreation: vi.fn(),
      runFollowUp: vi.fn(),
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
      type: "send-message",
      text: "also fix the tests",
    });

    expect(controller.getQueuedMessages()).toEqual(["also fix the tests"]);
    expect(
      controller.getChatEntries().some(
        (entry) => entry.text === "Message queued for the next agent session.",
      ),
    ).toBe(true);

    const drained = pendingUserMessages?.();
    expect(drained).toEqual(["also fix the tests"]);
    expect(controller.getQueuedMessages()).toEqual([]);

    resolveBuild?.({
      status: "success",
      sessionsUsed: 1,
      phasesRun: 1,
      planLocation: "open",
      lastSessionId: "session-1",
    });
    await vi.waitFor(() => {
      expect(controller.getRunState().status).toBe("idle");
    });
  });

  it("starts a follow-up run when idle after a build", async () => {
    let resolveBuild: ((value: BuildLoopResult) => void) | undefined;

    const orchestrator: OrchestratorFns = {
      runBuildLoop: vi.fn(
        () =>
          new Promise<BuildLoopResult>((resolve) => {
            resolveBuild = resolve;
          }),
      ),
      runPlanCreation: vi.fn(),
      runFollowUp: vi.fn(async () => ({
        ok: true,
        lastSessionId: "cursor-session-2",
      })),
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

    resolveBuild?.({
      status: "success",
      sessionsUsed: 1,
      phasesRun: 1,
      planLocation: "open",
      lastSessionId: "cursor-session",
    });

    await vi.waitFor(() => {
      expect(controller.getRunState().status).toBe("idle");
    });

    controller.handleClientMessage({
      type: "send-message",
      text: "one more tweak",
    });

    await vi.waitFor(() => {
      expect(orchestrator.runFollowUp).toHaveBeenCalledWith(
        repoPath,
        "cursor",
        "one more tweak",
        "cursor-session",
        expect.any(Object),
        expect.objectContaining({ model: "test-model", planFilename: "foo.md" }),
      );
    });
  });
});
