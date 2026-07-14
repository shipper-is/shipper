import { useEffect, useState, type RefObject } from "react";
import type {
  ClientMessage,
  GitWorkflowMode,
  PlanSummary,
  RunState,
  AgentQuestion,
  ChatEntry,
} from "../../shared/protocol.ts";
import type { NavMode } from "./left-nav.tsx";
import { ChatLog } from "./chat-log.tsx";
import { ChatInput } from "./chat-input.tsx";
import { PlanDocumentView } from "./plan-document-view.tsx";
import { PlanView } from "./plan-view.tsx";
import { QuestionCard } from "./question-card.tsx";
import { SessionPathsBar } from "./session-paths-bar.tsx";

type MainTab = "phases" | "plan" | "build";
type ComposeMode = "plan" | "spike";

type MainPaneProps = {
  plan: PlanSummary | null;
  runState: RunState;
  chatEntries: ChatEntry[];
  pendingQuestion: AgentQuestion | null;
  composing: ComposeMode | null;
  navMode: NavMode;
  queuedMessages: string[];
  noPlans: boolean;
  chatInputRef: RefObject<HTMLTextAreaElement | null>;
  onStartCompose: (mode: ComposeMode) => void;
  onCancelCompose: () => void;
  onStartPlan: (description: string) => void;
  onStartSpike: (description: string) => void;
  send: (msg: ClientMessage) => void;
  createdPlanFilename: string | null;
  onBuildCreatedPlan: () => void;
};

function runningTitle(skill: RunState["skill"]): string {
  if (skill === "plan") return "Creating plan…";
  if (skill === "spike") return "Spike in progress";
  return "Build in progress";
}

export function MainPane({
  plan,
  runState,
  chatEntries,
  pendingQuestion,
  composing,
  navMode,
  queuedMessages,
  noPlans,
  chatInputRef,
  onStartCompose,
  onCancelCompose,
  onStartPlan,
  onStartSpike,
  send,
  createdPlanFilename,
  onBuildCreatedPlan,
}: MainPaneProps) {
  const [tab, setTab] = useState<MainTab>("phases");
  const [description, setDescription] = useState("");
  const [confirmStop, setConfirmStop] = useState(false);
  const [gitMode, setGitMode] = useState<GitWorkflowMode>("current-branch");
  const [commitEachPhase, setCommitEachPhase] = useState(true);

  const startBuild = (planFilename: string) => {
    send({
      type: "start-build",
      planFilename,
      git: { mode: gitMode, commitEachPhase },
    });
  };

  const isRunning =
    runState.status === "running" ||
    runState.status === "waiting-answer" ||
    runState.status === "stopping";
  const isIdle = runState.status === "idle";

  useEffect(() => {
    if (isRunning) {
      setTab("build");
    }
  }, [isRunning]);

  useEffect(() => {
    if (isIdle && plan) {
      setTab("phases");
    }
  }, [plan?.filename, isIdle]);

  if (composing) {
    const isSpike = composing === "spike";
    return (
      <main className="main-pane compose-pane">
        <header className="main-pane-header">
          <div>
            <h1>{isSpike ? "New spike" : "New plan"}</h1>
            <p className="compose-subtitle">
              {isSpike
                ? "Describe a small, one-off task. Shipper will plan and build it in one run."
                : "Describe the feature or task to plan."}
            </p>
          </div>
        </header>
        <textarea
          className="compose-textarea"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={
            isSpike
              ? "What small task should Shipper spike?"
              : "What should Shipper plan and build?"
          }
          rows={8}
        />
        <div className="compose-actions">
          <button
            type="button"
            className="primary-button"
            disabled={!description.trim() || !isIdle}
            onClick={() => {
              if (isSpike) {
                onStartSpike(description);
              } else {
                onStartPlan(description);
              }
              setDescription("");
              onCancelCompose();
            }}
          >
            {isSpike ? "Start spike" : "Start planning"}
          </button>
          <button type="button" className="secondary-button" onClick={onCancelCompose}>
            Cancel
          </button>
        </div>
      </main>
    );
  }

  if (!plan && !isRunning) {
    const isSpikeMode = navMode === "spike";
    return (
      <main className="main-pane empty-main">
        {noPlans ? (
          <>
            <h1>Welcome to Shipper</h1>
            <p>
              {isSpikeMode
                ? "Start a spike to tackle a small task in a single agent run."
                : "Create your first plan to orchestrate AI agents through structured phases."}
            </p>
          </>
        ) : (
          <p>
            {isSpikeMode
              ? "Select a spike from the left, or create a new one."
              : "Select a plan from the left, or create a new one."}
          </p>
        )}
        <button
          type="button"
          className="primary-button"
          onClick={() => onStartCompose(isSpikeMode ? "spike" : "plan")}
        >
          {isSpikeMode ? "New spike" : "New plan"}
        </button>
      </main>
    );
  }

  const displayPlan = plan;
  const showTabs = Boolean(displayPlan) || isRunning;
  const showChatInput =
    tab === "build" && (Boolean(displayPlan) || isRunning || chatEntries.length > 0);
  const canEditPlan = Boolean(displayPlan && isIdle && displayPlan.folder === "open");
  const showBuildKickoff =
    tab === "build" &&
    isIdle &&
    displayPlan &&
    displayPlan.folder === "open" &&
    chatEntries.length === 0 &&
    !pendingQuestion;

  return (
    <main className="main-pane main-with-tabs">
      <header className="main-pane-header">
        <div>
          <h1>{displayPlan?.title ?? runningTitle(runState.skill)}</h1>
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
          {isIdle && displayPlan?.folder === "open" && tab !== "build" && (
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                setTab("build");
                startBuild(displayPlan.filename);
              }}
            >
              Build
            </button>
          )}
        </div>
      </header>

      <SessionPathsBar
        logPath={runState.logPath}
        agentTranscriptPath={runState.agentTranscriptPath}
      />

      {showTabs && (
        <div className="main-tabs">
          <button
            type="button"
            className={tab === "phases" ? "active" : ""}
            onClick={() => setTab("phases")}
            disabled={!displayPlan}
          >
            Phases
          </button>
          <button
            type="button"
            className={tab === "plan" ? "active" : ""}
            onClick={() => setTab("plan")}
            disabled={!displayPlan}
          >
            Plan
          </button>
          <button
            type="button"
            className={tab === "build" ? "active" : ""}
            onClick={() => setTab("build")}
          >
            Build
            {isRunning && <span className="tab-live-dot" aria-label="Agent running" />}
          </button>
        </div>
      )}

      <div className="main-tab-panel">
        {tab === "phases" && displayPlan && (
          <PlanView plan={displayPlan} activePhaseNumber={runState.activePhaseNumber} />
        )}

        {tab === "plan" && displayPlan && (
          <PlanDocumentView plan={displayPlan} editable={canEditPlan} send={send} />
        )}

        {tab === "build" && (
          <section className="build-tab">
            {showBuildKickoff && (
              <div className="build-kickoff">
                <p>No build session yet for this plan.</p>
                <div className="build-git-options">
                  <label className="build-git-option">
                    <span>Branch</span>
                    <select
                      value={gitMode}
                      onChange={(event) => setGitMode(event.target.value as GitWorkflowMode)}
                    >
                      <option value="current-branch">Current branch</option>
                      <option value="new-branch">New shipper/ branch</option>
                    </select>
                  </label>
                  <label className="build-git-option build-git-checkbox">
                    <input
                      type="checkbox"
                      checked={commitEachPhase}
                      onChange={(event) => setCommitEachPhase(event.target.checked)}
                    />
                    <span>Commit after each phase</span>
                  </label>
                </div>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => startBuild(displayPlan.filename)}
                >
                  Start build
                </button>
              </div>
            )}

            {(isRunning || chatEntries.length > 0 || pendingQuestion) && (
              <div className="chat-section build-chat">
                <ChatLog entries={chatEntries} paused={Boolean(pendingQuestion)} />
                {pendingQuestion && (
                  <QuestionCard
                    question={pendingQuestion}
                    onSubmit={(msg) => send(msg)}
                  />
                )}
              </div>
            )}

            {createdPlanFilename &&
              displayPlan?.filename === createdPlanFilename &&
              isIdle &&
              chatEntries.length > 0 && (
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
          </section>
        )}
      </div>
    </main>
  );
}
