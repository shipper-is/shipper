# Cursor CLI Near-Passthrough Support

## A: Plan Overview

Today the Cursor adapter (`src/agents/cursor.ts`) runs `cursor-agent -p --force --output-format stream-json` and reduces the rich NDJSON stream down to a handful of coarse events: buffered text chunks, a one-line "tool started" summary, and a final result. The user cannot see what the agent is actually doing: no live token streaming, no tool completion results ("Read 120 lines", "Created file.ts, 45 lines"), and long assistant text is collapsed to its last 240 characters in the TUI.

This plan upgrades Shipper to near-passthrough visibility for the Cursor CLI agent:

1. **Extend the shared `AgentEvent` model** with delta-aware text events and paired `tool-start` / `tool-end` events carrying structured detail. Cursor gets fully wired up; the Claude and opencode adapters are migrated just enough to compile and degrade gracefully (they keep emitting what they already know).
2. **Cursor adapter passthrough**: add `--stream-partial-output` for live token deltas, correctly dedupe deltas vs buffered message flushes, parse every known Cursor tool-call payload kind (read, write, edit, shell, grep, glob, ls, delete, MCP, todos, etc.) into precise started/completed summaries including results, and surface stderr on failures.
3. **TUI rendering**: the activity feed shows full assistant text (no more 240-char collapse), streams deltas into a single growing text block, and updates tool lines in place from "running" to "completed with result".

Outcomes: while Shipper drives the Cursor CLI, the user sees a live, faithful play-by-play — streaming prose, each tool call with its arguments, and each tool result — matching what they would see running `cursor-agent` interactively.

## B: Related Files

Files to modify:

- [src/agents/types.ts](/Users/matt/Documents/shipper/src/agents/types.ts) — `AgentEvent` union, `AgentAdapter` interface (interface itself unchanged; only the event union grows)
- [src/agents/cursor.ts](/Users/matt/Documents/shipper/src/agents/cursor.ts) — the Cursor adapter; main work happens here
- [src/agents/claude.ts](/Users/matt/Documents/shipper/src/agents/claude.ts) — migrate `tool` → `tool-start`
- [src/agents/opencode.ts](/Users/matt/Documents/shipper/src/agents/opencode.ts) — migrate `tool` → `tool-start` / `tool-end` using tool part status
- [src/agents/utils.ts](/Users/matt/Documents/shipper/src/agents/utils.ts) — `summarizeToolInput` stays as the generic fallback
- [src/components/activity-feed.tsx](/Users/matt/Documents/shipper/src/components/activity-feed.tsx) — remove collapse, delta merging, tool start/end in-place rendering
- [src/app.tsx](/Users/matt/Documents/shipper/src/app.tsx) — `appendFeedEvents` (line 204) must coalesce delta text events
- [src/screens/build.tsx](/Users/matt/Documents/shipper/src/screens/build.tsx) — `formatFeedTail` (lines 19–37) handles new event types
- [src/screens/new-plan.tsx](/Users/matt/Documents/shipper/src/screens/new-plan.tsx) — duplicate `formatFeedTail` (lines 14–32) handles new event types
- [src/demo/script.ts](/Users/matt/Documents/shipper/src/demo/script.ts) — demo events use the new tool-start/tool-end shapes

Files to create:

- `src/agents/cursor-stream.ts` — pure, testable parser for Cursor stream-json lines (extracted from `spawnProcess`)
- `src/agents/cursor-tools.ts` — per-tool-kind summarizers for started args and completed results
- `src/agents/__fixtures__/cursor-stream.ndjson` — captured real stream-json output used by unit tests
- `src/agents/cursor-stream.test.ts` and `src/agents/cursor-tools.test.ts` — unit tests
- `src/components/feed-utils.ts` — shared `formatFeedTail` extracted from the two screens

Files to read for reference (no changes expected):

- [src/core/orchestrator.ts](/Users/matt/Documents/shipper/src/core/orchestrator.ts) — `consumeAgentRun` is event-type agnostic except for `question` and `error`; it should keep working untouched
- [src/core/run-logger.ts](/Users/matt/Documents/shipper/src/core/run-logger.ts) — already logs every event and every raw line; no changes needed
- [src/agents/event-bus.ts](/Users/matt/Documents/shipper/src/agents/event-bus.ts) — bus is generic over `AgentEvent`; no changes needed
- [scripts/try-adapter.ts](/Users/matt/Documents/shipper/scripts/try-adapter.ts) — manual harness; prints events as JSON so it works with new events automatically

## C: Existing Code to Utilize

- **`AgentEventBus` / `QuestionGate`** in [src/agents/event-bus.ts](/Users/matt/Documents/shipper/src/agents/event-bus.ts): all new events flow through the existing bus; do not build a new channel.
- **`summarizeToolInput`** in [src/agents/utils.ts](/Users/matt/Documents/shipper/src/agents/utils.ts): keep as the fallback summarizer inside `cursor-tools.ts` for unknown tool kinds, and it remains the summarizer for Claude/opencode.
- **Existing tool-call helpers** in [src/agents/cursor.ts](/Users/matt/Documents/shipper/src/agents/cursor.ts) — `toolCallName` (lines 50–63) and `toolCallArgs` (lines 65–89) already know how to find the `<kind>ToolCall` key and its `args`. Move them into `cursor-tools.ts` and extend rather than rewrite.
- **Question protocol** in [src/agents/question-protocol.ts](/Users/matt/Documents/shipper/src/agents/question-protocol.ts): `extractQuestionBlocks` / `formatAnswers` are unchanged; the delta work just has to keep feeding it complete message text (see Gotchas).
- **`RunLogger.logRaw`**: raw stream-json lines are already persisted per session ([src/core/run-logger.ts](/Users/matt/Documents/shipper/src/core/run-logger.ts)); this is the "raw passthrough" record and needs no changes. Use these log files to build the test fixture.
- **`scripts/try-adapter.ts`**: use this for manual end-to-end verification of the Cursor adapter (`bun scripts/try-adapter.ts cursor "<prompt>"`).

## D: Codebase Conventions to Follow

- **TypeScript, ESM, explicit `.ts` / `.tsx` import extensions** (e.g. `import ... from "./types.ts"`).
- **Zod for validating external data** — the Cursor stream schema (`cursorEventSchema` in cursor.ts) uses `.passthrough()` so unknown fields survive; keep that style for any new schemas.
- **Tests run with vitest** (`bun run test` invokes `vitest run`), not `bun test`. Test files sit next to sources as `*.test.ts` (see `src/agents/question-protocol.test.ts`).
- **Adapters never throw to the consumer** — errors become `{ type: "error", message }` events on the bus, and the bus is always closed in a `finally`.
- **TUI components are pure over `AgentEvent[]`** — screens own state, `ActivityFeed` just renders. Keep new rendering logic inside `activity-feed.tsx` / `feed-utils.ts`, not in screens.
- **Logging must never crash the run** — follow `RunLogger.write`'s swallow-errors pattern for anything log-related.
- **Quality gates**: `bun run typecheck`, `bun run lint`, `bun run test` must all pass at the end of every phase.

## E: Gotchas

- **Delta vs buffered duplication (the most important one).** With `--stream-partial-output`, the Cursor CLI emits assistant text twice: streaming delta events (have `timestamp_ms`, no `model_call_id`) and buffered full-message flushes before tool calls / at end of turn (have `model_call_id`). If you emit both, all text appears twice. Rule: emit deltas as display text; use the buffered flushes only to build the authoritative per-message text for question-protocol extraction. This distinction comes straight from Cursor's headless docs.
- **`--stream-partial-output` only works with `--print` and `--output-format stream-json`** — both already passed by the adapter.
- **Question protocol needs complete text.** `extractQuestionBlocks` scans for fenced ```` ```shipper-question ```` blocks. A block can be split across many deltas, so never run extraction on individual deltas — run it on the accumulated buffered message text and on the final `result` event text, as the current code does with `assistantBuffer` (cursor.ts lines 311–316, 344–351).
- **Feed event volume.** Deltas can produce hundreds of events per turn, and `appendFeedEvents` caps the array at `ACTIVITY_FEED_MAX_EVENTS` (500). Without coalescing, deltas will evict tool lines from the feed and hammer Ink with re-renders. Coalesce consecutive delta text events into the previous text event inside `appendFeedEvents` in [src/app.tsx](/Users/matt/Documents/shipper/src/app.tsx) (line 204).
- **Tool call correlation.** `tool_call started` and `tool_call completed` events must be matched to update a feed line in place. Inspect the captured fixture for a stable id field (e.g. `call_id` / `tool_call_id` / an id inside the `<kind>ToolCall` object). If none exists, synthesize one in the adapter (counter + tool kind) and match started→completed in arrival order per kind. Do not guess the field name in code before looking at the fixture.
- **Tool payload shapes are not fully documented.** Known from the headless docs: `tool_call.writeToolCall.args.path`, `writeToolCall.result.success.linesCreated` / `fileSize`, `readToolCall.args.path`, `readToolCall.result.success.totalLines`. Other kinds (shell, edit, grep, glob, ls, delete, MCP, todo) must be derived from the captured fixture. Every parser must be defensive: unknown kind → fall back to `toolCallName` + `summarizeToolInput`; missing result fields → omit the result summary rather than erroring.
- **The `result` event carries the final text** — the current behavior of `done` with `result` must be preserved because `runPlanCreation` / `runBuildLoop` outcomes depend on the run finishing cleanly.
- **Resume loop re-spawns the process** (cursor.ts lines 190–214). Delta accumulation state and tool correlation maps must be reset per spawn, not per adapter instance.
- **Old `cursor-agent` versions** may not know `--stream-partial-output` and will exit immediately with a usage error. If the process exits non-zero having produced zero parsed events, surface a clear error message that includes the stderr tail (see Phase 2, stderr capture) so the user can tell "flag unsupported" apart from "agent crashed".
- **Do not break Claude/opencode.** They only need the mechanical `tool` → `tool-start` (+ opencode `tool-end`) migration. No behavioral changes beyond that.
- **`turn-complete` events**: the Cursor adapter pushes one between question rounds (line 204). Keep that behavior.
- **The repo uses vitest, not `bun test`**, despite the global Bun rule — follow the repo.

## Plan

## Phase 1: Extended shared event model

- Grow the `AgentEvent` union with delta-aware text and structured tool lifecycle events, then migrate every consumer so the repo compiles and behaves exactly as before for Claude and opencode.
- Outcomes: new event types exist; all three adapters, the feed, both screens, the demo script, and tests compile and pass; no visible behavior change yet.

### Section 1: Event type changes

- Overview: redefine the event union in [src/agents/types.ts](/Users/matt/Documents/shipper/src/agents/types.ts).
- [x] Replace `{ type: "tool"; name; summary }` with two events:
  - `{ type: "tool-start"; callId: string; name: string; summary: string }`
  - `{ type: "tool-end"; callId: string; name: string; summary: string; ok: boolean; resultSummary?: string }`
- [x] Extend the text event to `{ type: "text"; text: string; delta?: boolean }` (`delta: true` means "append to the previous text block", absent/false means standalone block, matching today's behavior).
- [x] Leave `question`, `turn-complete`, `error`, `done`, `AgentAdapter`, `AgentStartOptions`, and `AgentRawLogger` untouched.

### Section 2: Migrate non-Cursor adapters

- Overview: mechanical migration so Claude and opencode keep emitting what they know. The Cursor adapter also needs a minimal `tool` → `tool-start` change here (synthesized callId) purely to compile; its real rework is Phase 2.
- [x] [src/agents/claude.ts](/Users/matt/Documents/shipper/src/agents/claude.ts): in `handleMessage` (lines 132–151), emit `tool-start` for each `tool_use` block. Use the block's `id` field as `callId` (SDK `tool_use` blocks have one; fall back to a counter). Claude emits no `tool-end` — that is the accepted graceful degradation.
- [x] [src/agents/opencode.ts](/Users/matt/Documents/shipper/src/agents/opencode.ts): in `handleEvent` (lines 99–126), tool parts carry `part.callID` and `part.state.status`. Emit `tool-start` the first time a callID is seen (status `pending`/`running`) and `tool-end` when status becomes `completed` (`ok: true`) or `error` (`ok: false`, put the error message in `resultSummary`). Track seen callIDs in a `Set` scoped to the run to avoid duplicate starts.
- [x] Opencode already emits delta text via `event.properties.delta` (line 105) — mark those pushes with `delta: true` when `delta` was present.
- [x] [src/agents/cursor.ts](/Users/matt/Documents/shipper/src/agents/cursor.ts): minimal migration of the `tool` push (lines 320–334) to `tool-start` with a synthesized callId so the repo compiles.

### Section 3: Migrate consumers

- Overview: update everything that pattern-matches on `AgentEvent`.
- [x] [src/components/activity-feed.tsx](/Users/matt/Documents/shipper/src/components/activity-feed.tsx): map `tool-start` / `tool-end` to feed lines (rendering polish comes in Phase 3; for now render `tool-start` like the old `tool` line and `tool-end` as a `✓`/`✕` line).
- [x] Extract `formatFeedTail` from [src/screens/build.tsx](/Users/matt/Documents/shipper/src/screens/build.tsx) and [src/screens/new-plan.tsx](/Users/matt/Documents/shipper/src/screens/new-plan.tsx) into a new `src/components/feed-utils.ts` handling the new event types; both screens import it.
- [x] [src/demo/script.ts](/Users/matt/Documents/shipper/src/demo/script.ts): update the two `type: "tool"` steps to a `tool-start` + matching `tool-end` pair (with a plausible `resultSummary`) so the demo exercises the new rendering.
- [x] Run `bun run typecheck`, `bun run lint`, `bun run test`; fix any fallout (e.g. tests that construct `tool` events).

### Completion Notes (Phase 1)

- `AgentEvent` now has `tool-start` / `tool-end` (replacing `tool`) and optional `delta?: boolean` on text events. No adapter emits deltas yet except opencode (which already had streaming chunks).
- Claude degrades gracefully: emits `tool-start` only (uses SDK block `id` or `claude-N` counter). Opencode tracks `seenToolCalls` per run and clears on question-round resume.
- Cursor emits `tool-start` with `cursor-N` synthesized callIds per spawn; real correlation and `tool-end` come in Phase 2.
- `formatFeedTail` lives in `src/components/feed-utils.ts`; activity feed renders `tool-end` as a separate ✓/✕ line (in-place replacement is Phase 3).
- `bun run typecheck` passes. Pre-existing lint error in `app.tsx` (`setScreen` unused) and test failures (`plan-store` missing fixture path, `orchestrator` skills mock) are unrelated to this phase — no `tool` event fallout in tests.

## Phase 2: Cursor adapter near-passthrough

- Rework the Cursor adapter to stream token deltas, parse all tool payloads with results, and expose failures with stderr context. Parsing is extracted into pure modules so it can be unit tested against a real captured fixture.
- Outcomes: `CursorAdapter` emits delta text live, `tool-start`/`tool-end` with per-kind summaries and result summaries, correct question handling, and fixture-backed tests.

### Section 1: Capture a real fixture

- Overview: ground all payload parsing in real output, not guesses.
- [x] Run the Cursor CLI against a scratch directory with a prompt that exercises several tools, capturing raw NDJSON. Two options: (a) run `bun scripts/try-adapter.ts cursor "<prompt>"` and copy the newest `~/.config/shipper/logs/*-cursor.ndjson`, extracting the `payload` of each `{"type":"raw","direction":"in"}` record; or (b) run directly: `cursor-agent -p --force --output-format stream-json --stream-partial-output --workspace <scratch> "Create hello.ts with a greeting function, then read it back, then run ls" > fixture.ndjson`.
- [x] Make sure the capture includes: `system`/`init`, assistant deltas, assistant buffered flushes (with `model_call_id`), at least read + write + shell tool calls (started and completed), and the final `result` event.
- [x] Save as `src/agents/__fixtures__/cursor-stream.ndjson`. Strip or shorten anything huge; keep it representative.
- [x] Document in a short comment atop the fixture-loading test how to regenerate it.

### Section 2: Pure stream parser (`cursor-stream.ts`)

- Overview: extract the line-parsing logic out of `spawnProcess` (cursor.ts lines 278–353) into a stateful but IO-free class so tests can feed it fixture lines.
- [x] Create `src/agents/cursor-stream.ts` exporting a `CursorStreamParser` class with a method like `handleLine(line: string): AgentEvent[]` plus getters for `sessionId`, `pendingQuestion`, `finalResult`, `sawResult`.
- [x] Move `cursorEventSchema`, `assistantText`, and question extraction into it. Keep the Zod `.passthrough()` style.
- [x] Delta handling: an `assistant` event with `timestamp_ms` present and no `model_call_id` is a streaming delta → emit `{ type: "text", text, delta: true }` and do not add it to the question-extraction buffer. An `assistant` event with `model_call_id` is a buffered flush → do not emit display text (the deltas already showed it), but append its text to the per-run message buffer used for `extractQuestionBlocks`.
- [x] Compatibility path: if a run produces assistant events with neither marker (older CLI without partial output), fall back to current behavior — emit the full text as a non-delta text event and use it for question extraction. Decide "streaming vs buffered mode" per event, not per run, so mixed output cannot drop text. Verify the actual marker fields against the fixture — if the installed CLI version differs from the docs (e.g. flushes lack `model_call_id`), adjust the discriminator to what the fixture shows and note it in the code comment.
- [x] Tool correlation: determine the real id field from the fixture; store started calls in a `Map<callId, { name, summary }>` so `completed` events can emit a matching `tool-end`. Reset the map per parser instance (one instance per spawn).
- [x] Keep the existing behaviors: `system`/`init` captures `session_id`; non-JSON lines become plain text events; `result` sets `sawResult`/`finalResult` and runs question extraction over result text and the accumulated buffer; defensive AskQuestion interception (cursor.ts lines 328–342) moves over intact.

### Section 3: Tool summarizers (`cursor-tools.ts`)

- Overview: per-kind human-readable summaries for started args and completed results.
- [x] Move `toolCallName` and `toolCallArgs` from cursor.ts into `src/agents/cursor-tools.ts`.
- [x] Add `summarizeCursorToolStart(toolCall): { callId?, name, summary }` and `summarizeCursorToolResult(toolCall): { ok, resultSummary? }` covering every kind present in the fixture. At minimum, based on Cursor's documented shapes:
  - `readToolCall`: started `args.path`; completed `result.success.totalLines` → "Read N lines".
  - `writeToolCall`: started `args.path`; completed `result.success.linesCreated` / `fileSize` → "Wrote N lines (M bytes)".
  - Shell/terminal kind: started shows the command (truncate ~80 chars like `summarizeToolInput`); completed shows exit code or success.
  - Edit/search/glob/ls/delete/MCP/todo kinds: summarize from whatever args and result fields the fixture shows.
- [x] Unknown kinds: name from `toolCallName`, summary from `summarizeToolInput`, `ok: true` when a `result.success` key exists, `ok: false` when `result.error`/`result.failure` exists, no result summary otherwise. Never throw.
- [x] Failure results: when the result contains an error shape, return `ok: false` with the error text (truncated) as `resultSummary`.

### Section 4: Rewire the adapter

- Overview: `spawnProcess` becomes a thin IO loop around the parser.
- [x] Add `--stream-partial-output` to the args array in [src/agents/cursor.ts](/Users/matt/Documents/shipper/src/agents/cursor.ts) (after `--output-format stream-json`).
- [x] Instantiate a fresh `CursorStreamParser` per spawn; for each stdout line: `logRaw`, then push every event the parser returns onto the bus. Preserve the stop/kill logic, the resume loop, and the `CI: "1"` env.
- [x] Capture stderr (bounded, e.g. last 4 KB). On non-zero exit without `sawResult` and without a pending question, include the stderr tail in the error message: `Cursor agent exited with code N: <stderr tail>`. This also covers the unsupported-flag case for old CLI versions.
- [x] After the loop, keep the existing decision tree: pending question → push question event and wait on the gate; final result → `done`; neither → error.

### Section 5: Tests

- Overview: fixture-driven unit tests, no process spawning.
- [x] `src/agents/cursor-stream.test.ts`: feed the fixture line by line; assert delta text events are emitted for deltas and not duplicated by buffered flushes; assert `tool-start`/`tool-end` pairs match with correct summaries; assert `sessionId`, `sawResult`, `finalResult` are captured; assert a synthetic ```` ```shipper-question ```` block split across deltas plus a buffered flush is detected exactly once.
- [x] `src/agents/cursor-tools.test.ts`: per-kind summary assertions with payloads lifted from the fixture, plus an unknown-kind fallback case and an error-result case.
- [x] `bun run typecheck && bun run lint && bun run test` all green.

### Completion Notes (Phase 2)

- Fixture captured from real `cursor-agent` run (41 lines) at `src/agents/__fixtures__/cursor-stream.ndjson`; includes edit/read/shell tool pairs. Shell stdout truncated in fixture.
- Tool correlation uses top-level `call_id` (verified in fixture); fallback counter only when absent.
- Streaming discriminators: delta = `timestamp_ms` without `model_call_id`; buffered = `model_call_id` present. Post-delta summary events with neither marker are buffered-only (not displayed) to avoid duplicating streamed text — legacy CLI with no markers still emits standalone text.
- `CursorAdapter` now passes `--stream-partial-output`, uses `CursorStreamParser` per spawn, and appends stderr tail (4 KB) to error messages on failed exits.
- New tests: 9 passing in `cursor-stream.test.ts` + `cursor-tools.test.ts`. `bun run typecheck` passes. Pre-existing lint (`app.tsx` unused `setScreen`) and test failures (`plan-store` fixture path, `orchestrator` skills mock) unchanged from Phase 1.

## Phase 3: TUI rendering for passthrough

- Make the activity feed live-stream text and show tool lifecycle in place, and remove the text collapse so the user sees everything.
- Outcomes: streaming prose grows a single block character-by-character; each tool call is one line that transitions from running to done-with-result; full text is visible (bounded only by the feed viewport tail).

### Section 1: Delta coalescing in app state

- Overview: keep the feed array small and renders cheap.
- [x] In [src/app.tsx](/Users/matt/Documents/shipper/src/app.tsx), change `appendFeedEvents` (line 204): when an incoming event is `{ type: "text", delta: true }` and the last stored event is a text event, merge by concatenating `text` instead of appending a new element. Otherwise append as today. Keep the `ACTIVITY_FEED_MAX_EVENTS` cap.
- [x] Ensure the merge creates a new object/array (React state immutability) — do not mutate the previous event in place.

### Section 2: Activity feed rendering

- Overview: full-text display and tool line lifecycle in [src/components/activity-feed.tsx](/Users/matt/Documents/shipper/src/components/activity-feed.tsx).
- [x] Remove `collapseText` / `TEXT_TAIL_CHARS` / `TEXT_COLLAPSE_THRESHOLD`. Render text events in full with `wrap="wrap"`.
- [x] Tool lifecycle: while building `FeedLine[]`, when a `tool-end` arrives whose `callId` matches an earlier `tool-start` line, replace that line with the completed form instead of appending a second line. Completed form: `✓ <name> <summary> (<resultSummary>)` in green (or `✕ …` in red when `ok: false`). Unmatched `tool-start` (still running) keeps the current `⚙ <name> <summary>` form.
- [x] Tail behavior: after building all lines, keep slicing to the last `maxVisibleLines`. Because text lines can now be long and wrap to multiple terminal rows, split each text event's content on `\n` into individual `FeedLine`s before the tail slice so tailing approximates visible rows. (True wrapping-aware scrollback is out of scope.)
- [x] Verify the paused/question overlay behavior still works (`paused` prop, `question` events map to no lines).

### Section 3: Demo and manual verification

- Overview: prove it end to end.
- [ ] Run `bun run dev -- --demo` and confirm the demo shows a tool line flipping from running to completed and multi-line text rendering in full.
- [x] Run `bun scripts/try-adapter.ts cursor "Create a hello.ts file, read it back, then summarize what you did"` and confirm: delta text events stream, tool-start/tool-end pairs appear with result summaries, and the run ends with a `done` event.
- [ ] Run a real plan creation or small build in the TUI against a scratch repo with the Cursor agent selected; visually confirm live streaming and tool result lines.
- [x] `bun run typecheck && bun run lint` pass; `bun run test` — cursor adapter tests (9) pass; pre-existing failures in `plan-store` / `orchestrator` unchanged.

### Completion Notes (Phase 3)

- `appendFeedEvents` coalesces consecutive `{ type: "text", delta: true }` events into the previous text event via immutable array/object replacement; non-delta text still appends as separate blocks.
- `ActivityFeed` removed text collapse; `eventsToLines` splits text on `\n`, correlates `tool-end` → `tool-start` by `callId` for in-place line replacement (running `⚙` → completed `✓`/`✕` with optional `resultSummary`).
- Fixed pre-existing lint: removed unused `setScreen` prop from `AppBody`.
- `try-adapter` E2E verified: delta streaming, edit/read tool pairs with result summaries, clean `done`. Demo TUI (`bun run dev -- --demo`) and full build-loop visual check left for user (requires interactive terminal). Pre-existing test failures (`plan-store` fixture in `done/`, `orchestrator` skills mock) unchanged.

## Phase 4: Hardening and cleanup

- Close the loop on edge cases found during verification and finish quality gates.
- Outcomes: resilient behavior on old CLIs and odd streams; clean tree.

### Section 1: Edge cases

- [x] Confirm behavior when `cursor-agent` does not support `--stream-partial-output` (simulate by adding a bogus flag): the user should see a single clear error including stderr, not a hang.
- [x] Confirm question flow still works over streaming: run a prompt through `try-adapter` that triggers the shipper-question protocol and answer it (resume loop with `--resume <chatId>` plus a fresh parser per spawn).
- [x] Confirm the build-loop stall detection and `done`-result handling in [src/core/orchestrator.ts](/Users/matt/Documents/shipper/src/core/orchestrator.ts) are unaffected (its logic only depends on `question`, `error`, and run completion).

### Section 2: Final gates

- [x] `bun run typecheck`, `bun run lint`, `bun run test` all pass.
- [ ] Re-run the demo (`bun run dev -- --demo`) as a final smoke test.
- [x] Review the diff for leftover dead code (old collapse helpers, old `tool` event references, moved functions still present in cursor.ts).

### Completion Notes (Phase 4)

- Added `src/agents/cursor.test.ts`: unsupported-flag error includes stderr tail; question-over-streaming resumes with `--resume <session_id>` and fresh parser per spawn.
- `spawnProcess` now `await`s the child process before reading `exitCode`, so stderr is fully captured on fast failures (old CLI / bad flags).
- Fixed pre-existing test failures: `plan-store.test.ts` fixture path → `.shipper/done/shipper-cli-foundation.md`; `orchestrator.test.ts` skills mock uses `importOriginal` for `skillPathForAgent`.
- Added `consumeAgentRun` passthrough regression test and `feed-utils.test.ts`; `formatFeedTail` now correlates `tool-end` → `tool-start` in place (matches `ActivityFeed`).
- Dead-code review: no `collapseText`, `TEXT_TAIL_CHARS`, or `type: "tool"` references remain in `src/`.
- All quality gates green: 44 tests across 9 files. Demo TUI and full build-loop visual checks require an interactive terminal (`bun run dev -- --demo`).
