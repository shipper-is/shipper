# shipper-test setup — bootstrapping TESTING.md

This document tells an agent how to bootstrap scenario testing in a repository that has never run it: produce `.shipper/tests/TESTING.md`, the living notepad every future scenario depends on. Setup is complete when `.shipper/tests/TESTING.md` exists — an existing TESTING.md, however it was written, counts. Never overwrite or restructure one that is already there.

**This process is a hard prerequisite.** No scenario test may be scaffolded in a repo without a TESTING.md, because every scenario decision — topology, toolchain pins, seeding strategy, capture method — depends on facts about the repo that must be established once, deliberately, rather than guessed per-scenario.

The output of setup is **only** TESTING.md. Do not scaffold harness scripts, sample scenarios, or workflows during setup; those are copied per-scenario later, following SKILL.md.

The process has three phases, in order: explore, ask, write. Do not skip the exploration phase and lead with a questionnaire — most answers are in the codebase, and asking the user things the repo already answers wastes their time and erodes trust in the questions that matter.

## Phase 1: Explore the codebase

Traverse the repo and establish every fact below that can be established from files alone. Record each finding with the evidence (the file that proves it), and mark it **inferred** — Phase 2 confirms anything load-bearing.

### Application surfaces

What real application instances could a scenario launch and drive?

- Enumerate the apps/packages (workspace manifests: `package.json` workspaces, `pnpm-workspace.yaml`, `turbo.json`, `Cargo.toml`, `go.work`, etc.).
- For each surface, classify it: desktop (Electron/Tauri/native), web server, SPA, mobile (Expo/React Native/native), CLI, headless API/worker.
- For each, find the local launch command (root scripts, per-package `dev`/`start` scripts, README/AGENTS instructions) and what it depends on (which other surfaces must be up, which env files).
- Note the driver each surface implies: CDP/Playwright for Electron and web, simulator/emulator for mobile, plain process + HTTP for APIs and CLIs.

### Backend and data layer

- Database(s) and how they run locally: docker compose files, `supabase/` directories, embedded SQLite, cloud-only.
- Migrations and seed mechanisms: migration folders, seed scripts, fixture factories already in the repo.
- Auth: provider (in-repo, Supabase/Auth0/Clerk/Firebase, custom JWT), and the flows a test would have to traverse — password sign-in, email OTP/magic link, OAuth redirect. OTP and OAuth flows dictate whether the scenario needs a disposable-inbox service or a pre-seeded session.
- Realtime/async machinery a contract might assert on: websockets, pub/sub, queues, webhooks.
- How a privileged actor (service key, admin API, direct SQL) can seed data without going through the product UI.

### Existing test and CI infrastructure

- Existing e2e or integration harnesses anywhere in the repo (common spots: `e2e/`, `tests/`, `scripts/`, `playwright.config.*`, `cypress/`). If a proven harness exists, TESTING.md must point at it as the thing to copy.
- `.github/workflows/` (or other CI config): what already runs, on which runner OS/images, what caching and setup steps exist, any naming conventions.
- Secrets referenced by existing workflows (`secrets.*` occurrences) — this reveals what is already provisioned in CI without asking.
- Toolchain versions pinned anywhere: `.nvmrc`, `engines`, `packageManager`, lockfiles, pinned CLI versions in workflows or docs.

### Environment and configuration

- Env file conventions: `.env.example` files and what each variable is for; which are secrets vs local defaults.
- Anything that behaves differently headless or in CI: keychain/safeStorage usage, GUI permission prompts, display requirements, license activation.
- Repo rules that constrain test infrastructure (AGENTS.md, contributing docs, lint gates, "never do X" constraints). Scenario workflows must not violate them.

### Prior art in documentation

- READMEs, docs folders, and agent instructions that describe how to run the stack locally — these often encode hard-won knowledge that belongs in TESTING.md.

## Phase 2: Ask the user

After exploration, compile **one batch** of questions covering only what the codebase cannot answer. Present inferred facts as statements to confirm ("I found X — correct?") and unknowns as real questions. Do not ask anything Phase 1 already answered.

Topics that usually cannot be inferred and are load-bearing:

1. **CI constraints.** Which runners are available/acceptable (GitHub-hosted Linux? macOS minutes? self-hosted?), and any cost or time budget per run.
2. **Secrets.** Which secrets exist in the CI environment beyond what workflows already reference, and which the user is willing to add for testing.
3. **External services policy.** Are disposable-email services, third-party sandboxes, or other real external services acceptable in CI? Any that are banned?
4. **Data policy.** Is anonymized production-shaped data available and permitted, or synthetic fixtures only?
5. **Which surfaces matter.** Of the surfaces found in Phase 1, which carry the product risk the user wants scenario tests to cover first? (This orders the topology section; it does not exclude the rest.)
6. **Environment quirks the code can't show.** Flows that require a real device, a paid account, a manual approval step, or a service that cannot run locally.
7. **Branch/workflow conventions.** Where may test workflows be published and iterated (feature branches only? never on main?), if the repo's docs don't already say.

If the user's answers contradict an inferred fact, the user wins — but note the discrepancy in TESTING.md so a future agent investigating it has the thread.

## Phase 3: Write TESTING.md

Create `.shipper/tests/TESTING.md`. It documents the **current** repo, states facts with evidence and dates, and is designed to grow (SKILL.md Step 5 owns its ongoing maintenance). Seed it with these sections:

1. **Purpose and philosophy.** Two or three sentences: contract-first ("When actor A does X, actor B observes Y within N seconds — no cheats"), evidence is the product of a run, copy the closest passing scenario instead of inventing plumbing.
2. **Repo topology.** The surfaces from Phase 1: what each is, how to launch it, what it depends on, which driver drives it. Include the default colocated single-runner topology diagram for this repo's stack (backend + app(s) + drivers on one machine, localhost only).
3. **Stack bring-up.** The exact known commands to get the full stack running locally/on CI: backend start, migrations/seed, env files to copy, order of operations, and privileged seeding paths.
4. **Toolchain pins.** Versions found in Phase 1, each marked `confirmed` (proven by an existing green run) or `candidate` (inferred, unverified on CI). First scenarios promote candidates to confirmed.
5. **CI environment.** Runners, available secrets, external-services policy, data policy, and budget — from Phase 2 answers. Note the publish → iterate → retire workflow convention from SKILL.md and any repo-specific branch rules.
6. **Auth and fixtures.** How a scenario mints test users and sessions, which auth flows need real-world inputs (OTP inboxes, OAuth), and the sanctioned seeding mechanism.
7. **Scenario index.** Empty table: slug, one-line contract, last-passed date, run URL.
8. **Failure log.** Empty section with the entry format: date, symptom, root cause, fix. Every environment/harness failure lands here.
9. **Open questions.** Anything still unconfirmed after Phase 2, including any user-vs-inference discrepancies.

Keep entries factual and dated. Do not write aspirations ("we should eventually…") — a future agent needs to distinguish what is proven from what is hoped.

When TESTING.md is written, setup is complete. Tell the user what was inferred, what they confirmed, and what remains open — then scenario work may begin under SKILL.md.
