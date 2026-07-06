This file is the authoritative git workflow for shipper-build. Read and follow it before starting any phase.

## Branching

On **phase 1** (or whenever the plan frontmatter has no `branch` key), create and check out a feature branch named `shipper/<plan-name>` from the current branch. Derive `<plan-name>` from the plan filename (kebab-case, without `.md`). Record both `branch` and `base_branch` in the plan frontmatter:

- `branch`: the feature branch you are on (`shipper/<plan-name>`)
- `base_branch`: the branch you branched from (the current branch name before checkout)

On **later phases**, read `branch` and `base_branch` from the existing frontmatter and stay on that branch. Never re-decide branching on a later phase.

If `started_at` is not set, add it as a quoted ISO 8601 timestamp (e.g. `"2026-07-05T08:35:00-05:00"`). Never overwrite `branch`, `base_branch`, or `started_at` once set.

## Worktree (phase 1 only)

On **phase 1 only**, use the question tool to ask the user whether to do this work in a separate git worktree to avoid conflicts with other ongoing changes. Later phases read `worktree` from frontmatter and never ask again.

If the user opts **yes**:

1. Ensure `.shipper/worktrees/` is listed in the repo's `.gitignore`. If it is missing, add it and commit that change on the feature branch before creating the worktree.
2. Create the worktree from the **main repo checkout** (not from inside another worktree):

   ```sh
   git worktree add .shipper/worktrees/<slug> -b shipper/<slug>
   ```

   Use `-b shipper/<slug>` only when the branch does not exist yet. If the branch already exists, omit `-b`:

   ```sh
   git worktree add .shipper/worktrees/<slug> shipper/<slug>
   ```

   `<slug>` matches the plan filename without `.md`.

3. **Move** (do not copy) the plan file from the main checkout's `.shipper/open/<filename>.md` into the worktree's `.shipper/open/<filename>.md`. Create `.shipper/open/` in the worktree if needed. Then create a **symlink** in the main checkout's `.shipper/open/` so editor `@` tags can still reach the plan:

   ```sh
   ln -s "../worktrees/<slug>/.shipper/open/<filename>.md" .shipper/open/<filename>.md
   ```

   Run from the repo root. When the plan later moves to `done`, recreate the symlink under `.shipper/done/` pointing at the worktree's `.shipper/done/<filename>.md` and remove the open symlink. The Shipper console maintains these symlinks automatically when it loads plans.
4. Record `worktree: .shipper/worktrees/<slug>` in the plan frontmatter (repo-relative path).
5. Perform all subsequent work inside the worktree directory. Treat the worktree as the session root for file edits, commits, and terminal commands.

If the user opts **no**, work in the main checkout on the feature branch. Do not set `worktree` in frontmatter.

## Commit per phase

After completing a phase (all section checkboxes checked, Completion Notes written):

1. Stage and commit everything for that phase — including plan file checkbox updates and Completion Notes — with message:

   ```
   Phase N: <phase title>
   ```

   Use the phase number and the `## Phase N:` heading title from the plan.

2. Read the short commit sha:

   ```sh
   git rev-parse --short HEAD
   ```

3. Add or update `phase_commits` in the plan frontmatter, mapping the phase number to that short sha. This frontmatter edit is **not** part of the phase commit — it rides along in the next phase's commit or the final completion commit. **Never** use `git commit --amend` to include it; amending would change the sha you just recorded.

## Completion and cleanup

When you complete the **final phase** of the plan:

1. Set `completed_at` in frontmatter to the current time as a quoted ISO 8601 timestamp.
2. Move the plan file from `.shipper/open/` to `.shipper/done/`.
3. Make a final commit with an appropriate message (e.g. `Complete plan: <plan title>`).

If a worktree is in use, **worktree removal is the last action** of the run — after all commits are done. Run it from the main repo checkout, not from inside the worktree:

```sh
git -C <main-repo-path> worktree remove .shipper/worktrees/<slug>
```

Remove any `.shipper/open/<filename>.md` or `.shipper/done/<filename>.md` symlinks that pointed into the worktree (the console also cleans stale symlinks automatically).

Do not delete the feature branch here. The branch persists for PR creation via shipper-ship.

## Frontmatter reference

All keys are optional unless this workflow sets them. Preserve existing keys; never remove `type`.

```yaml
---
type: plan
branch: shipper/my-plan-name
base_branch: main
worktree: .shipper/worktrees/my-plan-name
started_at: "2026-07-04T22:15:00-05:00"
completed_at: "2026-07-05T01:40:00-05:00"
phase_commits:
  1: abc1234
  2: def5678
pr_url: https://github.com/owner/repo/pull/123
pr_number: 123
---
```

- `branch`, `base_branch`, `worktree`: set during phase 1 per sections above; never overwrite on later phases.
- `phase_commits`: map of phase number (integer key) to short commit sha; each entry is written after that phase's commit, with the frontmatter edit committed later.
- `pr_url`, `pr_number`: added by shipper-ship after PR creation; do not set during build phases.
