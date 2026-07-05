---
type: plan
branch: shipper/git-first-class-workflow
base_branch: main
started_at: "2026-07-05T08:35:00-05:00"
phase_commits:
  1: 11f6dc1
  2: 96ea099
  3: 453084b
  4: 2c67831
completed_at: "2026-07-05T08:48:00-05:00"
---

# Git as a First-Class Citizen of the Shipper Framework

## A: Plan Overview

Today git behavior is scattered across skill prose: [skills/shipper-build/SKILL.md](/Users/matt/Documents/shipper/skills/shipper-build/SKILL.md) has one sentence about feature branches, [skills/shipper-spike/PLAN.md](/Users/matt/Documents/shipper/skills/shipper-spike/PLAN.md) asks the user about worktrees with no instructions on how to manage them, [skills/shipper-bug/FIX.md](/Users/matt/Documents/shipper/skills/shipper-bug/FIX.md) has its own partial version, and [skills/shipper-plan/SKILL.md](/Users/matt/Documents/shipper/skills/shipper-plan/SKILL.md) says nothing. Nothing describes worktree creation, commit conventions, or cleanup — hence the pile of stale `shipper/*` branches in this repo.

This plan makes the git workflow first-class while keeping Shipper skill-driven. All git decisions and commands stay in skill prose; the console/orchestrator only gains "dumb" plumbing (reading new frontmatter fields, forwarding a worktree path as the session cwd, rendering git state).

The four pillars:

1. **Per-skill `GIT.md` reference files.** `shipper-build`, `shipper-spike`, `shipper-ship`, and `shipper-bug` each get a `GIT.md` tailored to that skill's lifecycle, following the existing multi-file skill pattern (like `shipper-spike`'s `PLAN.md`/`BUILD.md`). `shipper-plan` stays read-only and gets no `GIT.md`.
2. **Worktrees in `.shipper/worktrees/<slug>` (gitignored).** When the user opts into a worktree, the agent creates it inside the repo at `.shipper/worktrees/<slug>` on branch `shipper/<slug>`, works there, and **always deletes the worktree when the plan/spike/bug finishes — regardless of whether the PR has merged**. A worktree can always be recreated later (shipper-ship does exactly this when it needs to write `pr_url` back to a plan whose worktree is gone).
3. **Frontmatter as the git ledger.** New keys written by skills, read by the console: `base_branch`, `worktree` (repo-relative path), and `phase_commits` (phase number → commit sha). Existing keys (`branch`, `pr_url`, `pr_number`) are unchanged.
4. **Worktree-native plan files.** When work happens in a worktree, the live plan/spike file lives in the *worktree's* `.shipper/open|done/`. The console's plan store and watcher learn to aggregate plans across `.shipper/worktrees/*/.shipper/` and dedupe by filename (worktree copy wins).

Decisions already made by the user (do not re-litigate):

- Skills own all git behavior; console is a lightweight wrapper.
- Individual tailored `GIT.md` per skill, not one shared file.
- Worktrees live at `.shipper/worktrees/` and that path is gitignored.
- Worktrees are auto-deleted on completion regardless of PR state.
- Worktree usage remains an explicit question to the user each time (no auto-detection).
- Console scope: cwd forwarding + frontmatter parsing + UI display of branch/worktree/phase commits.

## B: Related Files

Skills (prose changes + new GIT.md files):

- [skills/shipper-build/SKILL.md](/Users/matt/Documents/shipper/skills/shipper-build/SKILL.md) — current git prose lives at line 12; frontmatter spec at lines 30–41
- [skills/shipper-build/GIT.md](/Users/matt/Documents/shipper/skills/shipper-build/GIT.md) — new
- [skills/shipper-spike/PLAN.md](/Users/matt/Documents/shipper/skills/shipper-spike/PLAN.md) — worktree question at step 2, spike file location at step 4
- [skills/shipper-spike/BUILD.md](/Users/matt/Documents/shipper/skills/shipper-spike/BUILD.md) — git prose in the first paragraph and step 2/3
- [skills/shipper-spike/GIT.md](/Users/matt/Documents/shipper/skills/shipper-spike/GIT.md) — new
- [skills/shipper-ship/SKILL.md](/Users/matt/Documents/shipper/skills/shipper-ship/SKILL.md) — PR creation + frontmatter writeback at line 49
- [skills/shipper-ship/GIT.md](/Users/matt/Documents/shipper/skills/shipper-ship/GIT.md) — new
- [skills/shipper-bug/FIX.md](/Users/matt/Documents/shipper/skills/shipper-bug/FIX.md) — git prose at lines 23 and 41
- [skills/shipper-bug/GIT.md](/Users/matt/Documents/shipper/skills/shipper-bug/GIT.md) — new

Console/orchestrator (plumbing + UI):

- [src/core/skills.ts](/Users/matt/Documents/shipper/src/core/skills.ts) — SKILLS map that embeds and installs skill files
- [src/core/plan-store.ts](/Users/matt/Documents/shipper/src/core/plan-store.ts) — `parseFrontmatter`, `PlanMeta`, `listPlans`, `findPlanByFilename`, `watchPlans`
- [src/core/plan-store.test.ts](/Users/matt/Documents/shipper/src/core/plan-store.test.ts) — existing frontmatter/plan parsing tests
- [src/server/plans-watcher.ts](/Users/matt/Documents/shipper/src/server/plans-watcher.ts) — `loadPlanSummary` and `savePlanMarkdown` rebuild paths from `repoPath + folder + filename` (breaks for worktree plans)
- [src/core/orchestrator.ts](/Users/matt/Documents/shipper/src/core/orchestrator.ts) — `runBuildLoop`, `runSpike`, `runFollowUp` all pass `cwd: repoPath` to `adapter.start`
- [src/shared/protocol.ts](/Users/matt/Documents/shipper/src/shared/protocol.ts) — `PlanMetaDto`, `PlanSummary`
- [src/web/components/plan-view.tsx](/Users/matt/Documents/shipper/src/web/components/plan-view.tsx) — `PlanMetaPanel` renders branch/PR/timestamps
- [.gitignore](/Users/matt/Documents/shipper/.gitignore) — needs `.shipper/worktrees/`

## C: Existing Code to Utilize

- **Multi-file skill pattern**: `SKILLS` map in [src/core/skills.ts](/Users/matt/Documents/shipper/src/core/skills.ts) imports each markdown file with `with { type: "text" }` and lists it per skill. Adding a `GIT.md` to a skill means one import + one array entry. Note `skills/shipper-build/PR.md` is currently an empty-but-registered file — follow the registration pattern, not the emptiness.
- **`parseFrontmatter` in plan-store.ts**: already tolerant YAML parsing with typed coercion helpers (`asMetaString`, `asMetaNumber`). Extend it rather than writing a second parser.
- **`PlanFile.path`**: `readPlanFile` already stores the absolute path on each `PlanFile`. Use it (instead of re-joining `repoPath/.shipper/folder/filename`) everywhere a plan file is read or written — this is what makes worktree plans work in `plans-watcher.ts`.
- **`PlanMetaPanel`** in plan-view.tsx: existing row pattern (`plan-meta-row` / `plan-meta-label` / `plan-meta-value`) for displaying new meta fields.
- **Frontmatter examples in `.shipper/done/`**: e.g. [.shipper/done/hero-mobile.md](/Users/matt/Documents/shipper/.shipper/done/hero-mobile.md) shows the current real-world frontmatter shape produced by agents.

## D: Codebase Conventions to Follow

- Skill files are plain instructional markdown with no emojis; SKILL.md carries the YAML `name`/`description` header, reference files (PLAN.md, BUILD.md, FIX.md) do not.
- Skills reference their sibling files as `./GIT.md` relative links (see the last line of [skills/shipper-bug/SKILL.md](/Users/matt/Documents/shipper/skills/shipper-bug/SKILL.md)).
- Tests are colocated `*.test.ts` files run with vitest (`bun run test`). plan-store tests use both real fixture files from `.shipper/done/` and inline markdown strings.
- Strict null-safe types: `PlanMeta` fields are `T | null`, DTOs in protocol.ts mirror core types field-for-field.
- The console never runs git commands. Keep it that way — the only filesystem awareness added is directory scanning and an existence check for the worktree cwd fallback.
- Use `node:fs/promises` and `node:path` imports matching the existing style in plan-store.ts.

## E: Gotchas

- **Chokidar recursion into worktrees.** `watchPlans` currently watches `repoPath/.shipper/**/*.md`. Since worktrees now live *inside* `.shipper/`, that glob would recurse into every worktree's full checkout (including `node_modules/` and `web/node_modules/`, which contain thousands of `.md` files). The watcher must be restricted to exactly: `.shipper/{open,done}/*.md` and `.shipper/worktrees/*/.shipper/{open,done}/*.md`, with everything else ignored. Verify with a manual test that a worktree containing `node_modules` does not blow up the watcher.
- **Do not recurse worktrees-within-worktrees.** Each worktree checkout has its own (empty, gitignored) `.shipper/worktrees/`. Scanning must go exactly one level deep.
- **`git commit --amend` changes the sha.** The `phase_commits` frontmatter cannot be written and then amended into its own commit. Convention: commit the phase work, read the sha, write it into the plan frontmatter, and let that frontmatter edit ride along in the *next* commit (or the final completion commit). Never amend to include it.
- **Cannot remove the worktree you are standing in.** Cleanup must run against the main checkout: `git -C <main-repo-path> worktree remove .shipper/worktrees/<slug>` and must be the *last* git action of the run. Everything must be committed first or removal fails.
- **Untracked vs. committed plan files when adopting a worktree.** A plan created by shipper-plan sits in the main checkout's `.shipper/open/`, usually uncommitted. If the user opts into a worktree at build phase 1, the file must be *moved* (not copied) into the worktree's `.shipper/open/` — if it were committed on the base branch already, the worktree's branch inherits it and the main-checkout copy will persist until merge; the dedup rule (worktree copy wins) handles the display, but the skill must never leave two diverging live copies being edited.
- **YAML integer keys.** `phase_commits:` uses phase numbers as keys. The `yaml` package parses `1:` as the number `1` but depending on options may yield string keys. `parseFrontmatter` must accept both and normalize to a `Record<number, string>`.
- **`savePlanMarkdown` and `loadPlanSummary` rebuild paths.** Both do `join(repoPath, ".shipper", folder, filename)` which is wrong for worktree plans. They must use the `path` already carried on `PlanFile` — this requires threading `path` into `PlanSummary` (protocol change) or re-resolving via `findPlanByFilename` at save time.
- **Worktree plans disappear from the console after cleanup.** Once the worktree is removed, the done plan file exists only on the branch, and reappears in the main checkout's `.shipper/done/` when the PR merges. This is accepted behavior per the user — do not build anything to work around it, but shipper-ship must write `pr_url`/`pr_number` (and any final frontmatter) *before* worktree removal, or recreate a temporary worktree to do so.
- **Filename dedup collisions.** Two different plans could theoretically share a filename (one in main, one in a worktree). Dedup is by filename with the worktree copy winning; document this in code and keep it simple — do not build content hashing.
- **`plan-store.test.ts` reads a real fixture** from `.shipper/done/shipper-cli-foundation.md`. Do not break that fixture's parse expectations when extending frontmatter.
- **The orchestrator session limit and progress tracking** in `runBuildLoop` re-read the plan via `findPlanByFilename` between sessions. Once `listPlans` aggregates worktrees, this keeps working — but only if the aggregation is in `listPlans` itself, not just the watcher.
- **Follow-up sessions must also land in the worktree.** `runFollowUp` runs with `cwd: repoPath` today; if the last plan has a live worktree, follow-ups would edit the wrong checkout. It needs the same cwd resolution as the build loop.

---

## Plan

## Phase 1: Per-skill GIT.md files and skill prose updates

- Write the four tailored `GIT.md` reference files, update each skill's existing prose to delegate to them, and register the new files in the installer.
- Outcomes: every skill has one authoritative, self-consistent git workflow document; the scattered one-liners are replaced by references; `shipper` installs the new files globally; `.shipper/worktrees/` is gitignored in this repo.

### Section 1.1: shipper-build GIT.md

- Create `skills/shipper-build/GIT.md` covering, in lifecycle order:
  - **Branching**: on phase 1 (or whenever frontmatter has no `branch`), create/check out `shipper/<plan-name>` from the current branch; record `branch` and `base_branch` in frontmatter. Later phases must follow the frontmatter, never re-decide.
  - **Worktree question**: on phase 1 only, ask the user (via the question tool) whether to do this work in a separate worktree. If yes: ensure `.shipper/worktrees/` is present in the repo's `.gitignore` (add + commit if missing), run `git worktree add .shipper/worktrees/<slug> -b shipper/<slug>` (or without `-b` if the branch exists), *move* the plan file from the main checkout's `.shipper/open/` into the worktree's `.shipper/open/`, record `worktree: .shipper/worktrees/<slug>` in frontmatter, and perform all subsequent work inside the worktree. Later phases read `worktree` from frontmatter and never ask again.
  - **Commit-per-phase**: after completing a phase, commit everything (including the plan file's checkbox/Completion Notes updates) as `Phase N: <phase title>`. Then read the sha (`git rev-parse --short HEAD`) and record it under `phase_commits` in the frontmatter; that frontmatter edit rides in the next phase's commit or the final completion commit — never amend.
  - **Completion + cleanup**: on the final phase, move the plan to `.shipper/done/`, set `completed_at`, make the final commit. If a worktree is in use, cleanup is the last action of the run: `git -C <main-repo> worktree remove .shipper/worktrees/<slug>`, executed from the main checkout path. The branch is never deleted here.
  - **Frontmatter reference block** showing all keys including the new ones (`base_branch`, `worktree`, `phase_commits` as a map of phase number to short sha).
- [x] Create `skills/shipper-build/GIT.md` with the content above
- [x] Update `skills/shipper-build/SKILL.md`: replace the git sentence (line 12) and the frontmatter spec block (lines 30–41) with a directive to read and follow `./GIT.md` before starting a phase; keep the non-git frontmatter guidance (`started_at`, `completed_at`, preserve-existing-keys rules) consistent with GIT.md

### Section 1.2: shipper-spike GIT.md

- Create `skills/shipper-spike/GIT.md` tailored to the single-engineer spike flow:
  - Same branching (`shipper/<spike-name>`), worktree question (asked during the PLAN step alongside the existing auto-PR question), `.gitignore` guarantee, and worktree creation mechanics as build.
  - **Spike file location**: if a worktree is used, the spike file is created directly in the *worktree's* `.shipper/open/` (it never exists in the main checkout); frontmatter records `worktree` and `base_branch` from the start.
  - **Committing**: keep the existing judgment call (commit per task if commit-worthy, otherwise one commit at the end), but require the final state to be fully committed before cleanup. `phase_commits` is not used for spikes.
  - **Completion + cleanup**: set `completed_at`, move to `done/`, commit; if auto-PR was requested, hand off to shipper-ship *before* cleanup; worktree removal (same `git -C` form) is always the last action regardless of PR state.
- [x] Create `skills/shipper-spike/GIT.md` with the content above
- [x] Update `skills/shipper-spike/PLAN.md`: keep the worktree/auto-PR questions in step 2 but point to `./GIT.md` for the mechanics; amend step 4 so the spike file location depends on the worktree answer
- [x] Update `skills/shipper-spike/BUILD.md`: replace the first paragraph's git prose with a directive to follow `./GIT.md`; add worktree cleanup to the completion steps (after the ship handoff)

### Section 1.3: shipper-ship GIT.md

- Create `skills/shipper-ship/GIT.md` covering:
  - **Locating the branch**: read `branch` and `worktree` from the plan frontmatter. If the worktree path exists, operate there; if not (it was already cleaned up), recreate a temporary worktree with `git worktree add .shipper/worktrees/<slug> shipper/<slug>` to do the frontmatter writeback, and remove it when done.
  - **Push + PR**: push the branch, create the PR with `gh pr create`, then write `pr_url`/`pr_number` into the plan file's frontmatter *on the branch*, commit, and push again — all before any worktree removal.
  - **Cleanup**: remove whatever worktree was used (pre-existing or temporary) as the last action; never delete the branch.
- [x] Create `skills/shipper-ship/GIT.md` with the content above
- [x] Update `skills/shipper-ship/SKILL.md`: point to `./GIT.md` for branch/worktree/writeback mechanics; keep the PR-description content (sections 1–5 and tone guidance) untouched

### Section 1.4: shipper-bug GIT.md

- Create `skills/shipper-bug/GIT.md` tailored to the bug flow:
  - Branch naming `shipper/bug-<short-bug-name>`; `branch` and `base_branch` recorded in the bug file frontmatter (bug files live in `.shipper/bugs/open|done/`).
  - Same worktree question, `.gitignore` guarantee, and creation mechanics; if a worktree is used the bug file lives in the worktree's `.shipper/bugs/open/` and `worktree` is recorded in its frontmatter.
  - Keep the existing one-commit rule from FIX.md (fix + regression test + bug file updates in a single commit).
  - Completion: move bug file to `done/`, commit, optional ship handoff, then worktree removal as the last action.
- [x] Create `skills/shipper-bug/GIT.md` with the content above
- [x] Update `skills/shipper-bug/FIX.md`: replace the git sentences at lines 23 and 41 with directives to follow `./GIT.md` at the corresponding steps
- [x] Update `skills/shipper-bug/CATALOG.md` frontmatter note (line 16) to mention the new keys (`base_branch`, `worktree`) as FIX-step additions

### Section 1.5: Registration and repo hygiene

- [x] Register all four `GIT.md` files in the `SKILLS` map in [src/core/skills.ts](/Users/matt/Documents/shipper/src/core/skills.ts) (import with `with { type: "text" }` + array entry per skill), matching the existing pattern
- [x] Add `.shipper/worktrees/` to this repo's [.gitignore](/Users/matt/Documents/shipper/.gitignore)
- [x] Run `bun run typecheck` and `bun run test` to confirm nothing broke

### Completion Notes

- Added four `GIT.md` reference files under `skills/shipper-{build,spike,ship,bug}/`, each tailored to that skill's lifecycle (branching, worktree opt-in, commits, cleanup).
- Replaced scattered git one-liners in SKILL.md / PLAN.md / BUILD.md / FIX.md with `./GIT.md` directives; also wired GIT.md into shipper-spike and shipper-bug SKILL.md sibling-file lists.
- Registered all four GIT.md files in `src/core/skills.ts` so `installSkillsGlobally` ships them to agent skill dirs.
- Added `.shipper/worktrees/` to `.gitignore`.
- `bun run typecheck` and `bun run test` (96 tests) pass with no changes to runtime code beyond the skills installer map.
- Phase 2 should extend `PlanMeta` / `parseFrontmatter` in `plan-store.ts` — the new frontmatter keys are documented in `skills/shipper-build/GIT.md` but not yet parsed by the console.

## Phase 2: Plan store and watcher worktree awareness

- Teach the core plan store to parse the new frontmatter keys and to aggregate plans across worktrees, and fix every place that rebuilds a plan path by hand.
- Outcomes: `listPlans` returns worktree-native plans deduped by filename; `parseFrontmatter` exposes `baseBranch`, `worktree`, `phaseCommits`; the watcher sees worktree plan edits without recursing into full checkouts; console plan editing works on worktree plans.

### Section 2.1: Frontmatter extensions

- Extend `PlanMeta` in [src/core/plan-store.ts](/Users/matt/Documents/shipper/src/core/plan-store.ts) with `baseBranch: string | null`, `worktree: string | null`, and `phaseCommits: Record<number, string>` (empty object default). Update `emptyPlanMeta()` accordingly.
- In `parseFrontmatter`, read `base_branch`, `worktree`, and `phase_commits`; normalize `phase_commits` keys to numbers whether the YAML parser returns number or string keys, and coerce values with the existing `asMetaString` style (skip non-string values).
- [x] Extend `PlanMeta`, `emptyPlanMeta`, and `parseFrontmatter` with the three new fields
- [x] Mirror the new fields on `PlanMetaDto` in [src/shared/protocol.ts](/Users/matt/Documents/shipper/src/shared/protocol.ts)
- [x] Add `parseFrontmatter` unit tests in [src/core/plan-store.test.ts](/Users/matt/Documents/shipper/src/core/plan-store.test.ts): all three new keys present, `phase_commits` with integer keys, missing keys default correctly, and the existing `.shipper/done/` fixture still parses

### Section 2.2: Worktree-aware listing

- In `listPlans`, after reading the main `.shipper/open|done/` folders, scan `.shipper/worktrees/*/` one level deep; for each directory that contains a `.shipper/` folder, read its `open/` and `done/` plan files with the existing `readPlanFile` machinery (paths resolved against the worktree, not `repoPath`).
- Dedup by filename per folder bucket: if the same filename exists in both the main checkout and a worktree, keep the worktree copy. A plan `open` in a worktree and `done` in main (or vice versa) is not deduped across buckets — worktree copy still wins by removing the main-checkout duplicate from whichever bucket it is in.
- Add an `origin: "main" | "worktree"` field to `PlanFile` so tests and dedup logic are explicit.
- [x] Implement worktree scanning + filename dedup in `listPlans` (and therefore `findPlanByFilename`)
- [x] Add tests using temp directories (no real git needed — just the directory layout `.shipper/worktrees/<slug>/.shipper/open/x.md`): worktree plan appears, dedup prefers worktree copy, nested `.shipper/worktrees/` inside a worktree is not scanned
- [x] Verify `runBuildLoop`'s between-session re-reads (via `findPlanByFilename`) pick up worktree plan progress — covered implicitly by the tests above; note it in Completion Notes

### Section 2.3: Watcher scope and path correctness

- Replace the `watchPlans` glob in plan-store.ts with explicit patterns: `join(repoPath, ".shipper", "open", "*.md")`, `join(repoPath, ".shipper", "done", "*.md")`, `join(repoPath, ".shipper", "worktrees", "*", ".shipper", "open", "*.md")`, and the matching `done` pattern. Confirm chokidar does not traverse worktree checkouts outside those paths (use `ignored` if needed).
- In [src/server/plans-watcher.ts](/Users/matt/Documents/shipper/src/server/plans-watcher.ts), stop rebuilding paths: `loadPlanSummary` must read from `plan.path`, and `savePlanMarkdown` must resolve the target through the current snapshot's plan `path` (thread `path` onto `PlanSummary` in protocol.ts — it is server-internal data the web client can ignore, or re-resolve via `findPlanByFilename` at save time; prefer threading `path` for one lookup).
- [x] Narrow the `watchPlans` patterns and verify no worktree-checkout traversal
- [x] Fix `loadPlanSummary` and `savePlanMarkdown` to use the real plan path; update `PlanSummary`/protocol as needed
- [x] Extend [src/server/plans-watcher.test.ts](/Users/matt/Documents/shipper/src/server/plans-watcher.test.ts) to cover saving/loading a worktree-located plan
- [x] Run `bun run typecheck` and `bun run test`

### Completion Notes

- Extended `PlanMeta` / `PlanMetaDto` with `baseBranch`, `worktree`, and `phaseCommits`; `parseFrontmatter` normalizes `phase_commits` keys to numbers and skips invalid entries.
- `PlanFile` now carries `origin: "main" | "worktree"`; `listPlans` scans `.shipper/worktrees/*/.shipper/{open,done}` one level deep and dedupes by filename (worktree copy wins).
- `watchPlans` uses four explicit globs instead of `.shipper/**/*.md`, avoiding recursion into worktree checkouts (e.g. `node_modules`).
- `PlanSummary` threads `path`; `loadPlanSummary` and `savePlanMarkdown` read/write via that path so worktree plans edit correctly in the console.
- `findPlanByFilename` inherits worktree awareness from `listPlans`, so `runBuildLoop` between-session re-reads will resolve worktree plans once Phase 3 forwards cwd.
- 105 tests pass (`bun run typecheck` + `bun run test`).

## Phase 3: Orchestrator cwd forwarding

- Sessions for a plan with a live worktree must run inside that worktree; everything else stays untouched.
- Outcomes: build-loop sessions, and follow-up sessions tied to a worktree plan, execute with `cwd` set to the worktree; missing worktrees fall back to the main repo path silently.

### Section 3.1: Worktree cwd resolution

- Add a small helper in [src/core/orchestrator.ts](/Users/matt/Documents/shipper/src/core/orchestrator.ts) (or plan-store.ts): given `repoPath` and a `PlanFile`, return the session cwd — `join(repoPath, meta.worktree)` if `meta.worktree` is set and the directory exists (`node:fs` existence check), otherwise `repoPath`. No git commands.
- In `runBuildLoop`, resolve the cwd from the freshly-read plan on every loop iteration (the worktree can appear after phase 1 creates it, and disappear after the final phase removes it) and pass it to `adapter.start` instead of `repoPath`.
- In `runFollowUp`, when `options.planFilename` resolves to a plan, apply the same resolution. Follow-ups resumed by session id (`resumeSessionId`) should also resolve the plan when a filename is available; when no plan is known, keep `repoPath`.
- `runSpike` and `runPlanCreation` intentionally keep `cwd: repoPath` — the spike agent creates and enters the worktree itself mid-run, and planning never uses one.
- [x] Add the cwd resolution helper with a unit test (worktree set + exists, set + missing, unset)
- [x] Thread resolved cwd through `runBuildLoop` per-iteration and `runFollowUp`
- [x] Update/extend [src/core/orchestrator.test.ts](/Users/matt/Documents/shipper/src/core/orchestrator.test.ts) to assert the cwd passed to the adapter for a worktree plan
- [x] Run `bun run typecheck` and `bun run test`

### Completion Notes

- Added `resolvePlanSessionCwd` in `plan-store.ts`: returns `join(repoPath, meta.worktree)` when the worktree path exists on disk, otherwise `repoPath`. No git commands.
- `runBuildLoop` resolves cwd from the freshly-read plan on every iteration before `adapter.start`.
- `runFollowUp` resolves cwd whenever `planFilename` is provided (including when resuming by session id); falls back to `repoPath` when no plan is known.
- `runSpike` and `runPlanCreation` unchanged — spikes create worktrees mid-run; planning never uses one.
- Five new tests: three for the helper, one build-loop cwd assertion, one follow-up cwd assertion with resume + planFilename.
- 110 tests pass (`bun run typecheck` + `bun run test`).

## Phase 4: Console UI for git state

- Surface the git ledger in the plan view so branches, worktrees, and per-phase commits are visible.
- Outcomes: the plan meta panel shows base branch and worktree; each completed phase shows its commit sha.

### Section 4.1: Plan meta panel and phase commits

- In [src/web/components/plan-view.tsx](/Users/matt/Documents/shipper/src/web/components/plan-view.tsx):
  - Add `Base` and `Worktree` rows to `PlanMetaPanel` following the existing `plan-meta-row` pattern (render only when non-null, like `branch`). Update `hasMeta` to include the new fields.
  - In the phase tracker, when `plan.meta.phaseCommits[phase.number]` exists, render the short sha as a `<code>` element in the phase heading (after the counts). No links — the console does not know the remote URL, and guessing it is out of scope.
- Styling: reuse existing classes in [src/web/styles.css](/Users/matt/Documents/shipper/src/web/styles.css); add at most a small class for the sha badge consistent with the current look.
- [x] Render `baseBranch` and `worktree` rows in `PlanMetaPanel`
- [x] Render per-phase commit shas in the phase tracker
- [x] Verify with the demo/dev console (`bun run dev`) against a hand-written plan file containing the full new frontmatter, including a worktree-located plan
- [x] Run `bun run typecheck`, `bun run lint`, and `bun run test`

### Completion Notes

- `PlanMetaPanel` shows `Base` and `Worktree` rows when `baseBranch` / `worktree` are set in frontmatter, following the existing branch row pattern.
- Phase tracker renders each phase's short commit sha from `meta.phaseCommits` as a `phase-commit-sha` badge after the task counts.
- Verified `loadPlansSnapshot` surfaces `baseBranch` and `phaseCommits` for the live `git-first-class-workflow.md` plan (phases 1–3 shas render; no worktree on this plan).
- `bun run typecheck`, `bun run lint`, and `bun run test` (110 tests) pass.
