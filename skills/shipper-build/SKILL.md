---
name: shipper-build
description: Execute a singular phase from an existing Shipper plan in the codebase.
---

The goal of this skill is to take Shipper plans (in the .shipper folder of this repository) and implement a singular phase of the plan to completion.

The user will direct you to which plan they are wanting you to work against. If they don't specify a Phase they want you to work on then you'll need to review the existing plan for what has already been implemented and then ask the user which Phase they'd like for you to work on next using the tool you have available to ask questions to the user.

Once it is determined which Phase you'll be working on your job is to read over the entire plan file (especially the beginning where it gives the overview, related files, existing code to utilize, codebase conventions to follow, and gotchas) and then read over what has already been implemented (if previous engineers have left notes in the plan file) and then read over the phase you'll be implementing.

Before starting a phase, read and follow [./GIT.md](./GIT.md) for branching, commits, frontmatter, and cleanup. If a git repo is initialized, execute that workflow in full before writing application code.

When you begin executing a Phase, ensure the plan file has a YAML frontmatter block at the very top of the file (before the `#` title). Preserve any existing `type` key in the frontmatter (do not remove or change it). For all other frontmatter keys (`branch`, `base_branch`, `started_at`, `completed_at`, `phase_commits`, `pr_url`, `pr_number`), follow GIT.md: set them when instructed, never overwrite keys that earlier phases already set.

From there do your own context gathering/research from the codebase to gain a better understanding of what you'll be needing to do in the execution of the Phase you've been assigned to.

If you need any further clarifications from the user you can use the tool you have to ask the user a question again to gather that information from the user.

The next step is to use the tool you have available to create a todo list to create a todo list that you can keep track of and also to show the user progress on the execution of the Phase you're working on.

You'll then begin executing on each step of the Phase and each Section within the Phase. After you've completed each step that you created in the todo list you should use the tool you have to manage todo lists again to check it off to keep track and show progress to the user.

Once you've completed your Phase execution then you'll make sure all items are checked off the todo checklist and also the checklist that exists in the Phase plan itself (each Section's todo list).

Leave behind a concise "Completion Notes" section at the end of the Phase with important details that future engineers should be keenly aware of when implementing future Phases.

If you have completed the last Phase of the plan and the plan is complete, follow GIT.md for `completed_at`, moving the plan to `done/`, and the final commit.

Use the related [./GIT.md](./GIT.md) reference file for the full git workflow and frontmatter specification.