import { useCallback, useMemo, useState } from "react";
import type { AgentQuestion, ClientMessage } from "../../shared/protocol.ts";

const OTHER_LABEL = "Other";

type QuestionCardProps = {
  question: AgentQuestion;
  onSubmit: (msg: ClientAnswerQuestion) => void;
};

type ClientAnswerQuestion = Extract<ClientMessage, { type: "answer-question" }>;

type Step =
  | { type: "question"; index: number }
  | { type: "confirm" };

function withOtherOption(item: AgentQuestion["items"][number]) {
  const hasOther = item.options.some((opt) => opt.label === OTHER_LABEL);
  if (hasOther) return item;
  return {
    ...item,
    options: [...item.options, { id: "other", label: OTHER_LABEL }],
  };
}

export function QuestionCard({ question, onSubmit }: QuestionCardProps) {
  const items = useMemo(
    () => question.items.map(withOtherOption),
    [question.items],
  );

  const [step, setStep] = useState<Step>({ type: "question", index: 0 });
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [multiSelected, setMultiSelected] = useState<Set<string>>(() => new Set());
  const [otherText, setOtherText] = useState("");

  const currentItem = step.type === "question" ? items[step.index] : null;

  const commitCurrentAnswer = useCallback(() => {
    if (!currentItem) return;

    if (currentItem.allowMultiple) {
      const labels = [...multiSelected].map((id) => {
        const opt = currentItem.options.find((entry) => entry.id === id);
        if (opt?.label === OTHER_LABEL) {
          return otherText.trim() || OTHER_LABEL;
        }
        return opt?.label ?? id;
      });
      if (labels.length === 0) return;
      setAnswers((prev) => ({ ...prev, [currentItem.prompt]: labels }));
    } else {
      const selected = currentItem.options.find((opt) => multiSelected.has(opt.id));
      if (!selected) return;
      if (selected.label === OTHER_LABEL) {
        const text = otherText.trim();
        if (!text) return;
        setAnswers((prev) => ({ ...prev, [currentItem.prompt]: text }));
      } else {
        setAnswers((prev) => ({ ...prev, [currentItem.prompt]: selected.label }));
      }
    }

    setMultiSelected(new Set());
    setOtherText("");

    if (step.type === "question" && step.index + 1 < items.length) {
      setStep({ type: "question", index: step.index + 1 });
    } else {
      setStep({ type: "confirm" });
    }
  }, [currentItem, items.length, multiSelected, otherText, step]);

  const toggleOption = (id: string, label: string) => {
    if (currentItem?.allowMultiple) {
      setMultiSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      if (label === OTHER_LABEL) {
        // keep other text field visible via selection
      }
    } else {
      setMultiSelected(new Set([id]));
    }
  };

  const showOtherInput =
    currentItem?.options.some(
      (opt) => opt.label === OTHER_LABEL && multiSelected.has(opt.id),
    ) ?? false;

  if (step.type === "confirm") {
    return (
      <div className="question-card">
        <h3>Confirm your answers</h3>
        <ul className="question-confirm-list">
          {items.map((item) => {
            const value = answers[item.prompt];
            const display = Array.isArray(value) ? value.join(", ") : (value ?? "—");
            return (
              <li key={item.prompt}>
                <span className="question-confirm-prompt">{item.header ?? item.prompt}</span>
                <span className="question-confirm-value">{display}</span>
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          className="primary-button"
          onClick={() =>
            onSubmit({
              type: "answer-question",
              questionId: question.id,
              answers,
            })
          }
        >
          Submit answers
        </button>
      </div>
    );
  }

  if (!currentItem) return null;

  return (
    <div className="question-card">
      <h3>{currentItem.header ?? "Question"}</h3>
      <p className="question-prompt">{currentItem.prompt}</p>
      <div className="question-options">
        {currentItem.options.map((opt) => {
          const selected = multiSelected.has(opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              className={`question-option ${selected ? "selected" : ""}`}
              onClick={() => toggleOption(opt.id, opt.label)}
            >
              {currentItem.allowMultiple ? (selected ? "☑" : "☐") : selected ? "›" : " "}{" "}
              {opt.label}
            </button>
          );
        })}
      </div>
      {showOtherInput && (
        <input
          className="question-other-input"
          value={otherText}
          onChange={(event) => setOtherText(event.target.value)}
          placeholder="Your answer…"
        />
      )}
      <div className="question-actions">
        <button type="button" className="primary-button" onClick={commitCurrentAnswer}>
          {step.index + 1 < items.length ? "Next" : "Review"}
        </button>
        {items.length > 1 && (
          <span className="question-progress">
            Question {step.index + 1} of {items.length}
          </span>
        )}
      </div>
    </div>
  );
}
