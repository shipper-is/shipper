---
severity: major
reported_at: "2026-07-06T11:27:00-04:00"
---

# New plan chat attaches to the latest existing plan

## Symptom
- When the user clicks “+ New plan” in the web console and starts planning, the chat/question UI renders inside the most recently available existing plan instead of showing as a standalone “pre-plan” planning session.
- The expected behavior is that the user sees a dedicated planning session (chat + questions, no plan phases) until the agent actually writes the new plan markdown file, at which point the new plan appears in the left nav and the chat becomes attached to it.
- Observed in the web console at `/` (Bun.serve React app) during new plan creation.

## Reproduction
1. Open the web console.
2. Ensure at least one existing plan exists in `.shipper/plans/open/`.
3. Click “+ New plan” and enter a description.
4. Click “Start planning”.
5. Observe that the main pane title shows the previously selected / latest existing plan title, and the chat appears under that plan instead of as a standalone “Creating plan” session.

## Root Cause
The server already models the pre-plan window correctly: when `start-plan` is handled, `runPlan()` sets `runState.skill = "plan"` and `runState.planFilename = null` until the agent writes the markdown file and `finishPlan()` broadcasts `plan-created`.

The client, however, never clears its selected plan when it enters that pre-plan window. `useSocket` keeps the last selection and falls back to `pickDefaultPlan()` whenever `runState.planFilename` is missing.

The failure path:
1. User is on an existing plan (or the first open plan is auto-selected), so `selectedPlanFilename` is `existing.md`.
2. `runPlan()` broadcasts `run-state` with `skill: "plan"`, `planFilename: null`.
3. The `run-state` handler in `src/web/hooks/use-socket.ts` only updates `runState`; it does not touch `selectedPlanFilename`.
4. The `snapshot` handler in the same file then decides: keep the current selection if it still exists, else use `runState.planFilename`, else `pickDefaultPlan(plans)`. Since `existing.md` still exists, it keeps `existing.md`.
5. `App.tsx` passes `socket.selectedPlan` (the existing plan) to `MainPane.tsx`.
6. `MainPane.tsx` renders `displayPlan.title` in the header and shows the chat inside that plan’s “Build” tab, so the user appears to be chatting with the agent about the existing plan instead of the new plan being created.

There is no client-side concept of a draft/pre-plan session, so the chat is bound to the wrong nav item until `plan-created` arrives and `useSocket` finally switches `selectedPlanFilename` to the new file.

## Fix

## Regression Guard
