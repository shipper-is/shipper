This file is the authoritative git workflow for shipper-spike. Read and follow it during the PLAN and BUILD steps.

## Branching

If the user asked to work directly on the current branch, skip branch creation entirely: stay on the checked-out branch and leave `branch` and `base_branch` unset in the frontmatter (shipper-ship will use the current branch).

Otherwise, when the spike file is first created (PLAN step), create and check out a feature branch named `shipper/<spike-name>` from the current branch. Derive `<spike-name>` from the spike filename (kebab-case, without `.md`). Record in the spike file frontmatter:

- `branch`: the feature branch (`shipper/<spike-name>`)
- `base_branch`: the branch you branched from

Set `started_at` as a quoted ISO 8601 timestamp. Never overwrite `branch`, `base_branch`, or `started_at` once set.

If the checkout is currently on a different branch than frontmatter `branch`, verify the working tree is clean before `git checkout <branch>`. If there are unrelated uncommitted changes, ask the user via the question tool (options like commit them, stash them, or abort) instead of proceeding.

## Committing

Spikes do not use `phase_commits`. Use judgment:

- Commit after individual tasks when the change is commit-worthy.
- Otherwise batch into one commit at the end.

Regardless, the **final state must be fully committed** before handoff to shipper-ship. Nothing uncommitted should remain on the branch.

## Completion and cleanup

When all spike tasks are complete:

1. Set `completed_at` in frontmatter to a quoted ISO 8601 timestamp.
2. Move the spike file from `.shipper/open/` to `.shipper/done/`.
3. Commit the completion.

If the user requested an automatic PR, invoke shipper-ship so `pr_url` and `pr_number` can be written to the spike file on the branch.

Do not delete the feature branch.

## Frontmatter reference

```yaml
---
type: spike
branch: shipper/my-spike-name
base_branch: main
started_at: "2026-07-04T22:15:00-05:00"
completed_at: "2026-07-05T01:40:00-05:00"
pr_url: https://github.com/owner/repo/pull/123
pr_number: 123
---
```
