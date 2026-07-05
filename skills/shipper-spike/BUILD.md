The BUILD step of the Shipper Spike takes the existing context that you've gathered about the user's request and actually starts the implementation process.

Before you start your work, read the spike file frontmatter and follow [./GIT.md](./GIT.md) for branch location, worktree cwd, and committing. The PLAN step already recorded the user's worktree and auto-PR preferences — do not re-ask unless frontmatter is missing those decisions.

Here are the actions you'll take to complete the BUILD step of the Shipper Spike:

1. Create a Todo List using the tool you have available to create Todo lists
2. Iterate over each step of the todo list checking off each step once you've completed it. Also check off the corresponding `- [ ]` item in the spike markdown file as you complete each task. If it is a commit-worthy amount of work you can commit after each item but if it is a relatively small body of work then you can wait to just commit everything at the end.
3. When all tasks are complete, follow GIT.md: set `completed_at`, move the file from `.shipper/open/` to `.shipper/done/`, and commit.
4. If the user opted for an automatic PR, invoke shipper-ship before worktree cleanup (see GIT.md).
5. If a worktree is in use, remove it as the last action per GIT.md.
6. Return a brief summary back to the user once you've finished implementation with any follow up steps the user needs to take to fully complete their request.

This completes the entire Shipper Spike. The user may follow back up with you in the future but you'll already have enough context to make any follow up adjustments or answer any further questions without needing to rerun the Shipper Spike process.

If the user has opted for you to create a PR automatically from your changes then you should take advantage of the "shipper-ship" skill (if it is installed and available) for additional context on how to format your PR. Shipper-ship's [./GIT.md](../shipper-ship/GIT.md) covers push, frontmatter writeback, and worktree cleanup.