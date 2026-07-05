import React, { useCallback, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import type { AgentQuestion, AgentQuestionItem } from "../agents/types.ts";

const OTHER_LABEL = "Other";

type QuestionModalProps = {
  question: AgentQuestion;
  onSubmit: (answers: Record<string, string | string[]>) => void;
};

type Step =
  | { type: "question"; index: number }
  | { type: "confirm" };

function withOtherOption(item: AgentQuestionItem): AgentQuestionItem {
  const hasOther = item.options.some((o) => o.label === OTHER_LABEL);
  if (hasOther) {
    return item;
  }
  return {
    ...item,
    options: [...item.options, { label: OTHER_LABEL, description: "Custom answer" }],
  };
}

export function QuestionModal({ question, onSubmit }: QuestionModalProps) {
  const items = useMemo(
    () => question.questions.map(withOtherOption),
    [question.questions],
  );

  const [step, setStep] = useState<Step>({ type: "question", index: 0 });
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [cursor, setCursor] = useState(0);
  const [multiSelected, setMultiSelected] = useState<Set<number>>(() => new Set());
  const [otherMode, setOtherMode] = useState(false);
  const [otherText, setOtherText] = useState("");

  const currentItem = step.type === "question" ? items[step.index] : null;
  const optionCount = currentItem?.options.length ?? 0;

  const commitCurrentAnswer = useCallback(() => {
    if (!currentItem) {
      return;
    }

    if (currentItem.multiSelect) {
      const labels = [...multiSelected]
        .sort((a, b) => a - b)
        .map((i) => {
          const opt = currentItem.options[i]!;
          if (opt.label === OTHER_LABEL) {
            return otherText.trim() || OTHER_LABEL;
          }
          return opt.label;
        });
      if (labels.length === 0) {
        return;
      }
      setAnswers((prev) => ({ ...prev, [currentItem.prompt]: labels }));
    } else {
      const opt = currentItem.options[cursor];
      if (!opt) {
        return;
      }
      if (opt.label === OTHER_LABEL) {
        if (!otherMode) {
          setOtherMode(true);
          return;
        }
        const text = otherText.trim();
        if (!text) {
          return;
        }
        setAnswers((prev) => ({ ...prev, [currentItem.prompt]: text }));
      } else {
        setAnswers((prev) => ({ ...prev, [currentItem.prompt]: opt.label }));
      }
    }

    setCursor(0);
    setMultiSelected(new Set());
    setOtherMode(false);
    setOtherText("");

    if (step.type === "question" && step.index + 1 < items.length) {
      setStep({ type: "question", index: step.index + 1 });
    } else {
      setStep({ type: "confirm" });
    }
  }, [currentItem, cursor, items.length, multiSelected, otherMode, otherText, step]);

  useInput(
    (input, key) => {
      if (otherMode) {
        if (key.return) {
          commitCurrentAnswer();
        }
        return;
      }

      if (step.type === "confirm") {
        if (key.return) {
          onSubmit(answers);
        }
        return;
      }

      if (!currentItem) {
        return;
      }

      if (currentItem.multiSelect) {
        if (key.upArrow) {
          setCursor((c) => Math.max(0, c - 1));
        } else if (key.downArrow) {
          setCursor((c) => Math.min(optionCount - 1, c + 1));
        } else if (input === " ") {
          setMultiSelected((prev) => {
            const next = new Set(prev);
            if (next.has(cursor)) {
              next.delete(cursor);
            } else {
              next.add(cursor);
            }
            return next;
          });
          const opt = currentItem.options[cursor];
          if (opt?.label === OTHER_LABEL) {
            setOtherMode(true);
          }
        } else if (key.return) {
          commitCurrentAnswer();
        }
        return;
      }

      if (key.upArrow) {
        setCursor((c) => Math.max(0, c - 1));
      } else if (key.downArrow) {
        setCursor((c) => Math.min(optionCount - 1, c + 1));
      } else if (key.return) {
        commitCurrentAnswer();
      }
    },
    { isActive: true },
  );

  return (
    <Box
      position="absolute"
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
    >
      <Box
        borderStyle="round"
        borderColor="cyan"
        flexDirection="column"
        paddingX={2}
        paddingY={1}
        width={Math.min(72, 80)}
      >
        {step.type === "confirm" ? (
          <>
            <Text bold>Confirm your answers</Text>
            <Box marginTop={1} flexDirection="column">
              {items.map((item) => {
                const value = answers[item.prompt];
                const display = Array.isArray(value) ? value.join(", ") : (value ?? "—");
                return (
                  <Box key={item.prompt} flexDirection="column" marginBottom={1}>
                    <Text dimColor>{item.header ?? item.prompt}</Text>
                    <Text>{display}</Text>
                  </Box>
                );
              })}
            </Box>
            <Box marginTop={1}>
              <Text dimColor>enter submit</Text>
            </Box>
          </>
        ) : currentItem ? (
          <>
            <Text bold>{currentItem.header ?? "Question"}</Text>
            <Box marginTop={1}>
              <Text wrap="wrap">{currentItem.prompt}</Text>
            </Box>
            <Box marginTop={1} flexDirection="column">
              {currentItem.options.map((opt, index) => {
                const isCursor = index === cursor;
                const checked = currentItem.multiSelect && multiSelected.has(index);
                const marker = currentItem.multiSelect
                  ? checked
                    ? "[x]"
                    : "[ ]"
                  : isCursor
                    ? "›"
                    : " ";
                return (
                  <Box key={opt.label} flexDirection="column">
                    <Text color={isCursor ? "cyan" : undefined}>
                      {marker} {opt.label}
                    </Text>
                    {opt.description && (
                      <Text dimColor> {"  "}{opt.description}</Text>
                    )}
                  </Box>
                );
              })}
            </Box>
            {otherMode && (
              <Box marginTop={1}>
                <Text>Other: </Text>
                <TextInput value={otherText} onChange={setOtherText} />
              </Box>
            )}
            <Box marginTop={1}>
              <Text dimColor>
                {currentItem.multiSelect
                  ? "↑↓ move · space toggle · enter next"
                  : "↑↓ select · enter choose"}
              </Text>
            </Box>
            {items.length > 1 && (
              <Text dimColor>
                Question {step.index + 1} of {items.length}
              </Text>
            )}
          </>
        ) : null}
      </Box>
    </Box>
  );
}
