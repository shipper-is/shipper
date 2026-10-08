import type { ActionStatus } from "../../shared/protocol.ts";

export function ActionBar({ action }: { action: ActionStatus | null }) {
  if (!action) return null;
  return (
    <div className={`action-bar action-bar--${action.state}`} role="status" aria-live="polite">
      <span className="action-bar__state">{action.state}</span>
      <span className="action-bar__message">{action.message}</span>
      {action.progress && <span className="action-bar__progress">{action.progress}</span>}
    </div>
  );
}
