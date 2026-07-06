This file is the authoritative git workflow for shipper-bug. Read and follow it during the FIX step (Stage 4 onward).

## Branching

At the start of Stage 4 (Fix), if a git repo is initialized, create and check out a branch named `shipper/bug-<short-bug-name>`. Derive the name from the bug filename. Record in the bug file frontmatter:

- `branch`: `shipper/bug-<short-bug-name>`
- `base_branch`: the branch you branched from

## Worktree (Stage 4)

Ask the user whether to work in a separate git worktree to avoid conflicts with other ongoing changes. Use the question tool.

If the user opts **yes**:

1. Ensure `.shipper/worktrees/` is in the repo's `.gitignore`. Add and commit if missing.
2. Create the worktree from the main repo checkout:

   ```sh
   git worktree add .shipper/worktrees/<slug> -b shipper/bug-<short-bug-name>
   ```

   Omit `-b` if the branch already exists.

   `<slug>` can match the bug filename without `.md` (e.g. `login-timeout` for `login-timeout.md`).

3. **Move** the bug file from the main checkout's `.shipper/bugs/open/<filename>.md` into the worktree's `.shipper/bugs/open/<filename>.md` if it is not already there. Create a **symlink** at the original main-checkout path so editor `@` tags can still reach it:

   ```sh
   ln -s "../worktrees/<slug>/.shipper/bugs/open/<filename>.md" .shipper/bugs/open/<filename>.md
   ```

   Run from the repo root.
4. Record `worktree: .shipper/worktrees/<slug>` in the bug file frontmatter.
5. Perform all subsequent fix, test, and close work inside the worktree.

If the user opts **no**, work in the main checkout. Do not set `worktree`.

## Committing

The bug workflow uses a **single commit** for the fix: the code fix, regression test, and bug file updates (Fix and Regression Guard sections) land together in one commit during Stage 5 (Prove). Do not split across multiple commits.

## Completion and cleanup

At Stage 6 (Close):

1. Set `fixed_at` in frontmatter to a quoted ISO 8601 timestamp.
2. Move the bug file from `.shipper/bugs/open/` to `.shipper/bugs/done/`.
3. Commit if the move and timestamp are not already in the fix commit.

If the user requested an automatic PR, invoke shipper-ship **before** worktree cleanup.

If a worktree is in use, remove it as the **last action** from the main repo checkout:

```sh
git -C <main-repo-path> worktree remove .shipper/worktrees/<slug>
```

Do not delete the feature branch.

## Frontmatter reference

```yaml
---
severity: major
reported_at: "2026-07-04T22:15:00-05:00"
branch: shipper/bug-login-timeout
base_branch: main
worktree: .shipper/worktrees/login-timeout
fixed_at: "2026-07-05T01:40:00-05:00"
pr_url: https://github.com/owner/repo/pull/123
pr_number: 123
---
```
