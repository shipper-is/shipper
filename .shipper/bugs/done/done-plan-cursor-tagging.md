---
severity: major
reported_at: "2026-07-05T22:03:00-04:00"
branch: shipper/bug-done-plan-cursor-tagging
base_branch: shipper/bug-worktree-plan-cursor-tagging
fixed_at: "2026-07-05T22:05:00-04:00"
pr_url: https://github.com/shipper-is/shipper/pull/16
pr_number: 16
---

# Done plans invisible to Cursor @ tagging

## Symptom
- After a plan moves from `.shipper/open/` to `.shipper/done/`, it can no longer be `@`-tagged in Cursor for follow-up work (e.g. running `/shipper-ship`).
- Expected: a stable, visible path in the main checkout that always resolves to the live plan file regardless of open/done state.
- Observed when completing plans — especially worktree plans where the real file lives under gitignored `.shipper/worktrees/`.

## Reproduction
1. Have an active worktree plan with a cursor symlink at `.shipper/open/<plan>.md` (from the prior worktree-tagging fix).
2. Complete the plan — move the file to `.shipper/done/<plan>.md` in the worktree (per `skills/shipper-build/GIT.md`).
3. Run `listPlans('.')` or open the Shipper console.
4. Observe `.shipper/open/<plan>.md` still points at the removed open path; no `.shipper/done/` symlink exists until manually synced.
5. In Cursor, `@`-tag the plan — the open symlink is broken and the done path is not discoverable under the worktree.

For non-worktree plans: the file moves from `.shipper/open/` to `.shipper/done/`, so anyone tagging the old open path loses access.

Mechanism-proven: `planCursorTagPath` returns `.shipper/<folder>/<filename>.md`, so the tag path changes when folder changes; worktree done copies remain gitignored without a main-checkout alias.

## Root Cause
- Cursor tag paths were tied to the plan's `open`/`done` folder via `planCursorTagPath`, so the tag path changed on completion.
- Worktree symlink sync only wrote aliases under `.shipper/open/` or `.shipper/done/` separately; moving to done left a stale open symlink and no done alias unless `listPlans` ran at the right moment.
- `shipper-ship` told agents to read `.shipper/done/<filename>.md`, which is gitignored for worktree plans and absent after worktree cleanup.

## Fix
- Kept open/done folder separation: worktree plans get symlinks in `.shipper/open/` or `.shipper/done/` matching their current state.
- `syncWorktreePlanSymlinks` removes the stale symlink from the other folder when a plan moves open→done (or vice versa).
- `planCursorTagPath` returns `.shipper/<folder>/<filename>.md` so the file browser shows open vs done distinctly.
- Cleans up any legacy `.shipper/plans/` symlinks from the earlier approach.
- Updated `skills/shipper-ship/GIT.md` to read from `.shipper/done/<filename>.md` (symlinked for worktree plans).

## Regression Guard
Pre-fix (`plan-store.ts` stashed, new tests kept):
```
FAIL updates the plans/ alias when a worktree plan moves to done
ENOENT on .shipper/plans/gone-plan.md after target removed
```

Post-fix (`bun run test src/core/plan-store.test.ts`):
```
Test Files  1 passed (1)
Tests  38 passed (38)
```
