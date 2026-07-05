import type { PlansSnapshot } from "../../shared/protocol.ts";

type LeftNavProps = {
  plans: PlansSnapshot;
  selectedFilename: string | null;
  onSelectPlan: (filename: string) => void;
  onNewPlan: () => void;
};

function progressPercent(checked: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((checked / total) * 100);
}

function formatPhaseLine(plan: {
  progress: PlansSnapshot["open"][number]["progress"];
}): string {
  const { progress } = plan;
  if (progress.phaseCount === 0) {
    return "No phases";
  }
  if (progress.currentPhase !== null) {
    return `Phase ${progress.currentPhase}/${progress.phaseCount}`;
  }
  return `Phase ${progress.phaseCount}/${progress.phaseCount}`;
}

function PlanRow({
  plan,
  selected,
  onSelect,
}: {
  plan: PlansSnapshot["open"][number];
  selected: boolean;
  onSelect: () => void;
}) {
  const total = plan.progress.totalChecked + plan.progress.totalUnchecked;

  return (
    <button
      type="button"
      className={`plan-row ${selected ? "selected" : ""}`}
      onClick={onSelect}
    >
      <span className="plan-row-title">{plan.title}</span>
      <span className="plan-row-filename">{plan.filename}</span>
      <div className="progress-track" aria-hidden="true">
        <div
          className="progress-fill"
          style={{ width: `${progressPercent(plan.progress.totalChecked, total)}%` }}
        />
      </div>
      <span className="plan-row-meta">
        {plan.progress.totalChecked}/{total} · {formatPhaseLine(plan)}
      </span>
    </button>
  );
}

export function LeftNav({
  plans,
  selectedFilename,
  onSelectPlan,
  onNewPlan,
}: LeftNavProps) {
  return (
    <nav className="left-nav">
      <button type="button" className="new-plan-button" onClick={onNewPlan}>
        + New plan
      </button>

      <section className="plan-section">
        <h2>Open</h2>
        {plans.open.length === 0 ? (
          <p className="empty-section">No open plans</p>
        ) : (
          plans.open.map((plan) => (
            <PlanRow
              key={plan.filename}
              plan={plan}
              selected={selectedFilename === plan.filename}
              onSelect={() => onSelectPlan(plan.filename)}
            />
          ))
        )}
      </section>

      <section className="plan-section">
        <h2>Done</h2>
        {plans.done.length === 0 ? (
          <p className="empty-section">No completed plans</p>
        ) : (
          plans.done.map((plan) => (
            <PlanRow
              key={plan.filename}
              plan={plan}
              selected={selectedFilename === plan.filename}
              onSelect={() => onSelectPlan(plan.filename)}
            />
          ))
        )}
      </section>
    </nav>
  );
}
