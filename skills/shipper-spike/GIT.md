This file is the authoritative git workflow for shipper-spike. Read and follow it during the PLAN and BUILD steps.

## Branching

When the spike file is first created (PLAN step), create and check out a feature branch named `shipper/<spike-name>` from the current branch. Derive `<spike-name>` from the spike filename (kebab-case, without `.md`). Record in the spike file frontmatter:

- `branch`: the feature branch (`shipper/<spike-name>`)
- `base_branch`: the branch you branched from

Set `started_at` as a quoted ISO 8601 timestamp. Never overwrite `branch`, `base_branch`, or `started_at` once set.

## Worktree (PLAN step)

During the PLAN step, alongside the auto-PR question, ask the user whether to do this work in a separate git worktree. Use the question tool.

If the user opts **yes**:

1. Ensure `.shipper/worktrees/` is in the repo's `.gitignore`. Add and commit if missing.
2. Create the worktree from the main repo checkout:

   ```sh
   git worktree add .shipper/worktrees/<slug> -b shipper/<slug>
   ```

   Omit `-b` if the branch already exists:

   ```sh
   git worktree add .shipper/worktrees/<slug> shipper/<slug>
   ```

   `<slug>` matches the spike filename without `.md`.

3. Record `worktree: .shipper/worktrees/<slug>` in the spike frontmatter.
4. Create the spike file directly in the **worktree's** `.shipper/open/` — it never lives in the main checkout when a worktree is used. Also create a **symlink** in the main checkout so editor `@` tags can reach it:

   ```sh
   ln -s "../worktrees/<slug>/.shipper/open/<filename>.md" .shipper/open/<filename>.md
   ```

   Run from the repo root. The Shipper console also maintains these symlinks automatically when it loads plans.
5. Perform all subsequent BUILD work inside the worktree.

If the user opts **no**, create the spike file in the main checkout's `.shipper/open/` and work there. Do not set `worktree`.

## Committing

Spikes do not use `phase_commits`. Use judgment:

- Commit after individual tasks when the change is commit-worthy.
- Otherwise batch into one commit at the end.

Regardless, the **final state must be fully committed** before worktree cleanup or handoff to shipper-ship. Nothing uncommitted should remain on the branch.

## Completion and cleanup

When all spike tasks are complete:

1. Set `completed_at` in frontmatter to a quoted ISO 8601 timestamp.
2. Move the spike file from `.shipper/open/` to `.shipper/done/`.
3. Commit the completion.

If the user requested an automatic PR, invoke shipper-ship **before** worktree cleanup so `pr_url` and `pr_number` can be written to the spike file on the branch.

If a worktree is in use, remove it as the **last action** — regardless of PR state — from the main repo checkout:

```sh
git -C <main-repo-path> worktree remove .shipper/worktrees/<slug>
```

Do not delete the feature branch.

## Frontmatter reference

```yaml
---
type: spike
branch: shipper/my-spike-name
base_branch: main
worktree: .shipper/worktrees/my-spike-name
started_at: "2026-07-04T22:15:00-05:00"
completed_at: "2026-07-05T01:40:00-05:00"
pr_url: https://github.com/owner/repo/pull/123
pr_number: 123
---
```
