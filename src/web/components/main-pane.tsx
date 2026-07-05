import { useState, type RefObject } from "react";
import type { ClientMessage, PlanSummary, RunState, AgentQuestion, ChatEntry } from "../../shared/protocol.ts";
import { ChatLog } from "./chat-log.tsx";
import { ChatInput } from "./chat-input.tsx";
import { PlanView } from "./plan-view.tsx";
import { QuestionCard } from "./question-card.tsx";

type MainPaneProps = {
  plan: PlanSummary | null;
  runState: RunState;
  chatEntries: ChatEntry[];
  pendingQuestion: AgentQuestion | null;
  composingNewPlan: boolean;
  queuedMessages: string[];
  noPlans: boolean;
  chatInputRef: RefObject<HTMLTextAreaElement | null>;
  onStartCompose: () => void;
  onCancelCompose: () => void;
  onStartPlan: (description: string) => void;
  send: (msg: ClientMessage) => void;
  createdPlanFilename: string | null;
  onBuildCreatedPlan: () => void;
};

export function MainPane({
  plan,
  runState,
  chatEntries,
  pendingQuestion,
  composingNewPlan,
  queuedMessages,
  noPlans,
  chatInputRef,
  onStartCompose,
  onCancelCompose,
  onStartPlan,
  send,
  createdPlanFilename,
  onBuildCreatedPlan,
}: MainPaneProps) {
  const [tab, setTab] = useState<"overview" | "raw">("overview");
  const [description, setDescription] = useState("");
  const [confirmStop, setConfirmStop] = useState(false);

  const isRunning =
    runState.status === "running" ||
    runState.status === "waiting-answer" ||
    runState.status === "stopping";
  const isIdle = runState.status === "idle";

  if (composingNewPlan) {
    return (
      <main className="main-pane compose-pane">
        <header className="main-pane-header">
          <div>
            <h1>New plan</h1>
            <p className="compose-subtitle">Describe the feature or task to plan.</p>
          </div>
        </header>
        <textarea
          className="compose-textarea"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="What should Shipper plan and build?"
          rows={8}
        />
        <div className="compose-actions">
          <button
            type="button"
            className="primary-button"
            disabled={!description.trim() || !isIdle}
            onClick={() => {
              onStartPlan(description);
              setDescription("");
              onCancelCompose();
            }}
          >
            Start planning
          </button>
          <button type="button" className="secondary-button" onClick={onCancelCompose}>
            Cancel
          </button>
        </div>
      </main>
    );
  }

  if (!plan && !isRunning) {
    return (
      <main className="main-pane empty-main">
        {noPlans ? (
          <>
            <h1>Welcome to Shipper</h1>
            <p>Create your first plan to orchestrate AI agents through structured phases.</p>
          </>
        ) : (
          <p>Select a plan from the left, or create a new one.</p>
        )}
        <button type="button" className="primary-button" onClick={onStartCompose}>
          New plan
        </button>
      </main>
    );
  }

  const displayPlan = plan;
  const showPlanDetails = displayPlan && isIdle;
  const showChat = isRunning || chatEntries.length > 0 || pendingQuestion;
  const showChatInput = Boolean(displayPlan) || isRunning || chatEntries.length > 0;

  return (
    <main className="main-pane main-with-chat">
      <header className="main-pane-header">
        <div>
          <h1>{displayPlan?.title ?? (runState.skill === "plan" ? "Creating plan…" : "Build in progress")}</h1>
          {displayPlan && (
            <span className={`folder-badge folder-${displayPlan.folder}`}>{displayPlan.folder}</span>
          )}
        </div>
        <div className="main-pane-meta">
          <span className={`skill-pill skill-${runState.skill ?? "idle"}`}>
            {runState.skill ?? "idle"}
          </span>
          {isRunning && runState.activePhaseNumber !== null && (
            <span className="phase-progress-line">Phase {runState.activePhaseNumber}</span>
          )}
          {isRunning && (
            <button
              type="button"
              className="danger-button"
              onClick={() => {
                if (confirmStop) {
                  send({ type: "stop-run" });
                  setConfirmStop(false);
                } else {
                  setConfirmStop(true);
                }
              }}
            >
              {confirmStop ? "Confirm stop" : "Stop"}
            </button>
          )}
          {showPlanDetails && displayPlan.folder === "open" && (
            <button
              type="button"
              className="primary-button"
              onClick={() => send({ type: "start-build", planFilename: displayPlan.filename })}
            >
              Build
            </button>
          )}
        </div>
      </header>

      {showPlanDetails && (
        <div className="main-tabs">
          <button
            type="button"
            className={tab === "overview" ? "active" : ""}
            onClick={() => setTab("overview")}
          >
            Overview
          </button>
          <button
            type="button"
            className={tab === "raw" ? "active" : ""}
            onClick={() => setTab("raw")}
          >
            Raw markdown
          </button>
        </div>
      )}

      {showPlanDetails && tab === "overview" && (
        <PlanView plan={displayPlan} activePhaseNumber={runState.activePhaseNumber} />
      )}

      {showPlanDetails && tab === "raw" && (
        <pre className="raw-markdown">{displayPlan.rawMarkdown}</pre>
      )}

      {showChat && (
      <section className="chat-section">
        <ChatLog entries={chatEntries} paused={Boolean(pendingQuestion)} />
        {pendingQuestion && (
          <QuestionCard
            question={pendingQuestion}
            onSubmit={(msg) => send(msg)}
          />
        )}
        {createdPlanFilename && displayPlan?.filename === createdPlanFilename && isIdle && (
          <div className="build-now-banner">
            <span>Plan ready.</span>
            <button
              type="button"
              className="primary-button"
              onClick={onBuildCreatedPlan}
            >
              Build it now
            </button>
          </div>
        )}
      </section>
      )}

      {showChatInput && queuedMessages.length > 0 && (
        <p className="queued-messages-banner">
          {queuedMessages.length} message{queuedMessages.length === 1 ? "" : "s"} queued for the
          next agent session.
        </p>
      )}

      {showChatInput && (
        <ChatInput
          ref={chatInputRef}
          disabled={Boolean(pendingQuestion)}
          disabledHint="Answer the agent's question before sending a message."
          onSend={(text) => send({ type: "send-message", text })}
        />
      )}
    </main>
  );
}
