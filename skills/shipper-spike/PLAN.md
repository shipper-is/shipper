When planning a Shipper Spike you'll follow these steps:

1. Gather just enough context from the existing codebase to try and better understand what the user is asking for. Use parallel subagents to look at different parts of the codebase or angles at once.

2. Use the tool you have available to ask the user clarifying questions about their request. This will help to ensure that the plan is tailored to their specific needs and requirements. The goal is to gain a clear understanding of the user's objectives, push back on anywhere that their request dissents with the existing codebase, and ensure that there is mutual understanding of the outcomes. Even if you don't need clarity from the user on their request you should at least ask if they want a standalone PR created from this spike automatically once the build phase has finished. For branching and frontmatter mechanics, follow [./GIT.md](./GIT.md).

3. Take another pass to gather any additional context that may be relevant now that the user's objectives are clearer. This should include looking up any existing reusable parts of the codebase and common/shared codebase conventions that we should utilize.

At the end of these three steps you should have:
- Enough context to understand the user's request fully
- A good understanding of common conventions within the existing codebase
- A good understanding of which parts of the codebase we need to reuse rather than build our own version
- Some high level pitfalls to watch out for

4. Write a lightweight spike file named after the spike (kebab-case). This file is the single source of truth for the spike's status. Create it in the main checkout's `.shipper/open/`. Follow [./GIT.md](./GIT.md) for branch frontmatter. Format:

```markdown
---
type: spike
branch: shipper/my-spike-name
started_at: "2026-07-04T22:15:00-05:00"
---

# Spike Title

Short overview paragraph describing what this spike accomplishes.

- [ ] First task
- [ ] Second task
```

Use YAML frontmatter at the very top with `type: spike`, `branch`, `base_branch`, and `started_at` (quoted ISO 8601 timestamp) — see GIT.md. No `## Phase` headings are needed — use a flat `- [ ]` task checklist only.

From here you will now move onto the BUILD.md step.