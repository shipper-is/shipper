import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { ActivityFeed } from "../components/activity-feed.tsx";
import { formatFeedTail } from "../components/feed-utils.ts";
import { ModelPicker } from "../components/model-picker.tsx";
import { QuestionModal } from "../components/question-modal.tsx";
import { resolveDefaultModel, saveModelChoice } from "../core/config.ts";
import { runPlanCreation } from "../core/orchestrator.ts";
import type { PlanFile } from "../core/plan-store.ts";
import { RunLogger } from "../core/run-logger.ts";
import { useAppContext } from "../state/app-context.tsx";

type Step = "input" | "confirm" | "select-model" | "running" | "success" | "error";

function DescriptionPreview({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} paddingY={0}>
      {lines.map((line, index) => (
        <Text key={index}>{line || " "}</Text>
      ))}
    </Box>
  );
}

export function NewPlanScreen() {
  const {
    repoPath,
    selectedAgent,
    detectedAgents,
    setScreen,
    feedEvents,
    appendFeedEvents,
    clearFeedEvents,
    pendingQuestion,
    setPendingQuestion,
    waitingForAnswer,
    setWaitingForAnswer,
    setActiveRun,
    setSelectedPlan,
    setHighlightPlanFilename,
  } = useAppContext();

  const [step, setStep] = useState<Step>("input");
  const [description, setDescription] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [createdPlan, setCreatedPlan] = useState<PlanFile | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [logPath, setLogPath] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const questionResolverRef = useRef<
    ((answers: Record<string, string | string[]>) => void) | null
  >(null);

  const agentLabel =
    selectedAgent &&
    detectedAgents.find((agent) => agent.kind === selectedAgent)?.version
      ? `${selectedAgent} (${detectedAgents.find((agent) => agent.kind === selectedAgent)?.version})`
      : selectedAgent ?? "none";

  useEffect(() => {
    if (step !== "running" || !selectedAgent || !model) {
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setActiveRun({ kind: "plan" });

    void (async () => {
      const logger = await RunLogger.create(selectedAgent);
      setLogPath(logger.path);

      const result = await runPlanCreation(
        repoPath,
        selectedAgent,
        description.trim(),
        {
          signal: controller.signal,
          logger,
          onEvent: (event) => appendFeedEvents(event),
          onQuestion: (question) =>
            new Promise((resolve) => {
              setPendingQuestion(question);
              setWaitingForAnswer(true);
              questionResolverRef.current = (answers) => {
                resolve(answers);
              };
            }),
        },
        model,
      );

      if (controller.signal.aborted) {
        return;
      }
      if (result.status === "success") {
        setCreatedPlan(result.plan);
        setStep("success");
      } else {
        setErrorMessage(result.message);
        setStep("error");
      }
    })()
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        setErrorMessage(message);
        setStep("error");
      })
      .finally(() => {
        setActiveRun(null);
        abortRef.current = null;
      });

    return () => {
      controller.abort();
    };
  }, [
    step,
    repoPath,
    selectedAgent,
    model,
    description,
    appendFeedEvents,
    setPendingQuestion,
    setWaitingForAnswer,
    setActiveRun,
  ]);

  useInput(
    (input, key) => {
      if (pendingQuestion) {
        return;
      }

      if (step === "input") {
        if (key.ctrl && input === "d") {
          if (description.trim()) {
            setStep("confirm");
          }
          return;
        }
        if (input === "q" || key.escape) {
          setScreen("home");
          return;
        }
        if (key.return) {
          setDescription((current) => current + "\n");
          return;
        }
        if (key.backspace || key.delete) {
          setDescription((current) => current.slice(0, -1));
          return;
        }
        if (!key.ctrl && !key.meta && input) {
          setDescription((current) => current + input);
        }
        return;
      }

      if (step === "confirm") {
        if (key.return) {
          if (!selectedAgent) {
            return;
          }
          const agent = selectedAgent;
          void (async () => {
            const resolved = await resolveDefaultModel(repoPath, agent, "shipper-plan");
            if (resolved) {
              setModel(resolved);
              clearFeedEvents();
              setStep("running");
            } else {
              setStep("select-model");
            }
          })();
          return;
        }
        if (input === "q" || key.escape) {
          setStep("input");
        }
        return;
      }

      if (step === "select-model") {
        return;
      }

      if (step === "running") {
        if (input === "q" || key.escape) {
          abortRef.current?.abort();
          setScreen("home");
        }
        return;
      }

      if (step === "success") {
        if (input === "v" || key.return) {
          if (createdPlan) {
            setHighlightPlanFilename(createdPlan.filename);
          }
          setScreen("home");
          return;
        }
        if (input === "b") {
          if (createdPlan) {
            setSelectedPlan(createdPlan);
            setScreen("build");
          }
        }
        if (input === "q") {
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
    { isActive: !pendingQuestion && step !== "select-model" },
  );

  if (!selectedAgent) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="red">No agent selected.</Text>
        <Text dimColor>Configure an agent in settings first.</Text>
      </Box>
    );
  }

  if (step === "input") {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <Text bold>New plan</Text>
        <Box marginTop={1}>
          <Text dimColor>
            Describe the feature or task to plan. Press Enter for a new line,{" "}
            <Text color="cyan">Ctrl+D</Text> when done, <Text color="cyan">q</Text> to cancel.
          </Text>
        </Box>
        <Box marginTop={1} flexGrow={1}>
          <DescriptionPreview text={description || "(type your description…)"} />
        </Box>
      </Box>
    );
  }

  if (step === "select-model" && selectedAgent) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <ModelPicker
          agent={selectedAgent}
          skill="shipper-plan"
          onSelect={(picked) => {
            void saveModelChoice(repoPath, selectedAgent, "shipper-plan", picked).then(() => {
              setModel(picked);
              clearFeedEvents();
              setStep("running");
            });
          }}
          onBack={() => setStep("confirm")}
        />
      </Box>
    );
  }

  if (step === "confirm") {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <Text bold>Confirm plan creation</Text>
        <Box marginTop={1}>
          <Text>
            Agent: <Text color="cyan">{agentLabel}</Text>
          </Text>
          {model && (
            <Text>
              Model: <Text color="cyan">{model}</Text>
            </Text>
          )}
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Feature description:</Text>
          <DescriptionPreview text={description.trim()} />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>
            Press <Text color="cyan">Enter</Text> to start · <Text color="cyan">Esc</Text> to edit ·{" "}
            <Text color="cyan">q</Text> to cancel
          </Text>
        </Box>
      </Box>
    );
  }

  if (step === "running") {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <Text bold>Creating plan…</Text>
        <Text dimColor>
          Agent: {agentLabel}
          {model ? ` · Model: ${model}` : ""}
        </Text>
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

  if (step === "success" && createdPlan) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <Text bold color="green">
          Plan created
        </Text>
        <Box marginTop={1}>
          <Text>{createdPlan.title}</Text>
          <Text dimColor>{createdPlan.filename}</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>
            <Text color="cyan">v</Text> or Enter — view in list · <Text color="cyan">b</Text> start
            build · <Text color="cyan">q</Text> home
          </Text>
        </Box>
      </Box>
    );
  }

  const tailLines = formatFeedTail(feedEvents);

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Text bold color="red">
        Plan creation failed
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
