import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { ActivityFeed } from "../components/activity-feed.tsx";
import { formatFeedTail } from "../components/feed-utils.ts";
import { ModelPicker } from "../components/model-picker.tsx";
import { QuestionModal } from "../components/question-modal.tsx";
import { resolveDefaultModel, saveModelChoice } from "../core/config.ts";
import { runBuildLoop, type BuildLoopResult } from "../core/orchestrator.ts";
import {
  findPlanByFilename,
  isPhaseComplete,
  watchPlans,
  type PlanFile,
  type PlanPhase,
} from "../core/plan-store.ts";
import { useAppContext } from "../state/app-context.tsx";

type Step = "running" | "cancel-confirm" | "success" | "error";

function phaseState(
  phase: PlanPhase,
  activePhaseNumber: number | null,
): "done" | "in-progress" | "pending" {
  if (isPhaseComplete(phase)) {
    return "done";
  }
  if (activePhaseNumber !== null && phase.number === activePhaseNumber) {
    return "in-progress";
  }
  return "pending";
}

function phaseMarker(state: "done" | "in-progress" | "pending"): string {
  switch (state) {
    case "done":
      return "✓";
    case "in-progress":
      return "▶";
    case "pending":
      return "○";
  }
}

function phaseColor(state: "done" | "in-progress" | "pending"): "green" | "cyan" | "gray" | undefined {
  switch (state) {
    case "done":
      return "green";
    case "in-progress":
      return "cyan";
    case "pending":
      return "gray";
  }
}

function PhaseTracker({
  phases,
  activePhaseNumber,
}: {
  phases: PlanPhase[];
  activePhaseNumber: number | null;
}) {
  return (
    <Box flexDirection="column">
      {phases.map((phase) => {
        const state = phaseState(phase, activePhaseNumber);
        const total = phase.checkedCount + phase.uncheckedCount;
        const label = phase.title
          ? `Phase ${phase.number}: ${phase.title}`
          : `Phase ${phase.number}`;
        return (
          <Text key={phase.number} color={phaseColor(state)}>
            {phaseMarker(state)} {label}
            {total > 0 ? ` (${phase.checkedCount}/${total})` : ""}
          </Text>
        );
      })}
    </Box>
  );
}

function SuccessPanel({ result, plan }: { result: BuildLoopResult; plan: PlanFile }) {
  if (result.status !== "success") {
    return null;
  }

  return (
    <Box flexDirection="column">
      <Text bold color="green">
        Build complete
      </Text>
      <Box marginTop={1}>
        <Text>{plan.title}</Text>
        <Text dimColor>{plan.filename}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text>
          Phases run: {result.phasesRun} · Sessions: {result.sessionsUsed}
        </Text>
        <Text>
          Location:{" "}
          {result.planLocation === "done"
            ? ".shipper/done/"
            : ".shipper/open/"}
        </Text>
        {result.leftInOpen && (
          <Text color="yellow">
            All tasks are checked but the plan file was left in open/ (the agent
            did not move it to done/).
          </Text>
        )}
      </Box>
    </Box>
  );
}

export function BuildScreen() {
  const {
    repoPath,
    selectedAgent,
    selectedPlan,
    setSelectedPlan,
    setScreen,
    feedEvents,
    appendFeedEvents,
    clearFeedEvents,
    pendingQuestion,
    setPendingQuestion,
    waitingForAnswer,
    setWaitingForAnswer,
    setActiveRun,
    quit,
  } = useAppContext();

  const [step, setStep] = useState<Step>("running");
  const [model, setModel] = useState<string | null>(null);
  const [resolvingModel, setResolvingModel] = useState(true);
  const [needsModelPick, setNeedsModelPick] = useState(false);
  const [livePlan, setLivePlan] = useState<PlanFile | null>(selectedPlan);
  const [activePhaseNumber, setActivePhaseNumber] = useState<number | null>(null);
  const [buildResult, setBuildResult] = useState<BuildLoopResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [logPath, setLogPath] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const questionResolverRef = useRef<
    ((answers: Record<string, string | string[]>) => void) | null
  >(null);
  const startedRef = useRef(false);

  const planFilename = selectedPlan?.filename;

  useEffect(() => {
    if (!selectedAgent) {
      setResolvingModel(false);
      return;
    }

    let cancelled = false;
    setResolvingModel(true);
    setNeedsModelPick(false);

    void resolveDefaultModel(repoPath, selectedAgent, "shipper-build").then((resolved) => {
      if (cancelled) {
        return;
      }
      if (resolved) {
        setModel(resolved);
      } else {
        setNeedsModelPick(true);
      }
      setResolvingModel(false);
    });

    return () => {
      cancelled = true;
    };
  }, [repoPath, selectedAgent]);

  useEffect(() => {
    if (!planFilename) {
      return;
    }

    const refresh = async () => {
      const updated = await findPlanByFilename(repoPath, planFilename);
      if (updated) {
        setLivePlan(updated);
        setSelectedPlan(updated);
      }
    };

    void refresh();
    const watcher = watchPlans(repoPath, () => {
      void refresh();
    });
    return () => {
      void watcher.close();
    };
  }, [repoPath, planFilename, setSelectedPlan]);

  useEffect(() => {
    if (!selectedAgent || !planFilename || !model || startedRef.current) {
      return;
    }
    startedRef.current = true;

    const controller = new AbortController();
    abortRef.current = controller;
    clearFeedEvents();
    setActiveRun({ kind: "build", planFilename });
    setStep("running");
    setBuildResult(null);
    setErrorMessage("");
    setActivePhaseNumber(null);

    void (async () => {
      const result = await runBuildLoop(repoPath, selectedAgent, planFilename, {
        signal: controller.signal,
        onSessionLog: (path) => setLogPath(path),
        onEvent: (event) => appendFeedEvents(event),
        onQuestion: (question) =>
          new Promise((resolve) => {
            setPendingQuestion(question);
            setWaitingForAnswer(true);
            questionResolverRef.current = (answers) => {
              resolve(answers);
            };
          }),
        onPhaseStart: (phaseNumber) => setActivePhaseNumber(phaseNumber),
        onPhaseComplete: () => {
          void findPlanByFilename(repoPath, planFilename).then((updated) => {
            if (updated) {
              setLivePlan(updated);
              setSelectedPlan(updated);
            }
          });
        },
        onPlanUpdate: () => {
          void findPlanByFilename(repoPath, planFilename).then((updated) => {
            if (updated) {
              setLivePlan(updated);
              setSelectedPlan(updated);
            }
          });
        },
      }, model);

      if (controller.signal.aborted && result.status === "cancelled") {
        return;
      }
      setBuildResult(result);
      if (result.status === "success") {
        void findPlanByFilename(repoPath, planFilename).then((updated) => {
          if (updated) {
            setLivePlan(updated);
            setSelectedPlan(updated);
          }
        });
        setStep("success");
      } else if (result.status === "cancelled") {
        setStep("cancel-confirm");
      } else {
        setErrorMessage(result.message);
        setStep("error");
      }
    })()
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          setStep("cancel-confirm");
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        setErrorMessage(message);
        setStep("error");
      })
      .finally(() => {
        setActiveRun(null);
        abortRef.current = null;
        setActivePhaseNumber(null);
      });

    return () => {
      controller.abort();
    };
  }, [
    repoPath,
    selectedAgent,
    planFilename,
    model,
    appendFeedEvents,
    clearFeedEvents,
    setPendingQuestion,
    setWaitingForAnswer,
    setActiveRun,
    setSelectedPlan,
  ]);

  useInput(
    (input, key) => {
      if (pendingQuestion) {
        return;
      }

      if (step === "running") {
        if (key.ctrl && input === "c") {
          abortRef.current?.abort();
          setStep("cancel-confirm");
          return;
        }
        return;
      }

      if (step === "cancel-confirm") {
        if (key.ctrl && input === "c") {
          quit();
          return;
        }
        if (input === "q" || key.return || key.escape) {
          setScreen("home");
        }
        return;
      }

      if (step === "success") {
        if (input === "q" || key.return || key.escape) {
          setScreen("home");
        }
        return;
      }

      if (step === "error") {
        if (input === "q" || key.return || key.escape) {
          setScreen("home");
        }
      }
    },
    { isActive: !pendingQuestion },
  );

  if (!selectedPlan || !livePlan) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="red">No plan selected.</Text>
        <Text dimColor>Press q to return home.</Text>
      </Box>
    );
  }

  if (!selectedAgent) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="red">No agent selected.</Text>
        <Text dimColor>Configure an agent in settings first.</Text>
      </Box>
    );
  }

  if (resolvingModel) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text dimColor>Resolving model…</Text>
      </Box>
    );
  }

  if (needsModelPick) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <ModelPicker
          agent={selectedAgent}
          skill="shipper-build"
          onSelect={(picked) => {
            void saveModelChoice(repoPath, selectedAgent, "shipper-build", picked).then(() => {
              setModel(picked);
              setNeedsModelPick(false);
            });
          }}
          onBack={() => setScreen("home")}
        />
      </Box>
    );
  }

  if (step === "success" && buildResult?.status === "success") {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <SuccessPanel result={buildResult} plan={livePlan} />
        <Box marginTop={1}>
          <Text dimColor>
            Press <Text color="cyan">q</Text> or Enter to return home
          </Text>
        </Box>
      </Box>
    );
  }

  if (step === "cancel-confirm") {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <Text bold color="yellow">
          Build cancelled
        </Text>
        <Box marginTop={1}>
          <Text dimColor>
            Press <Text color="cyan">q</Text> to return home ·{" "}
            <Text color="cyan">Ctrl+C</Text> again to force quit
          </Text>
        </Box>
      </Box>
    );
  }

  if (step === "error") {
    const tailLines = formatFeedTail(feedEvents);
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <Text bold color="red">
          Build failed
        </Text>
        <Box marginTop={1}>
          <Text>{errorMessage}</Text>
        </Box>
        {logPath && (
          <Box marginTop={1}>
            <Text dimColor>Session log: {logPath}</Text>
          </Box>
        )}
        {tailLines.length > 0 && (
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>Recent activity:</Text>
            {tailLines.map((line, index) => (
              <Text key={index} dimColor wrap="truncate">
                {line}
              </Text>
            ))}
          </Box>
        )}
        <Box marginTop={1}>
          <Text dimColor>
            Press <Text color="cyan">q</Text> or Enter to return home
          </Text>
        </Box>
      </Box>
    );
  }

  const currentPhase =
    activePhaseNumber !== null
      ? livePlan.parsed.phases.find((phase) => phase.number === activePhaseNumber)
      : livePlan.parsed.phases.find((phase) => !isPhaseComplete(phase));

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Text bold>{livePlan.title}</Text>
      <Text dimColor>{livePlan.filename}</Text>

      <Box marginTop={1}>
        <PhaseTracker
          phases={livePlan.parsed.phases}
          activePhaseNumber={activePhaseNumber}
        />
      </Box>

      {currentPhase && (
        <Box marginTop={1}>
          <Text>
            Current: Phase {currentPhase.number}
            {currentPhase.title ? `: ${currentPhase.title}` : ""} —{" "}
            {currentPhase.checkedCount}/
            {currentPhase.checkedCount + currentPhase.uncheckedCount} tasks
          </Text>
        </Box>
      )}

      <Box marginTop={1} flexGrow={1} flexDirection="column">
        <ActivityFeed events={feedEvents} paused={waitingForAnswer} />
      </Box>

      {pendingQuestion && (
        <QuestionModal
          question={pendingQuestion}
          onSubmit={(answers) => {
            setPendingQuestion(null);
            setWaitingForAnswer(false);
            questionResolverRef.current?.(answers);
            questionResolverRef.current = null;
          }}
        />
      )}
    </Box>
  );
}
