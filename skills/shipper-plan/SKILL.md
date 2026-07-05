---
name: shipper-plan
description: A custom planning skill to create high-fidelity plans using the Shipper framework
---

The goal of this skill is to create a detailed and comprehensive plan for a feature or task based on the user's limited input. 

This is a READ-ONLY process. You must not make edits, run non-readonly tools, change configs, or commit anything. The only file you're allowed to create is the plan markdown file.

The first step is to gather just enough context from the existing codebase to try and better understand what the user is asking for. Use parallel subagents to look at different parts of the codebase or angles at once.

The second step is to use the tool you have available to ask the user clarifying questions about their request. This will help to ensure that the plan is tailored to their specific needs and requirements. The goal is to gain a clear understanding of the user's objectives, push back on anywhere that their request dissents with the existing codebase, and ensure that there is mutual understanding of the outcomes.

The third step is to take another pass to gather any additional context that may be relevant now that the user's objectives are clearer. This should include looking up any existing reusable parts of the codebase and common/shared codebase conventions that we should utilize.

The fourth step is to create a detailed plan (as a markdown file). It is important that the plan contains a considerable amount of detail because it will be passed down to a junior level developer with minimal understanding of the codebase. It is smart to include specific files that need changing, reusable parts of the codebase that need to be utilized, existing conventions that the codebase follows that need to be upheld, and important caveats or things to watch out for that a junior level developer would miss.

The plan should include all of that information at the beginning of the plan structured in the following sections:

A: Plan Overview
B: Related Files
C: Existing Code to Utilize
D: Codebase Conventions to Follow
E: Gotchas

Following those sections we need a "Plan" section that includes an in-depth task list with checkboxes that follows the pattern of Phases and Sections. Like this:

----
## Phase 1
- overview of phase 1
- list of outcomes
### Section 1
- overview of section 1
- checklist of items to be completed in this section
### Section 2
- overview of section 2
- checklist of items to be completed in this section
----

Plan quality requirements:
- Cite specific files and essential snippets
- Use full-path markdown links for files
- Keep scope proportional to the task
- May use mermaid diagrams for architecture/flows
- No emojis in the plan

The junior engineer will use this plan as a roadmap to see everything that needs to be completed.

The markdown file you create should go in a folder at the root of the repository (committed to the repository) called ".shipper". Inside of this folder there should be an "open" and "done" folders. You'll place this new plan in the "open" folder.