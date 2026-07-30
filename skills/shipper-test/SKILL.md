---
name: shipper-test
description: Scaffold and run real-scenario tests (real app instances, real data, screen recordings) through GitHub Actions from the .shipper/tests folder. Use when a Shipper plan or PR would otherwise require manual verification steps, when asked to write an e2e/scenario test that goes beyond unit or component tests, or when managing the publish/retire lifecycle of test workflows. Requires one-time setup (SETUP.md) that builds .shipper/tests/TESTING.md before any scenario can be created.
---

The goal of this skill is to replace the manual testing steps a senior engineer would perform on a PR with a repeatable, recorded, evidence-producing test run. A reviewer should be able to assess merge risk by watching a screen replay and checking a green gate job — not by cloning the branch and clicking through the app themselves.

This is not a unit-test or component-test skill. Scenario tests here launch **real application instances** (the actual desktop app, web server, mobile bundle, backend stack) against **real data** (seeded fixtures or anonymized production-shaped snapshots) on a CI runner, drive them the way a user would, and record everything.

## The .shipper/tests folder

All scenario testing lives in `.shipper/tests/` at the repository root:

```
.shipper/tests/
  TESTING.md                    # living notepad — read first, always
  <scenario-slug>/
    workflow.yml                # the GitHub Actions workflow (parked here, not in .github/)
    seed-fixture.mjs            # produce fixture.json (ids, emails, names — real-shaped data)
    start-stack.mjs             # bring up backend + app + helpers, run drivers, tear down
    run-<actor>.mjs             # one script per actor driving a real app instance
    coord-server.mjs            # barriers + structured logs for multi-actor choreography
    package.json + .gitignore   # scenario-local deps (e.g. playwright); ignore node_modules
```

## Step 0: The setup gate (hard requirement)

Before any scenario work, check that `.shipper/tests/TESTING.md` exists. If it does not, **stop — do not scaffold a scenario, a workflow, or any harness script.** Read `SETUP.md` (next to this file) and run its setup process first: explore the codebase, ask the user the architecture questions the codebase can't answer, and produce TESTING.md. Only then return here.

This is not optional and the user cannot waive it mid-task: every downstream decision in this skill (topology, toolchain pins, seeding, capture method) reads from TESTING.md, and a scenario built on guesses instead of established facts burns CI hours and produces evidence nobody can trust. An existing TESTING.md — however it was originally written — satisfies the gate; leave it in place and grow it per Step 5.

## Step 1: Name the contract

Write the product contract in one sentence before any code:

> When actor A does X, actor B observes Y within N seconds — without refresh, restart, or other cheats.

Everything else in the scenario (coord server, fixtures, recordings, workflow YAML) exists only to make that sentence falsifiable. If you cannot write the sentence, you are not ready to write the test.

## Step 2: Read TESTING.md, then copy — don't invent

`TESTING.md` is the accumulated, codebase-specific knowledge of every scenario that came before: known-good toolchain pins, platform quirks, failure classes, and which topology works. Read it in full before writing anything. Then copy the closest existing scenario folder and strip what you don't need (for the first scenario in a repo, copy the harness scripts from a sibling repo that uses this skill rather than writing them from scratch).

The point is to burn almost no time on CI plumbing and spend nearly all of it making the actual test pass. The plumbing problems are already solved; TESTING.md tells you how. General rules that hold across repos:

- **Colocate everything on one runner first.** Backend, app instance(s), and drivers all on localhost. No tunnels, no multi-VM, no cross-runner networking until the colocated version is green — those paths fail in expensive, misleading ways.
- **Three-job topology:** `seed` (build fixture artifact) → `stack` (run everything, upload artifacts `if: always()`) → `report` (gate that requires both `success`, never green on `cancelled`).
- **Pin toolchains** to the versions TESTING.md says are known-good. Unpinned `@latest` CLIs are the top source of mystery failures.
- **Time-box every wait.** Barrier waits get minutes (cold Docker pulls); product assertions get tens of seconds; environment probes get a `timeout`. Never an infinite wait, never an interactive prompt — a GUI PIN/permission dialog on a headless runner hangs the job until the hour times out.
- **Probe preconditions before the real run.** A 60-second fail-fast probe (can the app encrypt? is the display up? is the port free?) turns a 40-minute mystery into a 2-minute answer.
- **Force exits.** Open sockets and app handles keep processes alive after PASS. Drivers print `PASS`/`FAIL` and `process.exit`; the stack SIGTERMs children in teardown.
- **`concurrency: cancel-in-progress: true`** so reruns kill hung predecessors, and a job `timeout-minutes` above worst-case cold start.

## Step 3: Make it observable — recordings and journals

Evidence is the product of the run. Every scenario must upload, `if: always()` so failed and cancelled runs still explain themselves:

- **A screen recording of the full flow.** On Linux runners: ffmpeg `x11grab` of the Xvfb display the app renders to, started before the driver and finalized in teardown. Use the platform-appropriate capture elsewhere (avfoundation on macOS, simulator recording for mobile). This is what the reviewer actually watches.
- **Step screenshots** captured by the driver at each named checkpoint (before/after every meaningful click).
- **A journal JSON** — timestamped step log with a final `pass: true/false` and the error if any.
- **Coord logs** when multiple actors are choreographed.

Drive the real UI, not a simulation of it. For Electron, spawn the app with a remote debugging port and attach Playwright over CDP (drive the same window the recording shows). For web, Playwright against the real running server. For mobile, the simulator/emulator with the real bundle. Prefer role/label-based selectors that match what a user sees.

When the app needs inputs only the real world provides, use real services built for CI: disposable email inboxes (e.g. qack.dev) for signup/OTP flows, seeded auth users for multi-actor flows, production-readonly snapshots (anonymized) when synthetic data would hide the bug.

## Step 4: Publish, run, retire the workflow

GitHub gives no way to organize `.github/workflows/`, so we don't let it accumulate. The canonical home of every scenario's workflow is `.shipper/tests/<scenario>/workflow.yml`. The lifecycle:

1. **Publish.** Copy it to `.github/workflows/shipper-test-<scenario>.yml` (always this prefix — it makes stragglers greppable) and commit. Trigger on `push` to the working branch plus `workflow_dispatch`; remember `workflow_dispatch` only appears in the UI once the file exists on the default branch, so while iterating the trigger is a push (or an empty commit) to the branch.
2. **Iterate.** Push, watch the run (`gh run watch`), download artifacts on failure and debug from the journal/recording/logs — never reshuffle topology based on a guess. Apply fixes to the scripts and to the copy in `.github/workflows/`.
3. **Capture evidence.** When the gate is green, save the run URL, and pull the recording and key screenshots into the PR description (or plan Completion Notes).
4. **Retire.** Sync any workflow changes made during iteration back into `.shipper/tests/<scenario>/workflow.yml`, then delete the `.github/workflows/shipper-test-<scenario>.yml` copy in the same PR or a follow-up commit. The scenario remains fully runnable later by re-publishing.

Only promote a scenario to a permanent resident of `.github/workflows/` (e.g. as a recurring release gate) when the user explicitly decides that; the default is publish → pass → retire.

When the test is attached to a PR: run it on the PR branch so the evidence corresponds to the exact code under review, and link the passing run in the PR body.

## Step 5: Grow TESTING.md — the living notepad

`TESTING.md` must get smarter with every scenario, or every future agent pays the setup tax again. It documents the **current** codebase, not history:

- Every failure caused by environment or harness (not the product) yields a TESTING.md entry: what failed, the exact symptom, the fix, and the date. Example entries from real runs: "Playwright `_electron` first window is blank on CI — attach over CDP instead"; "headless Linux has no unlocked keyring — launch with `--password-store=basic` + the app's e2e env gate"; "CLI ≥2.110 issues ES256 JWTs that private Realtime rejects — pin 2.65.x".
- Keep a scenario index: slug, one-line contract, last-passed date and run URL. A scenario that hasn't passed recently is a liability, not an asset.
- Prune ruthlessly. When the codebase moves and an entry stops being true, update or delete it — stale advice is worse than no advice. State facts with dates, not aspirations.
- Track cost and speed: which excludes/pins/caches got the stack under N minutes, which mail/data services are free vs. rate-limited. Optimize scenarios toward the cheapest configuration that still proves the contract.

A scenario is trustworthy when the gate is green (not cancelled), the journal shows PASS, the recording shows the actual flow, and a rerun stays green.

## How this fits the Shipper framework

- **shipper-plan**: when a plan includes behavior whose verification would otherwise be manual (sign-up flows, multi-user realtime, payment paths, native-app behavior), the plan should name the scenario contract and include a task to build it with this skill.
- **shipper-build / shipper-loop**: a phase may include creating or updating a scenario; treat a green gate run as that phase's test evidence.
- **shipper-ship**: the PR's "How to Verify in 2 Minutes" and "Test & Hardening Evidence" sections should link the passing scenario run and embed its recording/screenshots, replacing manual reviewer steps. Retire the published workflow as part of shipping.
