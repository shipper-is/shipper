---
format: 1920x1080
duration: 30s
message: "Every plan you ship teaches the next one: /shipper-plan searches your finished plans and carries their gotchas forward."
arc: "Demo Loop — the ask, the search, the lesson found, the plan built on it, the payoff, the install"
audience: "Developers who plan and build features with Shipper skills in Claude Code, Cursor, or opencode"
mode: autonomous
version: 2
music: none
captions: skipped (no narration)
---

## Changes from v1

2026-10-08, user note, verbatim: "I feel like you could have done a better job of picking better words and a use case to portray this update. Do a better job. Recreate it with a workflow of how developers actually use shipper"

- v1 staged grep versus the index. Nobody greps their plans by hand; the skills do the searching. Dropped.
- v2 follows the real workflow: `/shipper-plan` in Claude Code, which calls `shipper_search` first, reads the top done plan, and plans around its gotcha.
- Search results and the gotcha are real output from this repo. The new plan file is illustrative.
- v1 frames, index, and storyboard are archived in `versions/v1/`.

## Video direction

Palette: canvas `#000000`, type `#FFFFFF`, terminal surface `#111111`, hairlines white at 12–16%. Dim text is white at 45–60%. Highlights are a white wash at 12–14% behind the row. No color accents.

Type: Geist for captions and the end-card line, Geist Mono for everything inside the terminal. Local `@font-face` from `frame.md`.

One world: a single Claude Code window holds for the whole session frame. Output arrives line by line, and old lines leave through the top edge of the window as a terminal scrolls. The window never moves, cuts, or zooms.

Captions sit above the window, one at a time, and each lands when the terminal reaches the moment it names. The last session caption is a held read; the rest of the transcript dims so the carried-forward gotcha is the only lit thing on screen.

Never: invented search scores or results, a fake company, color-coded syntax, a spinner farm, a vector-database claim.

## Frame 1 — The session

- scene: A developer runs /shipper-plan in Claude Code; the skill searches finished plans, reads the gotcha, and writes the new plan around it.
- voiceover: "Start a plan the way you always do. First, it checks what your team already shipped. It finds the gotcha you wrote down last time. Then it plans around it. Nobody had to remember. The last plan did."
- duration: 24s
- poster: 20s
- transition_in: cut
- status: animated
- src: compositions/frames/01-session.html
- type: feature_showcase
- persuasion: Show-don't-tell proof
- beat: curiosity → relief
- blueprint: prompt-type-submit-generate (Adapt)
- asset_candidates: none — rebuilt Claude Code terminal, typography only

Adapt: sub-shape B, the full generate loop, in a terminal skin. Keep the signature: the ask types, the machine visibly works, the answer builds line by line. Change: the answer is a chain of tool calls, and the payoff is one highlighted lesson, not a generated artifact.

Scene 1 (0.0–5.4s): Caption "Start a plan the way you always do." The Claude Code welcome box sits at the top of the transcript. `/shipper-plan add a setting so search can skip some folders` types into the input box and submits at 4.0s. The prompt moves into the transcript; the agent says it will check what the repo already planned; the status line starts.
Scene 2 (5.6–9.2s): Caption "First, it checks what your team already shipped." The `shipper_search` call prints, then the three real results arrive one by one. The top result, Repo and User Configuration, and a Setup Console, lights up.
Scene 3 (9.5–13.0s): Caption "It finds the gotcha you wrote down last time." `shipper_get_doc` opens that plan; `## E: Gotchas` and the verbatim z.looseObject gotcha print. The transcript scrolls one line per new line. The gotcha lights up.
Scene 4 (13.3–18.8s): Caption "Then it plans around it." `Write(.shipper/plans/open/search-exclude-dirs.md)` runs; the agent's summary names the gotcha it carried forward and the plan it came from. The summary lights up. The status line ends.
Scene 5 (19.1–24.0s): Caption "Nobody had to remember. The last plan did." Everything but the summary dims. Held read.

## Frame 2 — The install

- scene: The line lands, then shipper mcp install types into a terminal pill.
- voiceover: "Every plan you ship teaches the next one. shipper mcp install."
- duration: 6s
- poster: 5s
- transition_in: cut
- status: animated
- src: compositions/frames/02-install.html
- type: cta
- persuasion: Friction reduction
- beat: motivation
- blueprint: prompt-type-submit-generate (Reproduce)
- asset_candidates: none — typography only

Reproduce the install-command end card.

Scene 1 (0.0–1.4s): "Every plan you ship teaches the next one." rises in, centered in the upper half.
Scene 2 (1.4–3.6s): A terminal pill springs open under it; `shipper mcp install` types behind a white caret.
Scene 3 (3.6–6.0s): Under the pill, "Local search across plans, spikes, bugs, and reviews." then `shipper.is`. The caret blinks; nothing else moves.
