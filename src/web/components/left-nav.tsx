import { useCallback, useMemo, type RefObject } from "react";
import type { PlansSnapshot } from "../../shared/protocol.ts";

export type NavMode = "plan" | "spike";

type LeftNavProps = {
  navRef: RefObject<HTMLElement | null>;
  plans: PlansSnapshot;
  selectedFilename: string | null;
  mode: NavMode;
  onModeChange: (mode: NavMode) => void;
  onSelectPlan: (filename: string) => void;
  onNewItem: () => void;
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

function matchesMode(
  plan: PlansSnapshot["open"][number],
  mode: NavMode,
): boolean {
  return (plan.meta.type === "spike") === (mode === "spike");
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
        <span className="plan-row-meta-text">
          {plan.progress.totalChecked}/{total} · {formatPhaseLine(plan)}
        </span>
        {plan.meta.prUrl !== null && (
          <span
            className="pr-badge"
            role="link"
            tabIndex={0}
            onClick={(event) => {
              event.stopPropagation();
              window.open(plan.meta.prUrl!, "_blank", "noopener");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                window.open(plan.meta.prUrl!, "_blank", "noopener");
              }
            }}
          >
            PR #{plan.meta.prNumber ?? "?"}
          </span>
        )}
      </span>
    </button>
  );
}

export function LeftNav({
  navRef,
  plans,
  selectedFilename,
  mode,
  onModeChange,
  onSelectPlan,
  onNewItem,
}: LeftNavProps) {
  const openPlans = useMemo(
    () => plans.open.filter((plan) => matchesMode(plan, mode)),
    [plans.open, mode],
  );
  const donePlans = useMemo(
    () => plans.done.filter((plan) => matchesMode(plan, mode)),
    [plans.done, mode],
  );

  const allPlans = useMemo(
    () => [...openPlans, ...donePlans],
    [openPlans, donePlans],
  );

  const moveSelection = useCallback(
    (delta: number) => {
      if (allPlans.length === 0) {
        return;
      }
      const currentIndex = allPlans.findIndex((plan) => plan.filename === selectedFilename);
      const startIndex = currentIndex >= 0 ? currentIndex : 0;
      const nextIndex = (startIndex + delta + allPlans.length) % allPlans.length;
      onSelectPlan(allPlans[nextIndex]!.filename);
    },
    [allPlans, onSelectPlan, selectedFilename],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(-1);
    } else if (event.key === "Enter" && selectedFilename) {
      event.preventDefault();
      onSelectPlan(selectedFilename);
    }
  };

  const noPlans = openPlans.length === 0 && donePlans.length === 0;
  const itemLabel = mode === "spike" ? "spike" : "plan";

  return (
    <nav
      ref={navRef}
      className="left-nav"
      tabIndex={0}
      aria-label={mode === "spike" ? "Spikes" : "Plans"}
      onKeyDown={onKeyDown}
    >
      <div className="nav-tabs" role="tablist" aria-label="Plan or spike">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "plan"}
          className={mode === "plan" ? "active" : ""}
          onClick={() => onModeChange("plan")}
        >
          Plan
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "spike"}
          className={mode === "spike" ? "active" : ""}
          onClick={() => onModeChange("spike")}
        >
          Spike
        </button>
      </div>

      <button type="button" className="new-plan-button" onClick={onNewItem}>
        {mode === "spike" ? "+ New spike" : "+ New plan"}
      </button>

      {noPlans ? (
        <div className="empty-nav-state">
          <p>{mode === "spike" ? "No spikes yet." : "No plans yet."}</p>
          <p className="empty-nav-hint">
            {mode === "spike"
              ? "Use + New spike to start a one-off task."
              : "Create one to get started, or add markdown files to `.shipper/open/`."}
          </p>
        </div>
      ) : (
        <>
          <section className="plan-section">
            <h2>Open</h2>
            {openPlans.length === 0 ? (
              <p className="empty-section">No open {itemLabel}s</p>
            ) : (
              openPlans.map((plan) => (
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
            {donePlans.length === 0 ? (
              <p className="empty-section">No completed {itemLabel}s</p>
            ) : (
              donePlans.map((plan) => (
                <PlanRow
                  key={plan.filename}
                  plan={plan}
                  selected={selectedFilename === plan.filename}
                  onSelect={() => onSelectPlan(plan.filename)}
                />
              ))
            )}
          </section>
        </>
      )}
    </nav>
  );
}
