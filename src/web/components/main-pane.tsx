import { useState } from "react";
import type { PlanSummary, RunState } from "../../shared/protocol.ts";
import { PlanView } from "./plan-view.tsx";

type MainPaneProps = {
  plan: PlanSummary | null;
  runState: RunState;
  activePhaseNumber: number | null;
};

export function MainPane({ plan, runState, activePhaseNumber }: MainPaneProps) {
  const [tab, setTab] = useState<"overview" | "raw">("overview");

  if (!plan) {
    return (
      <main className="main-pane empty-main">
        <p>Select a plan from the left, or create a new one.</p>
      </main>
    );
  }

  return (
    <main className="main-pane">
      <header className="main-pane-header">
        <div>
          <h1>{plan.title}</h1>
          <span className={`folder-badge folder-${plan.folder}`}>{plan.folder}</span>
        </div>
        <div className="main-pane-meta">
          <span className={`skill-pill skill-${runState.skill ?? "idle"}`}>
            {runState.skill ?? "idle"}
          </span>
        </div>
      </header>

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

      {tab === "overview" ? (
        <PlanView plan={plan} activePhaseNumber={activePhaseNumber} />
      ) : (
        <pre className="raw-markdown">{plan.rawMarkdown}</pre>
      )}
    </main>
  );
}
