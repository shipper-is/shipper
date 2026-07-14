---
name: shipper-loop
description: Orchestrate the completion of an entire Shipper plan by looping over its phases, spinning up a fresh subagent per phase that executes the shipper-build skill, monitoring each one, and iterating until the plan is done.
---

The goal of this skill is to take an existing Shipper plan (in the .shipper folder of this repository) and drive it to full completion in a single chat. You are the orchestrator: you do not implement phases yourself. For each phase you spin up a brand new subagent that follows the shipper-build skill, you monitor its work, you verify the result, and you move on to the next phase until the plan is complete.

## Step 1: Identify the plan

The user will direct you to which plan they want completed. If they don't specify and there is exactly one plan in `.shipper/open/`, use it. If there are multiple open plans, use the tool you have available to ask the user which plan to run.

## Step 2: Assess plan state

Read the entire plan file. Determine which phases are already complete and which remain by looking at:

- `phase_commits` in the plan frontmatter (phases with a recorded commit are done)
- Checked vs unchecked checkboxes in each phase's sections
- "Completion Notes" sections left behind at the end of completed phases

Also resolve the absolute path to the shipper-build skill files (SKILL.md and GIT.md) — they live alongside this skill in the installed skills directory. You will pass these paths to every subagent.

Determine the git preferences for this run and reuse them for every phase:

- **Branch**: work directly on the currently checked-out branch (the default), unless the user asked for a feature branch or the plan frontmatter already has a `branch` key (in which case use feature-branch mode on that branch).
- **Commits**: commit after each phase (the default), unless the user asked to leave changes uncommitted.

If the user's message stated a preference, honor it without asking.

Then use the tool you have available to create a todo list with one item per remaining phase, so the user can watch progress as the loop runs.

## Step 3: The loop

For each remaining phase, in order, one at a time:

1. **Spin up a brand new subagent.** Never reuse a subagent from a previous phase — each phase gets a fresh one with a clean context. The subagent cannot see this conversation, so its prompt must be self-contained and include:
   - The absolute path to the repository and to the plan file
   - The exact phase number and phase title it is responsible for, and an explicit instruction to implement **only** that phase
   - An instruction to first read and follow the shipper-build skill files at the absolute paths you resolved in Step 2 (SKILL.md and GIT.md), including checking off the plan's checkboxes and writing Completion Notes
   - The git preferences from Step 2, stated explicitly: which branch mode to use (current branch or feature branch) and whether to commit after the phase
   - Any decisions or answers the user has already given that are relevant to this phase
   - An instruction that it cannot ask the user questions: it should make reasonable decisions consistent with the plan and codebase conventions, and clearly report in its final response anything it was blocked on or unsure about

2. **Monitor.** Wait for the subagent to finish and read its final report. Do not start the next phase while a subagent is running — phases share a branch and working tree, so they must never run in parallel.

3. **Verify.** Independently confirm the phase is actually done before moving on:
   - All of the phase's section checkboxes in the plan file are checked
   - A "Completion Notes" section exists at the end of the phase
   - If committing is enabled, a `Phase N: <phase title>` commit exists on the working branch (`git log`)

4. **Iterate.** If verification fails or the subagent reported a blocker:
   - If the gap is something a subagent can fix (unchecked boxes, missing commit, failing tests, incomplete section), spin up a new subagent with a focused prompt describing exactly what is incomplete and how to finish it.
   - If the blocker is a genuine decision only the user can make, use the question tool to ask the user, then relay the answer into a fresh subagent for the phase.
   - After 3 failed attempts on the same phase, stop the loop and report to the user exactly where things stand and what went wrong.

5. Mark the phase's todo item complete and give the user a one or two sentence progress update (what the phase delivered, anything notable from its Completion Notes) before starting the next phase.

## Step 4: Completion

After the final phase's subagent finishes, verify the plan-completion steps from the shipper-build GIT.md were done: `completed_at` is set in frontmatter, the plan file was moved from `.shipper/open/` to `.shipper/done/`, and (if committing is enabled) a final completion commit exists. If any were missed, spin up one last subagent to finish them.

Close out by summarizing for the user: the phases completed, the branch the work lives on (and whether changes were left uncommitted), and that the plan is ready for shipper-ship to open a PR.

## Rules

- You never write application code, edit the plan's checkboxes, or make phase commits yourself — all implementation flows through subagents. The only edits you may make directly are trivial recovery of plan bookkeeping if no subagent is warranted.
- One phase, one subagent, strictly sequential.
- If the working tree has unrelated uncommitted changes before the loop starts, ask the user how to proceed (commit, stash, or abort) before spinning up the first subagent.
