---
type: plan
branch: shipper/global-skills-install
started_at: "2026-07-04T23:37:00-05:00"
completed_at: "2026-07-05T00:06:00-05:00"
pr_url: https://github.com/shipper-is/shipper/pull/10
pr_number: 10
---

# Global Skills Install

## A: Plan Overview

Today the compiled `shipper` binary embeds three skills (`shipper-plan`, `shipper-build`, `shipper-spike`) and writes them into the **target repository's** agent skill folders (`.cursor/skills/`, `.claude/skills/`, `.opencode/skill/`) right before each agent run. This plan changes the model to a **global, machine-level install**:

1. Embed **all five** skills (`shipper-plan`, `shipper-build`, `shipper-spike`, `shipper-bug`, `shipper-ship`) with **all** of their supporting files (`PLAN.md`, `BUILD.md`, `PR.md`, `CATALOG.md`, `FIX.md`) into the binary.
2. On every `shipper` startup, detect which agents are installed on the machine and write the skills into each detected agent's **user-level (global)** skill directory, overwriting stale copies so the global skills always match the binary version.
3. Add a `shipper skills` subcommand so users can install/refresh the global skills without starting the web console at all — enabling the "just use the skills directly in your own coding agent" flow.
4. Stop writing skills into target repositories entirely, and clean up shipper-owned skill folders previously written into repos so agents don't load stale duplicates.
5. Update the agent prompts, which currently instruct the agent to read the skill "in the target repository", to point at the global path instead.

Global skill directories per agent (all natively auto-discovered by each agent):

| Agent | Global skills directory |
|-------|------------------------|
| Claude Code | `~/.claude/skills/<name>/` |
| Cursor CLI | `~/.cursor/skills/<name>/` |
| opencode | `~/.config/opencode/skills/<name>/` (respect `$XDG_CONFIG_HOME` like [src/core/config.ts](/Users/matt/Documents/shipper/src/core/config.ts) does) |

## B: Related Files

- [src/core/skills.ts](/Users/matt/Documents/shipper/src/core/skills.ts) — the heart of the change. Currently embeds 3 skills via Bun text imports, has `skillDirForAgent`/`skillPathForAgent` (repo-relative), `writeSkillIfChanged`, and `installSkills(targetRepo, agent)`.
- [src/core/prompts.ts](/Users/matt/Documents/shipper/src/core/prompts.ts) — `skillInstruction()` builds the "Read and follow the skill at `<path>` in the target repository" line used by every prompt. Must point at the absolute global path.
- [src/core/orchestrator.ts](/Users/matt/Documents/shipper/src/core/orchestrator.ts) — calls `installSkills(repoPath, agent)` in three places (`runPlanCreation` ~line 208, `runSpike` ~line 256, `runBuildLoop` ~line 383) before starting an agent session.
- [src/index.ts](/Users/matt/Documents/shipper/src/index.ts) — CLI entrypoint (commander). Gets the startup install hook and the new `skills` subcommand.
- [src/agents/detect.ts](/Users/matt/Documents/shipper/src/agents/detect.ts) — `detectAgents()` probes for `claude`, `cursor-agent`/`agent`, and `opencode` binaries. Reuse to decide which agents get global skills.
- [src/core/core.test.ts](/Users/matt/Documents/shipper/src/core/core.test.ts) — existing `installSkills` tests (write paths, idempotency, multi-file spike skill). Must be rewritten for the global model.
- [src/core/orchestrator.test.ts](/Users/matt/Documents/shipper/src/core/orchestrator.test.ts) — mocks `installSkills`; the mock target renames with the API.
- [skills/](/Users/matt/Documents/shipper/skills) — source of truth for all 10 skill files across 5 skills.
- [README.md](/Users/matt/Documents/shipper/README.md) — "Where things live" section and skills paragraph (line 67) document the per-repo install and must be updated.

## C: Existing Code to Utilize

- **Bun text imports** — the established embedding pattern, already used at the top of [src/core/skills.ts](/Users/matt/Documents/shipper/src/core/skills.ts):

```1:7:src/core/skills.ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import planSkill from "../../skills/shipper-plan/SKILL.md" with { type: "text" };
import buildSkill from "../../skills/shipper-build/SKILL.md" with { type: "text" };
import spikeSkill from "../../skills/shipper-spike/SKILL.md" with { type: "text" };
import spikePlan from "../../skills/shipper-spike/PLAN.md" with { type: "text" };
import spikeBuild from "../../skills/shipper-spike/BUILD.md" with { type: "text" };
```

- **`writeSkillIfChanged`** in the same file — read/compare/write logic that already gives us "overwrite only when content differs". Keep it, just feed it absolute paths.
- **XDG-aware config dir resolution** — copy the pattern from `configDir()` in [src/core/config.ts](/Users/matt/Documents/shipper/src/core/config.ts) (checks `XDG_CONFIG_HOME`, falls back to `join(homedir(), ".config")`) for the opencode global path.
- **`detectAgents()`** in [src/agents/detect.ts](/Users/matt/Documents/shipper/src/agents/detect.ts) — returns `DetectedAgent[]` with `kind`; results are cached per process, so calling it at startup and again later is cheap.
- **commander** — already a dependency and configured in [src/index.ts](/Users/matt/Documents/shipper/src/index.ts).

## D: Codebase Conventions to Follow

- Bun-first: `bun test` is wired through vitest (`bun run test`), builds via `bun build --compile`. No new dependencies needed.
- `node:fs/promises` + `node:path` imports (see `skills.ts`, `config.ts`) — do not switch to `Bun.file` here; stay consistent with the module you are editing.
- Relative imports carry explicit `.ts` extensions (e.g. `import ... from "./skills.ts"`).
- Types via `z.infer` / `as const satisfies` patterns already used in `skills.ts` and `config.ts`.
- Tests colocate next to source (`core.test.ts`, `orchestrator.test.ts`) and use `mkdtemp(join(tmpdir(), ...))` for filesystem work with cleanup in `afterEach`.
- `console.log` for user-facing CLI output in `index.ts` (no logger abstraction at the CLI layer).

## E: Gotchas

- **`os.homedir()` in tests**: on POSIX `homedir()` respects the `HOME` env var. Tests must set `process.env.HOME` (and clear `XDG_CONFIG_HOME`) to a temp dir before importing/calling the install functions, and restore afterwards — otherwise tests will write into the developer's real home directory. Never let a test run against the real `~/.claude`.
- **Prompt wording must change**: `skillInstruction()` currently says "in the target repository". After this change the path is absolute (e.g. `/Users/x/.claude/skills/shipper-plan/SKILL.md`). All three adapters can read outside the workspace (`cursor-agent --force`, Claude SDK `permissionMode: "acceptEdits"` with `canUseTool`, opencode), and all three also auto-discover global skills natively — the explicit read instruction is belt-and-braces and must use the absolute path, not `~`-prefixed (agents don't reliably expand `~` in file paths).
- **Stale repo copies shadow global skills**: repos where shipper previously ran contain `.cursor/skills/shipper-*`, `.claude/skills/shipper-*`, `.opencode/skill/shipper-*`. Agents load project-level skills alongside global ones, so stale copies cause duplicate/conflicting skill definitions. The cleanup step must delete **only** directories with the exact five shipper skill names inside those three agent folders — never anything else the user put there.
- **opencode dir naming**: the current per-repo code uses `.opencode/skill` (singular). For the **global** install use `~/.config/opencode/skills` (plural) — that is what opencode's docs list for global discovery, and older opencode versions had a bug where only one of the two forms was scanned. Plural is the documented safe choice.
- **commander subcommand + default behavior**: `index.ts` currently uses a flat options-only parse and then always starts the server. Adding a `skills` subcommand means restructuring so the server start becomes the program's default `.action()` — otherwise `shipper skills` would fall through and boot the web console too. Also note `--version` is a manually handled option (not commander's `.version()`); keep that behavior.
- **Missing embeds today**: `shipper-build/PR.md`, all of `shipper-bug/*`, and `shipper-ship/SKILL.md` are **not** currently imported in `skills.ts` even though they exist in `skills/`. The `SKILLS` map and the `SkillName` type must grow; `SkillName` is also imported by [src/core/config.ts](/Users/matt/Documents/shipper/src/core/config.ts) (model-per-skill schema) and [src/server/run-controller.ts](/Users/matt/Documents/shipper/src/server/run-controller.ts). The `skillModelsSchema` in `config.ts` only lists plan/build/spike — that is fine to leave (bug/ship are not orchestrated skills), but you must not break the type relationship; if `SkillName` widens, verify `resolveDefaultModel`/`saveModelChoice` still typecheck.
- **Startup must not crash offline/agentless**: if `detectAgents()` finds nothing, startup should print a gentle note and continue — the web console still needs to boot (e.g. demo mode).
- **`skills-lock.json`** at the repo root is for external `skills add` tooling; it is unrelated to the binary's embedding and does not need changes.

## Plan

## Phase 1: Global install core in `src/core/skills.ts`

- Rework the skills module from "write into a target repo" to "write into the user's global agent skill directories", embedding all five skills.
- Outcomes: all 10 skill files embedded in the binary; `installSkillsGlobally(agents)` writes/refreshes them under the correct global directory per agent; absolute-path helper for prompts; repo-cleanup helper; full unit test coverage using a temp `HOME`.

### Section 1.1: Embed all skills

- [x] Add Bun text imports for the missing files: `skills/shipper-build/PR.md`, `skills/shipper-bug/SKILL.md`, `skills/shipper-bug/CATALOG.md`, `skills/shipper-bug/FIX.md`, `skills/shipper-ship/SKILL.md`.
- [x] Extend the `SKILLS` map so every skill lists all its files: `shipper-plan` (SKILL.md), `shipper-build` (SKILL.md, PR.md), `shipper-spike` (SKILL.md, PLAN.md, BUILD.md), `shipper-bug` (SKILL.md, CATALOG.md, FIX.md), `shipper-ship` (SKILL.md). Keep the `as const satisfies Record<string, readonly SkillFile[]>` pattern.
- [x] Confirm `SkillName` now covers all five names and run `bun run typecheck` — fix any fallout in `config.ts` / `run-controller.ts` (see Gotchas).

### Section 1.2: Global directory resolution and install

- [x] Add `globalSkillsRoot(agent: AgentKind): string` returning the absolute agent-global skills root: `join(homedir(), ".claude", "skills")` for claude, `join(homedir(), ".cursor", "skills")` for cursor, and for opencode `join(process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config"), "opencode", "skills")` (mirror `configDir()` in `config.ts`).
- [x] Add `globalSkillPath(agent: AgentKind, name: SkillName): string` returning the absolute `SKILL.md` path (replaces the repo-relative `skillPathForAgent`).
- [x] Replace `installSkills(targetRepo, agent)` with `installSkillsGlobally(agents: AgentKind[]): Promise<void>` that writes every file of every skill for each agent, reusing `writeSkillIfChanged` (which already overwrites on content drift and skips identical files).
- [x] Have `installSkillsGlobally` return a small summary (e.g. `{ agent, root }[]`) so the CLI can print where things were installed.

### Section 1.3: Repo cleanup helper

- [x] Add `removeRepoSkills(targetRepo: string): Promise<void>` that deletes only the shipper-owned skill directories previously installed per-repo: for each of the five `SkillName`s, remove `<repo>/.cursor/skills/<name>`, `<repo>/.claude/skills/<name>`, and `<repo>/.opencode/skill/<name>` (note: singular `skill` here — that is where the old code wrote). Use `rm(path, { recursive: true, force: true })` so missing paths are a no-op. Do not touch any other directories in those folders.

### Section 1.4: Tests

- [x] Rewrite the `installSkills` describe block in [src/core/core.test.ts](/Users/matt/Documents/shipper/src/core/core.test.ts): point `HOME` (and unset `XDG_CONFIG_HOME`) at a `mkdtemp` dir in `beforeEach`, restore in `afterEach`.
- [x] Test: `installSkillsGlobally(["claude"])` writes all five skills with all files under `<tmp>/.claude/skills/`.
- [x] Test: opencode files land under `<tmp>/.config/opencode/skills/` and respect `XDG_CONFIG_HOME` when set.
- [x] Test: second install is idempotent (unchanged mtimes not required — just content equality) and an edited file gets overwritten back to the embedded content.
- [x] Test: `removeRepoSkills` deletes `shipper-*` dirs but leaves a sibling non-shipper skill dir untouched.

### Completion Notes

- `writeSkillIfChanged` now takes an absolute path directly (no `targetRepo` + relative path join).
- `OrchestratedSkillName` (`shipper-plan` | `shipper-build` | `shipper-spike`) was added alongside widened `SkillName` so `resolveDefaultModel` / `saveModelChoice` and model-pick flows in `run-controller.ts` stay typed against the three orchestrated skills only.
- Orchestrator and prompts were updated early to call `installSkillsGlobally([agent])` and `globalSkillPath` so the project typechecks; Phase 2 still needs the prompt wording change (drop "in the target repository"), CLI startup install, `shipper skills` subcommand, and `removeRepoSkills` wiring at boot.
- `skills/shipper-build/PR.md` is empty on disk — embedded as-is for parity with the `skills/` folder layout.

## Phase 2: CLI, orchestrator, and prompt integration

- Wire the global install into startup, add the `shipper skills` subcommand, point prompts at global paths, and clean up stale repo copies.
- Outcomes: `shipper` refreshes global skills for detected agents on every boot; `shipper skills` works standalone without starting the server; agent prompts reference the absolute global skill path; repos no longer receive (and get cleaned of) skill copies.

### Section 2.1: Startup install in `src/index.ts`

- [x] Restructure [src/index.ts](/Users/matt/Documents/shipper/src/index.ts) so the current serve flow becomes the commander program's default `.action()` (keep all existing flags: `--dir`, `--demo`, `--port`, `--no-open`, `--version` with its manual handling).
- [x] In the serve path, after resolving `repoPath`: call `detectAgents()`, then `installSkillsGlobally(detected.map(d => d.kind))`, then `removeRepoSkills(repoPath)`. Log one concise line, e.g. `Skills installed globally for: claude, cursor`. If no agents are detected, log a note and continue booting (demo mode must still work).
- [x] Wrap the install in a try/catch that logs a warning and continues — a permissions failure writing to `~` must not prevent the console from starting.

### Section 2.2: `shipper skills` subcommand

- [x] Add `program.command("skills")` with description "install Shipper skills globally for your coding agents". Action: run `detectAgents()` + `installSkillsGlobally()`, print each agent and its skills root, then exit 0 (do not start the server).
- [x] Support `--agent <kind>` (choices: `claude`, `cursor`, `opencode`) to force installing for a specific agent even if detection misses it; validate the value and exit 1 with a clear error for unknown kinds.
- [x] When nothing is detected and no `--agent` is given, print the three supported agents and how to force one, then exit 1.

### Section 2.3: Orchestrator and prompts

- [x] In [src/core/orchestrator.ts](/Users/matt/Documents/shipper/src/core/orchestrator.ts), replace the three `installSkills(repoPath, agent)` calls with `installSkillsGlobally([agent])` — keeping a pre-run install as a safety refresh is deliberate (cheap and idempotent).
- [x] In [src/core/prompts.ts](/Users/matt/Documents/shipper/src/core/prompts.ts), change `skillInstruction()` to use `globalSkillPath(agent, skillName)` and reword to something like: ``Read and follow the skill at `<absolute path>`.`` — drop "in the target repository". The path must be absolute, not `~`-prefixed.
- [x] Update [src/core/orchestrator.test.ts](/Users/matt/Documents/shipper/src/core/orchestrator.test.ts) (mock `installSkillsGlobally` instead of `installSkills`) and the prompt assertions in [src/core/core.test.ts](/Users/matt/Documents/shipper/src/core/core.test.ts) (they check `buildSpikePrompt` contains `skillPathForAgent(...)`).
- [x] Run `bun run typecheck`, `bun run lint`, and `bun run test` and fix any remaining fallout.

### Completion Notes

- `index.ts` uses `program.parseAsync` with a root `.action()` for serve and a `skills` subcommand; serve logic extracted to `runServe`, skills to `runSkillsInstall`.
- Startup install runs after `ensureShipperDirs` and before `startServer`; failures are logged as warnings only.
- `skillInstruction()` now ends with the absolute path only (no "in the target repository"); orchestrator already called `installSkillsGlobally` from Phase 1.

## Phase 3: Docs and verification

- Bring the README in line with the new model and verify the compiled binary end to end.
- Outcomes: accurate docs; verified binary behavior for both the console flow and the standalone skills flow.

### Section 3.1: README

- [x] Update the skills paragraph (README line 67) and the "Where things live" table in [README.md](/Users/matt/Documents/shipper/README.md): skills are embedded in the binary and installed **globally** to `~/.claude/skills/`, `~/.cursor/skills/`, and `~/.config/opencode/skills/` for detected agents; repos no longer receive skill copies.
- [x] Document the `shipper skills` subcommand in the CLI flags/commands section, including the "use the skills directly in your own agent" use case (e.g. type `/shipper-plan` in Cursor CLI or Claude Code without running the console).

### Section 3.2: End-to-end verification

- [x] `bun run build`, then run `./dist/shipper --version` and `./dist/shipper skills` on the dev machine; confirm all five skills appear under each detected agent's global directory and the command exits without starting the server.
- [x] Start `./dist/shipper --demo --no-open` in a scratch repo that has an old `.cursor/skills/shipper-plan` copy; confirm the stale repo copy is removed, global skills are refreshed, and the server boots normally.
- [x] Sanity-check one real agent session (plan or spike) and confirm the prompt's absolute skill path is readable by the agent and the run completes as before.

### Completion Notes

- README "Where things live" table now lists the three global skill roots; CLI section split into Commands (`shipper`, `shipper skills`) and Flags.
- E2E: `./dist/shipper skills` installed all five skills under claude/cursor/opencode global dirs and exited without starting the server; demo boot in a scratch repo removed stale `.cursor/skills/shipper-plan` while preserving a sibling `my-custom-skill` dir.
- Live agent session not re-run here; prompt absolute-path behavior is covered by `buildSpikePrompt` unit test (`globalSkillPath` + no "target repository" wording). Agents also natively auto-discover global skills.
