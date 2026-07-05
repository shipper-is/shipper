import React, { useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { ActivityFeed } from "../components/activity-feed.tsx";
import { QuestionModal } from "../components/question-modal.tsx";
import { DEMO_SCRIPT, runDemoScript } from "../demo/script.ts";
import { useAppContext } from "../state/app-context.tsx";

export function DemoScreen() {
  const {
    feedEvents,
    appendFeedEvents,
    pendingQuestion,
    setPendingQuestion,
    waitingForAnswer,
    setWaitingForAnswer,
    setScreen,
    quit,
  } = useAppContext();

  const abortRef = useRef<AbortController | null>(null);
  const questionResolverRef = useRef<((answers: Record<string, string | string[]>) => void) | null>(
    null,
  );

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;

    void runDemoScript(DEMO_SCRIPT, {
      signal: controller.signal,
      onEvent: (event) => appendFeedEvents(event),
      onQuestion: (question) =>
        new Promise((resolve) => {
          setPendingQuestion(question);
          setWaitingForAnswer(true);
          questionResolverRef.current = (answers) => {
            appendFeedEvents({
              type: "text",
              text: `User answered: ${JSON.stringify(answers)}`,
            });
            resolve();
          };
        }),
    }).catch(() => {
      // aborted on unmount
    });

    return () => {
      controller.abort();
      abortRef.current = null;
    };
  }, [appendFeedEvents, setPendingQuestion, setWaitingForAnswer]);

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      abortRef.current?.abort();
      quit();
    }
    if (input === "b") {
      abortRef.current?.abort();
      setScreen("home");
    }
  });

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Text bold color="magenta">
        Demo mode
      </Text>
      <Text dimColor>Scripted feed + question modal for manual verification.</Text>
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
