When planning a Shipper Spike you'll follow these steps:

1. Gather just enough context from the existing codebase to try and better understand what the user is asking for. Use parallel subagents to look at different parts of the codebase or angles at once.

2. Use the tool you have available to ask the user clarifying questions about their request. This will help to ensure that the plan is tailored to their specific needs and requirements. The goal is to gain a clear understanding of the user's objectives, push back on anywhere that their request dissents with the existing codebase, and ensure that there is mutual understanding of the outcomes. Even if you don't need clarity from the user on their request you should at least ask if they want a standalone PR created from this spike automatically once the build phase has finished. You should also always ask (when applicable) if they'd like for this work to be done in a separate worktree to avoid any conflicts with other changes that are being made.

3. Take another pass to gather any additional context that may be relevant now that the user's objectives are clearer. This should include looking up any existing reusable parts of the codebase and common/shared codebase conventions that we should utilize.

At the end of these three steps you should have:
- Enough context to understand the user's request fully
- A good understanding of common conventions within the existing codebase
- A good understanding of which parts of the codebase we need to reuse rather than build our own version
- Some high level pitfalls to watch out for

From here you will now move onto the BUILD.md step.