This file is the authoritative git workflow for shipper-ship. Read and follow it for branch location, worktree handling, and frontmatter writeback.

## Locating the branch

Read `branch` and `worktree` from the plan or spike file frontmatter in `.shipper/done/`.

If `worktree` is set and the path exists on disk, operate inside that worktree directory for all git and file edits.

If `worktree` is set but the path no longer exists (cleaned up after build/spike completion), recreate a **temporary** worktree from the main repo checkout:

```sh
git worktree add .shipper/worktrees/<slug> shipper/<slug>
```

Use the branch name from frontmatter (`branch`). Perform frontmatter writeback inside this temporary worktree, then remove it when done.

If `worktree` is not set, work in the main checkout on the feature branch.

## Push and PR

From the resolved working directory (worktree or main checkout):

1. Push the branch to the remote (`git push -u origin HEAD` if not yet tracking).
2. Create the PR with `gh pr create` following the PR description guidance in SKILL.md.
3. Write `pr_url` (full canonical GitHub PR URL) and `pr_number` (integer) into the plan or spike file frontmatter **on the branch**.
4. Commit the frontmatter update and push again.

All of this must complete **before** any worktree removal.

## Cleanup

If you used a pre-existing or temporary worktree, remove it as the **last action** from the main repo checkout:

```sh
git -C <main-repo-path> worktree remove .shipper/worktrees/<slug>
```

Never delete the feature branch during ship.
