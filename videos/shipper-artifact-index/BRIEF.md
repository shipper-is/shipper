---
workflow: product-launch-video
flow: automation
storyboard: no
message: "Every plan you ship teaches the next one: /shipper-plan searches your finished plans and carries their gotchas forward."
destination: youtube
aspect: 1920x1080
language: en
audience: "Developers using coding agents on repos full of Shipper plans, spikes, bugs, and reviews"
length: 30s
angle: narrative
narration: no
style_preset: code-editorial
---

## Intent

A dark-terminal promo. Grep runs and fails — too many files, no meaning — then the artifact index snaps the right plan into place. The user asked for that picture: "Dark terminal: grep fails, then the index finds the right artifact." Tone is cool, sharp, and black-and-white, like a terminal, not a feature list. Sell the feature; do not tour the website.

## Customizations

- Invented terminal UI. No website capture.
- On-screen type carries the lines. No spoken narration.
- Keystroke and confirm sounds on the terminal beats, if a local or signed-in sound source exists.
- A short dark electronic bed, tension into a clean resolve, if a music source exists.

## Notes

- Usage status at intake was `unknown` (`unsupported_harness`). Scope stayed with the user: 30s, 16:9, automation, no storyboard review.
- 30 seconds fits the failed grep, the index hit, and two benefits — local embeddings, incremental re-index — not a third beat.
- Shipper's site is `#000000` / `#ffffff`, Geist and Geist Mono, sharp edges. The code-editorial preset is used for its code surface and inverted to that dark ground.
- Index facts to keep true: plans, spikes, bugs, and reviews; local nomic embeddings; nothing leaves the machine; incremental sync re-embeds only changed chunk text; search is one tool call (`shipper_search`) or `shipper search`; `shipper mcp install` registers it.
- Direction left behind: a rapid benefit-card montage.

## v2 — 2026-10-08

User note, verbatim: "I feel like you could have done a better job of picking better words and a use case to portray this update. Do a better job. Recreate it with a workflow of how developers actually use shipper"

Confirmed this round:

- Story: plan reuse. A developer runs `/shipper-plan` in their agent; the skill calls `shipper_search` before planning, reads the done plan it finds, and writes the new plan around that plan's gotcha. The developer never calls search.
- Surface: a Claude Code terminal session.
- Length 30s, 16:9, silent, automation, no sketch review — unchanged from v1.

Grounded in real output from this repo (2026-10-08):

- Query `add a setting so search can skip some folders` returns, in order: Repo and User Configuration, and a Setup Console (0.71), Semantic Search MCP for Shipper Files (0.67), Global Skills Install (0.66).
- The gotcha shown is verbatim from `.shipper/plans/done/repo-and-user-config-setup-console.md` § E: "Do not drop unknown keys on save. A plain z.object strips unknown keys, so saving from the UI would silently delete anything a user typed by hand. Use z.looseObject for every object schema in config files."
- The new plan (`search-exclude-dirs.md`) is illustrative; it does not exist in the repo.

What v1 got wrong: it argued grep versus embeddings, which is an implementation detail. Developers never grep their plans by hand — the skills search for them. v2 shows the workflow and the payoff (a lesson reused) instead.

v1 is archived in `versions/v1/` and its render stays in `renders/`.
