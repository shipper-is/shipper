import type { PlanMetaDto, PlanPhaseDto, PlanSummary } from "../../shared/protocol.ts";

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

function hasMeta(meta: PlanMetaDto): boolean {
  return (
    meta.branch !== null ||
    meta.baseBranch !== null ||
    meta.startedAt !== null ||
    meta.completedAt !== null ||
    meta.prUrl !== null ||
    meta.prNumber !== null
  );
}

function parseTimestamp(iso: string): Date | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTime(iso: string): string | null {
  const date = parseTimestamp(iso);
  return date ? date.toLocaleString() : null;
}

function formatDuration(startedAt: string, completedAt: string): string | null {
  const start = parseTimestamp(startedAt);
  const end = parseTimestamp(completedAt);
  if (!start || !end) {
    return null;
  }

  const ms = end.getTime() - start.getTime();
  if (ms < 0) {
    return null;
  }

  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes}m`;
  }
  if (minutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${minutes}m`;
}

function PlanMetaPanel({ meta }: { meta: PlanMetaDto }) {
  const startedLabel =
    meta.startedAt !== null ? formatDateTime(meta.startedAt) : null;
  const completedLabel =
    meta.completedAt !== null ? formatDateTime(meta.completedAt) : null;
  const durationLabel =
    meta.startedAt !== null && meta.completedAt !== null
      ? formatDuration(meta.startedAt, meta.completedAt)
      : null;

  return (
    <div className="plan-meta-panel">
      {meta.prUrl !== null && (
        <div className="plan-meta-row">
          <span className="plan-meta-label">PR</span>
          <span className="plan-meta-value">
            <a href={meta.prUrl} target="_blank" rel="noreferrer">
              {meta.prNumber !== null ? `PR #${meta.prNumber}` : "View PR"}
            </a>
          </span>
        </div>
      )}
      {meta.branch !== null && (
        <div className="plan-meta-row">
          <span className="plan-meta-label">Branch</span>
          <span className="plan-meta-value">
            <code>{meta.branch}</code>
          </span>
        </div>
      )}
      {meta.baseBranch !== null && (
        <div className="plan-meta-row">
          <span className="plan-meta-label">Base</span>
          <span className="plan-meta-value">
            <code>{meta.baseBranch}</code>
          </span>
        </div>
      )}
      {startedLabel !== null && (
        <div className="plan-meta-row">
          <span className="plan-meta-label">Started</span>
          <span className="plan-meta-value">{startedLabel}</span>
        </div>
      )}
      {completedLabel !== null && (
        <div className="plan-meta-row">
          <span className="plan-meta-label">Completed</span>
          <span className="plan-meta-value">{completedLabel}</span>
        </div>
      )}
      {durationLabel !== null && (
        <div className="plan-meta-row">
          <span className="plan-meta-label">Duration</span>
          <span className="plan-meta-value">{durationLabel}</span>
        </div>
      )}
    </div>
  );
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

      {hasMeta(plan.meta) && <PlanMetaPanel meta={plan.meta} />}

      <ol className="phase-tracker">
        {plan.phases.map((phase) => {
          const state = phaseState(phase, activePhaseNumber);
          const phaseCommit = plan.meta.phaseCommits[phase.number];
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
                {phaseCommit !== undefined && (
                  <code className="phase-commit-sha">{phaseCommit}</code>
                )}
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
    </div>
  );
}
