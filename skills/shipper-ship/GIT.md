This file is the authoritative git workflow for shipper-ship. Read and follow it for branch location and frontmatter writeback.

## Locating the branch

Read `branch` from the plan or spike file frontmatter in `.shipper/done/<filename>.md`.

If the checkout is not on that branch, verify the working tree is clean before switching. If there are unrelated uncommitted changes, ask the user via the question tool (options like commit them, stash them, or abort) instead of proceeding. Record the current branch name, then `git checkout <branch>`.

## Push and PR

From the main checkout on the feature branch:

1. Push the branch to the remote (`git push -u origin HEAD` if not yet tracking).
2. Create the PR with `gh pr create` following the PR description guidance in SKILL.md.
3. Write `pr_url` (full canonical GitHub PR URL) and `pr_number` (integer) into the plan or spike file frontmatter **on the branch**.
4. Commit the frontmatter update and push again.

If ship switched branches to reach the feature branch, check out the previously recorded branch after the frontmatter writeback commit and push.

## Cleanup

Never delete the feature branch during ship.

If ship switched branches during this run, restore the user's original branch as the last action:

```sh
git checkout <previously-recorded-branch>
```
