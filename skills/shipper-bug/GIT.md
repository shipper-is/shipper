This file is the authoritative git workflow for shipper-bug. Read and follow it during the FIX step (Stage 4 onward).

## Branching

If the user asked to work directly on the current branch, skip branch creation entirely: stay on the checked-out branch and leave `branch` and `base_branch` unset in the frontmatter (shipper-ship will use the current branch).

Otherwise, at the start of Stage 4 (Fix), if a git repo is initialized, create and check out a branch named `shipper/bug-<short-bug-name>`. Derive the name from the bug filename. Record in the bug file frontmatter:

- `branch`: `shipper/bug-<short-bug-name>`
- `base_branch`: the branch you branched from

If the checkout is currently on a different branch than frontmatter `branch`, verify the working tree is clean before `git checkout <branch>`. If there are unrelated uncommitted changes, ask the user via the question tool (options like commit them, stash them, or abort) instead of proceeding.

## Committing

The bug workflow uses a **single commit** for the fix: the code fix, regression test, and bug file updates (Fix and Regression Guard sections) land together in one commit during Stage 5 (Prove). Do not split across multiple commits.

## Completion and cleanup

At Stage 6 (Close):

1. Set `fixed_at` in frontmatter to a quoted ISO 8601 timestamp.
2. Move the bug file from `.shipper/bugs/open/` to `.shipper/bugs/done/`.
3. Commit if the move and timestamp are not already in the fix commit.

If the user requested an automatic PR, invoke shipper-ship.

Do not delete the feature branch.

## Frontmatter reference

```yaml
---
severity: major
reported_at: "2026-07-04T22:15:00-05:00"
branch: shipper/bug-login-timeout
base_branch: main
fixed_at: "2026-07-05T01:40:00-05:00"
pr_url: https://github.com/owner/repo/pull/123
pr_number: 123
---
```
