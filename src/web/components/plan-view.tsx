import ReactMarkdown from "react-markdown";
import type { PlanPhaseDto, PlanSummary } from "../../shared/protocol.ts";

type PlanViewProps = {
  plan: PlanSummary;
  activePhaseNumber: number | null;
};

function phaseState(
  phase: PlanPhaseDto,
  activePhaseNumber: number | null,
): "done" | "in-progress" | "pending" {
  if (phase.complete) {
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

export function PlanView({ plan, activePhaseNumber }: PlanViewProps) {
  const total = plan.progress.totalChecked + plan.progress.totalUnchecked;

  return (
    <div className="plan-view">
      <div className="plan-progress-summary">
        <div className="progress-track large" aria-hidden="true">
          <div
            className="progress-fill"
            style={{
              width: `${total === 0 ? 0 : Math.round((plan.progress.totalChecked / total) * 100)}%`,
            }}
          />
        </div>
        <span>
          {plan.progress.totalChecked}/{total} tasks complete
          {plan.progress.phaseCount > 0 && (
            <>
              {" "}
              · Phase{" "}
              {plan.progress.currentPhase ?? plan.progress.phaseCount}/
              {plan.progress.phaseCount}
            </>
          )}
        </span>
      </div>

      <ol className="phase-tracker">
        {plan.phases.map((phase) => {
          const state = phaseState(phase, activePhaseNumber);
          return (
            <li key={phase.number} className={`phase-item phase-${state}`}>
              <div className="phase-heading">
                <span className="phase-marker">{phaseMarker(state)}</span>
                <span className="phase-title">
                  Phase {phase.number}
                  {phase.title ? `: ${phase.title}` : ""}
                </span>
                <span className="phase-counts">
                  {phase.checkedCount}/{phase.checkedCount + phase.uncheckedCount}
                </span>
              </div>
              {phase.sections.length > 0 && (
                <ul className="phase-sections">
                  {phase.sections.map((section) => (
                    <li key={section.title}>
                      <span className="section-title">{section.title}</span>
                      <span className="section-counts">
                        {section.checkedCount}/
                        {section.checkedCount + section.uncheckedCount}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>

      <section className="plan-markdown-preview">
        <h3>Plan document</h3>
        <div className="markdown-body">
          <ReactMarkdown>{plan.rawMarkdown}</ReactMarkdown>
        </div>
      </section>
    </div>
  );
}
