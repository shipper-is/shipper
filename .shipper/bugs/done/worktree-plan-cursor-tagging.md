---
severity: major
reported_at: "2026-07-05T21:51:00-04:00"
branch: shipper/bug-worktree-plan-cursor-tagging
base_branch: main
fixed_at: "2026-07-05T21:54:00-04:00"
---

# Worktree plans invisible to Cursor file tagging

## Symptom
- When a plan runs in a git worktree, its markdown file lives under `.shipper/worktrees/<slug>/.shipper/open/`, which is gitignored. Cursor's file browser and `@` file tagging only surface tracked, non-ignored paths, so the plan cannot be referenced in chat.
- Expected: the plan file should be reachable via Cursor's normal file picker / `@` tagging at a stable path under the main checkout.
- Observed in Cursor while a plan (e.g. `modules-marketplace`) is active in `.shipper/worktrees/`.

## Reproduction
1. Start a plan with a worktree (per `skills/shipper-build/GIT.md` phase 1).
2. Confirm the plan file was moved out of the main checkout: `ls .shipper/open/` is empty.
3. Confirm the live plan is only under the worktree, e.g. `.shipper/worktrees/<slug>/.shipper/open/<plan>.md`.
4. Run `git check-ignore -v` on that path — it matches `.gitignore` rule `.shipper/worktrees/`.
5. In Cursor, try to `@`-tag the plan markdown file via the file browser — the path does not appear.

Mechanism-proven on this repo: `modules-marketplace.md` exists only at `.shipper/worktrees/modules-marketplace/.shipper/open/modules-marketplace.md` (gitignored); main `.shipper/open/` is empty.

## Root Cause
- `skills/shipper-build/GIT.md` (and sibling skill GIT files) **move** the plan file into the worktree checkout on phase 1, leaving no file at the main-repo `.shipper/open/<filename>.md` path.
- `.shipper/worktrees/` is listed in `.gitignore` (by design), so Cursor hides the entire worktree tree from its file browser and `@` picker.
- The console correctly aggregates worktree plans via `listWorktreePlans` in `src/core/plan-store.ts`, but nothing exposes a visible alias path in the main checkout for editor tooling.

## Fix
- `listPlans` in `src/core/plan-store.ts` now calls `syncWorktreePlanSymlinks`, which creates repo-relative symlinks at `.shipper/open/<filename>.md` (or `done/`) pointing into the gitignored worktree copy. Main-checkout symlinks are skipped when scanning main plans so deduplication still prefers the worktree `path` for reads/writes.
- Added `planCursorTagPath` helper for the stable visible path.
- Updated `skills/shipper-build/GIT.md`, `skills/shipper-spike/GIT.md`, and `skills/shipper-bug/GIT.md` so agent workflows without the console also create symlinks when moving plan/spike/bug files into a worktree.

## Regression Guard
Pre-fix (`plan-store.ts` stashed, new tests kept):
```
FAIL creates a main-checkout symlink for worktree plans
Error: ENOENT: no such file or directory, open '.../.shipper/open/gone-plan.md'

FAIL removes stale worktree symlinks when the target plan is gone
Error: ENOENT: no such file or directory, open '.../.shipper/open/gone-plan.md'
```

Post-fix (`bun run test src/core/plan-store.test.ts`):
```
Test Files  1 passed (1)
Tests  36 passed (36)
```

Live repo after `listPlans('.')`:
```
symlink exists: .shipper/open/modules-marketplace.md -> ../worktrees/modules-marketplace/.shipper/open/modules-marketplace.md
```
