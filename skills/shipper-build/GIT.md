This file is the authoritative git workflow for shipper-build. Read and follow it before starting any phase.

## Choosing where the work happens

There are two modes. The prompt that started this session may state which one to use — follow it. If the prompt says nothing:

- If the plan frontmatter already has a `branch` key, use **feature-branch mode** on that branch (an earlier phase chose it).
- Otherwise, default to **current-branch mode**.

### Current-branch mode (default)

Work directly on whatever branch is currently checked out. Do not create or switch branches, and do not set `branch` or `base_branch` in the plan frontmatter.

### Feature-branch mode

Only use this mode when the prompt or the user explicitly asks for it, or when the plan frontmatter already has a `branch` key.

On **phase 1** (or whenever the plan frontmatter has no `branch` key), create and check out a feature branch named `shipper/<plan-name>` from the current branch. Derive `<plan-name>` from the plan filename (kebab-case, without `.md`). Record both `branch` and `base_branch` in the plan frontmatter:

- `branch`: the feature branch you are on (`shipper/<plan-name>`)
- `base_branch`: the branch you branched from (the current branch name before checkout)

On **later phases**, read `branch` and `base_branch` from the existing frontmatter and stay on that branch. Never re-decide branching on a later phase.

If the checkout is currently on a different branch than frontmatter `branch`, verify the working tree is clean before `git checkout <branch>`. If there are unrelated uncommitted changes, ask the user via the question tool (options like commit them, stash them, or abort) instead of proceeding.

## Timestamps

In either mode, if `started_at` is not set, add it as a quoted ISO 8601 timestamp (e.g. `"2026-07-05T08:35:00-05:00"`). Never overwrite `branch`, `base_branch`, or `started_at` once set.

## Committing

By default, commit after each phase (see below). If the prompt or the user says **not** to commit, skip this entire section: leave all changes uncommitted in the working tree, never run `git commit`, and do not write `phase_commits` to the frontmatter.

### Commit per phase

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
3. If committing is enabled, make a final commit with an appropriate message (e.g. `Complete plan: <plan title>`).

In feature-branch mode, do not delete the feature branch here. The branch persists for PR creation via shipper-ship.

## Frontmatter reference

All keys are optional unless this workflow sets them. Preserve existing keys; never remove `type`.

```yaml
---
type: plan
branch: shipper/my-plan-name
base_branch: main
started_at: "2026-07-04T22:15:00-05:00"
completed_at: "2026-07-05T01:40:00-05:00"
phase_commits:
  1: abc1234
  2: def5678
pr_url: https://github.com/owner/repo/pull/123
pr_number: 123
---
```

- `branch`, `base_branch`: only set in feature-branch mode, during phase 1; never overwrite on later phases. Absent in current-branch mode.
- `phase_commits`: map of phase number (integer key) to short commit sha; each entry is written after that phase's commit, with the frontmatter edit committed later. Absent when committing is disabled.
- `pr_url`, `pr_number`: added by shipper-ship after PR creation; do not set during build phases.
