---
format: 1920x1080
duration: 30s
message: "Grep drowns in .shipper files. The artifact index finds the right one by meaning."
arc: "BAB — before the grep, after the index hit, two proofs, then the install"
audience: "Developers using coding agents on repos full of Shipper plans, spikes, bugs, and reviews"
mode: autonomous
music: none
captions: skipped (no narration)
---

## Video direction

Palette, from `frame.md` frontmatter only: canvas is `cream` `#000000`, type is `ink` `#FFFFFF`, terminal panel is `tile` `#181818`, hairline is ink at low opacity, accent `coral` is also `#FFFFFF`. Shipper has no chromatic brand color. Do not fill the terminal with `navy`, `navy-soft`, or `navy-elev` — those keys flipped light in the dark remix and would paint a paper terminal.

Type roles: Geist for display and body, Geist Mono for every command and path. Paste the `@font-face` block from `frame.md` into each frame. No Google Fonts link.

Motion grammar: long-tail `power3`. On-screen lines are the voiceover. Reveal each phrase when its cue arrives. Never dump the whole terminal at t=0. Holds stay still except a blinking caret. No breathing, no drift, no purple gradients, no lime caret. The installed `code-terminal-run` accent enum is green by default — override `--ctr-accent` to `#FFFFFF`.

Rhythm: frames 1 and 2 are the loud visual pair. Frame 3 is the held type relay. Frame 4 holds on the finished command.

Never: a vector database, cloud embeddings, site chrome, a scraped webpage, or a third benefit. Indexed artifacts are plans, spikes, bugs, and reviews. The hit file is `semantic-search-mcp.md`. The commands are real: `rg`, `shipper_search`, `shipper mcp install`.

Caption band: no captions. Keep important type in the top 83% anyway.

## Frame 1 — Grep fails

- scene: A dark terminal types a grep and prints a useless dump, then the dump collapses into "Zero meaning."
- voiceover: "rg — have we planned this before? 214 files. Zero meaning."
- duration: 7s
- poster: 5.5s
- transition_in: cut
- status: animated
- src: compositions/frames/01-grep-fails.html
- type: pain_point
- persuasion: Pain agitation
- beat: frustration
- blueprint: typewriter-reveal (Adapt)
- focal: code-terminal-run
- roles: code-terminal-run = the typed surface; verdict line = payoff type
- asset_candidates: none — typography-only; customize the installed component, do not add image files
- sfx: none

Adapt: keep the signature — a line types, then the assembly collapses to a point, then a payoff spring-pops. Change the bare typed line into the installed `compositions/components/code-terminal-run.html` panel. Do not use the component's green accent.

Scene 1 (0.0–2.6s): black canvas. The terminal panel springs in at center, about 70% of the frame width, sitting in the upper two-thirds. Only the prompt is alive: `rg "have we planned this before?" .shipper` types behind a white caret. Nothing else is on screen. Centered, two layers (canvas, panel).
Scene 2 (2.6–5.0s): the command executes. Output lines print one at a time — file paths under `.shipper/`, no answer — until the panel feels flooded. The paths are muted ink, not a second color.
Scene 3 (5.0–7.0s): the panel collapses to a point at center and is gone. "Zero meaning." spring-pops in Geist display, centered, and holds still. The caret is gone.

## Frame 2 — The index hits

- scene: The same kind of terminal asks shipper_search and one plan snaps in as the answer.
- voiceover: "shipper_search — have we planned this before? Semantic Search MCP. The plan."
- duration: 10s
- poster: 7.5s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/02-index-hits.html
- type: feature_showcase
- persuasion: Show-don't-tell proof
- beat: relief
- blueprint: prompt-type-submit-generate (Reproduce)
- focal: code-terminal-run
- roles: code-terminal-run = the product surface; result row = the answer
- asset_candidates: none — typography-only; customize the installed component, do not add image files
- sfx: none

Reproduce sub-shape C, search skin, inside `code-terminal-run`. Signature: the command types, then the machine answers with one finished result. No collapse.

Scene 1 (0.0–1.2s): black canvas. The terminal panel is already the hero, centered, same size family as frame 1. A white caret blinks on an empty prompt. No headline.
Scene 2 (1.2–4.4s): `shipper_search "have we planned this before?"` types behind the caret.
Scene 3 (4.4–6.2s): a short beat of working — one status line, `searching .shipper/`, then it clears. Do not show a spinner farm.
Scene 4 (6.2–10.0s): one result row snaps in and holds: `semantic-search-mcp.md` in ink, with a mono kicker `plan · done` beside it. No second result. The caret blinks on a fresh prompt under the hit. Stillness after the snap.

## Frame 3 — Two proofs

- scene: Two full-frame statements, one then the other, on the black field.
- voiceover: "Stays on your machine. Only what changed."
- duration: 6s
- poster: 4.2s
- transition_in: crossfade
- status: animated
- src: compositions/frames/03-two-proofs.html
- type: benefit_highlight
- persuasion: Feature-to-benefit translation
- beat: clarity
- blueprint: kinetic-type-beats (Adapt)
- focal: none — type only
- roles: statement = the only subject
- asset_candidates: none — typography-only
- sfx: none

Adapt the benefits statement-relay: keep the signature — each statement owns the center, builds, holds, then hard-cuts to the next, and the last holds. Change the count from 2–4 to exactly two. No terminal. No third line.

Scene 1 (0.0–2.8s): black field. "Stays on your machine." builds in Geist display, centered in the upper-middle, and holds. A mono kicker under it fades in on the second half of the window: `local embeddings`.
Scene 2 (2.8–6.0s): hard cut. "Only what changed." lands the same way and holds through the end. Mono kicker: `unchanged text is never re-embedded`. Nothing else enters.

## Frame 4 — One call

- scene: The claim steps back and shipper mcp install types into a terminal pill.
- voiceover: "One call. shipper mcp install."
- duration: 7s
- poster: 5.5s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/04-one-call.html
- type: cta
- persuasion: Friction reduction
- beat: motivation
- blueprint: prompt-type-submit-generate (Reproduce)
- focal: code-terminal-run
- roles: headline = demoted claim; code-terminal-run = the ask
- asset_candidates: none — typography-only; customize the installed component, do not add image files
- sfx: none

Reproduce the install-command end card. Signature: the headline demotes, a terminal pill stretches in, the command types, and the caret holds. No submit. No response.

Scene 1 (0.0–1.6s): "One call." sits large, centered, Geist display, on black.
Scene 2 (1.6–3.0s): the headline scales down, lifts into the upper third, and dims to a quieter white. The `code-terminal-run` panel springs in below it and stretches wide.
Scene 3 (3.0–5.4s): `shipper mcp install` types inside the panel behind a white caret.
Scene 4 (5.4–7.0s): the finished command holds. A mono line under the panel fades in: `plans · spikes · bugs · reviews`. Caret blinks. Nothing else moves.
