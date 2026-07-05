---
name: shipper-spike
description: A one off small feature implementation using the Shipper framework
---

The goal of this skill is to implement a small feature request from the user utilizing a condensed version of the Shipper framework.

The Shipper framework follows a simple pattern of:

1. Gather context
2. Clarify the user's request
3. Gather additional context
4. Write out a highly detailed execution plan that gives a junior-level developer enough context and guidance to complete the whole feature
5. Execute the plan one phase at a time

Typically this happens through multiple discrete steps owned by different engineers for large-scope feature requests.

The Shipper Spike is a quicker version of this process where the planning and execution all happen by the same engineer.

The process you should follow is exactly the same as the full Shipper framework above, but you'll only be creating a plan with a single phase. Anything that would require multiple Phases should be handled using the traditional Shipper framework and you should prompt the user to use the "shipper-plan" skill to create a more robust plan for the feature request.

Use the related ./PLAN.md, ./BUILD.md, and ./GIT.md reference files for the detailed process you should follow in each half of this skill.