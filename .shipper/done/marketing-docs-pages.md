---
type: plan
branch: shipper/marketing-docs-pages
started_at: "2026-07-04T23:36:00-05:00"
completed_at: "2026-07-04T23:55:00-05:00"
---

# Marketing Docs Pages + Bundle All Five Skills

## A: Plan Overview

Two related pieces of work:

1. **Bundle all five skills in the binary.** Today only `shipper-plan`, `shipper-build`, and `shipper-spike` are embedded in the compiled binary and auto-installed into target repos (see [src/core/skills.ts](/Users/matt/Documents/shipper/src/core/skills.ts)). `shipper-ship` and `shipper-bug` exist in [skills/](/Users/matt/Documents/shipper/skills) but are never installed. Expand the bundle so all five skills (including their reference files) are auto-installed. This must land first because the docs will state that all five skills come installed automatically.
2. **Add a docs section to the marketing site** ([web/](/Users/matt/Documents/shipper/web)) with two pages:
   - `/docs/console` — a super simple walkthrough of using the web console (`shipper` command, plan flow, build flow, spike flow).
   - `/docs/skills` — a super simple explanation of using the five skills directly in your coding agent, without the console.
   - A minimal `/docs` index that links to the two pages.
   - "Docs" links added to the existing hero and footer (per the user's choice: no new site header; keep the sparse design).

## B: Related Files

Skill bundling (CLI side):

- [src/core/skills.ts](/Users/matt/Documents/shipper/src/core/skills.ts) — the `SKILLS` registry, `installSkills()`, and `skillPathForAgent()`. This is the only file that decides what gets embedded and installed.
- [src/core/core.test.ts](/Users/matt/Documents/shipper/src/core/core.test.ts) — existing tests for `installSkills` (lines ~60–100). Extend for the new skills.
- [README.md](/Users/matt/Documents/shipper/README.md) — line 67 says "Bundled `shipper-plan` and `shipper-build` skills are embedded in the binary…". Already stale (spike is bundled); update to list all five.
- Skill sources to bundle: [skills/shipper-ship/SKILL.md](/Users/matt/Documents/shipper/skills/shipper-ship/SKILL.md), [skills/shipper-bug/SKILL.md](/Users/matt/Documents/shipper/skills/shipper-bug/SKILL.md), [skills/shipper-bug/CATALOG.md](/Users/matt/Documents/shipper/skills/shipper-bug/CATALOG.md), [skills/shipper-bug/FIX.md](/Users/matt/Documents/shipper/skills/shipper-bug/FIX.md), [skills/shipper-build/PR.md](/Users/matt/Documents/shipper/skills/shipper-build/PR.md).

Marketing site:

- [web/app/layout.tsx](/Users/matt/Documents/shipper/web/app/layout.tsx) — root layout with fonts and metadata (no changes expected, just context).
- [web/app/page.tsx](/Users/matt/Documents/shipper/web/app/page.tsx) — home page composition.
- [web/components/hero.tsx](/Users/matt/Documents/shipper/web/components/hero.tsx) — add a "Docs" link next to the existing GitHub link. Note: this file has uncommitted local modifications; read the current version before editing.
- [web/components/footer.tsx](/Users/matt/Documents/shipper/web/components/footer.tsx) — add a "Docs" link next to the GitHub link.
- [web/components/workflow.tsx](/Users/matt/Documents/shipper/web/components/workflow.tsx) — source of Plan/Build/Ship copy to reuse on the docs pages.
- [web/lib/constants.ts](/Users/matt/Documents/shipper/web/lib/constants.ts) — `INSTALL_COMMAND` and `GITHUB_URL`.
- New files: `web/app/docs/page.tsx`, `web/app/docs/console/page.tsx`, `web/app/docs/skills/page.tsx`, and optionally `web/app/docs/layout.tsx` for shared docs chrome.

## C: Existing Code to Utilize

- `writeSkillIfChanged()` and the `SKILLS` registry pattern in [src/core/skills.ts](/Users/matt/Documents/shipper/src/core/skills.ts) — adding a skill is just adding imports and a registry entry; the install loop already handles multi-file skills (see `shipper-spike` with its `PLAN.md`/`BUILD.md`).
- The `installSkills` test pattern in [src/core/core.test.ts](/Users/matt/Documents/shipper/src/core/core.test.ts) — the multi-file assertion for `shipper-spike` (lines ~85–92) is the exact shape to copy for `shipper-bug`.
- `CopyInstallCommand` ([web/components/copy-install-command.tsx](/Users/matt/Documents/shipper/web/components/copy-install-command.tsx)) — reuse on the console docs page for the install step.
- The link style used in hero/footer: `font-mono text-sm underline underline-offset-4 transition-colors hover:text-white/60` — use this exact class string for the new Docs links and any links on docs pages.
- Card style from [web/components/workflow.tsx](/Users/matt/Documents/shipper/web/components/workflow.tsx): `border border-white p-6` — use for the skill cards / docs index cards.
- Copy sources: [README.md](/Users/matt/Documents/shipper/README.md) (console flows, keyboard shortcuts, file paths), [web/components/workflow.tsx](/Users/matt/Documents/shipper/web/components/workflow.tsx) (skill one-liners), and each `skills/*/SKILL.md` description frontmatter.

## D: Codebase Conventions to Follow

- `web/` is a self-contained Next.js 16 App Router app. Do NOT import anything from the repo root `src/` into `web/` — duplicate constants into [web/lib/constants.ts](/Users/matt/Documents/shipper/web/lib/constants.ts) if needed.
- Default to server components; only add `"use client"` when interactivity is required (the docs pages need none beyond the existing `CopyInstallCommand`).
- Visual language: pure black background, white text, `text-white/60` for body copy, `border-white/20` for dividers, `font-mono` for commands/skill names, **no border radius anywhere** (no `rounded-*` classes).
- Section layout: `px-6 py-20 md:px-12 md:py-28` with `mx-auto max-w-6xl` inner containers.
- Use `next/link` for internal routes; `target="_blank" rel="noopener noreferrer"` for external.
- Per-page metadata via `export const metadata` in each new `page.tsx`.
- Bun everywhere: `bun run dev` / `bun run build` inside `web/`, `bun test` at repo root.
- Skill markdown imports in `src/core/skills.ts` use Bun's `with { type: "text" }` import attribute — follow the existing import style exactly.

## E: Gotchas

- **`skills/shipper-build/PR.md` is orphaned.** It exists on disk but is not referenced by `shipper-build/SKILL.md` and not in the `SKILLS` registry. The PR-creation guidance apparently lives in `shipper-ship/SKILL.md` now. Bundle it with `shipper-build` anyway for parity with the on-disk `skills/` folder, but do not invent references to it in docs copy.
- **`shipper-bug` is multi-file.** Its `SKILL.md` explicitly references `./CATALOG.md` and `./FIX.md`, so all three files must be in the registry entry or the installed skill will be broken.
- **`skills-lock.json` only hashes `SKILL.md` files** — no changes needed there; bundling extra reference files does not affect it.
- **The console does not run ship/bug.** Even after bundling, the web console UI only triggers plan, build, and spike sessions. The docs must present `shipper-ship` and `shipper-bug` as skills you invoke in your agent (which is exactly what the `/docs/skills` page is for). Do not claim there is a Ship button in the console.
- **`web/components/hero.tsx` has uncommitted changes** in the working tree (per git status). Read it fresh before editing rather than assuming the committed content.
- **`opencode` uses a different path** (`.opencode/skill/`, singular "skill") — if docs mention install paths, list all three: `.claude/skills/`, `.cursor/skills/`, `.opencode/skill/`.
- **Keep docs "super simple".** The user explicitly wants a lightweight explanation, not exhaustive reference docs. Each page should be scannable in under a minute — short numbered steps and a small skill table, not walls of text.
- The marketing site deploys to Vercel with root directory `web/`; new routes need nothing beyond the files themselves, but `bun run build` in `web/` must pass (type errors fail the build).

## Plan

## Phase 1: Bundle all five skills in the binary

- Expand the skill registry so `shipper-ship` and `shipper-bug` (and `shipper-build`'s `PR.md`) are embedded and auto-installed alongside the existing three skills.
- Outcomes: running `shipper` in any repo installs all five skills; tests cover the new entries; README reflects reality.

### Section 1: Registry changes

- [x] In [src/core/skills.ts](/Users/matt/Documents/shipper/src/core/skills.ts), add text imports for `skills/shipper-ship/SKILL.md`, `skills/shipper-bug/SKILL.md`, `skills/shipper-bug/CATALOG.md`, `skills/shipper-bug/FIX.md`, and `skills/shipper-build/PR.md`, following the existing `with { type: "text" }` style.
- [x] Add `shipper-ship` (single `SKILL.md` entry) and `shipper-bug` (three-file entry: `SKILL.md`, `CATALOG.md`, `FIX.md`) to the `SKILLS` const, and add `PR.md` to the `shipper-build` entry. No changes to `installSkills` or `skillDirForAgent` are needed — they iterate the registry generically.

### Section 2: Tests and docs truth

- [x] Extend the `installSkills` tests in [src/core/core.test.ts](/Users/matt/Documents/shipper/src/core/core.test.ts): assert `shipper-ship/SKILL.md` is installed, and copy the existing `shipper-spike` multi-file assertion for `shipper-bug` (all three files present with matching content).
- [x] Run `bun test` at the repo root and confirm everything passes.
- [x] Update [README.md](/Users/matt/Documents/shipper/README.md) line 67 to say all five bundled skills (`shipper-plan`, `shipper-build`, `shipper-spike`, `shipper-ship`, `shipper-bug`) are embedded in the binary and installed at run time.
- [x] Run `bun run build` at the repo root to confirm the binary still compiles with the new embedded files.

#### Completion Notes

- `SKILL_NAMES` now exports five skills; `installSkills` required no logic changes — only registry expansion.
- `shipper-build` gained `PR.md` for on-disk parity; it is not referenced by `shipper-build/SKILL.md` (PR guidance lives in `shipper-ship`).
- Use `bun run test` (vitest) rather than bare `bun test` — the latter hits Bun's built-in runner and fails on vitest-only APIs (`vi.hoisted`, `importOriginal`) in orchestrator/run-controller tests.

## Phase 2: Docs pages on the marketing site

- Create the `/docs` index and the two content pages in the Next.js app, matching the existing black/white visual language.
- Outcomes: `/docs`, `/docs/console`, and `/docs/skills` render and pass `bun run build` in `web/`.

### Section 1: Docs index and shared chrome

- [x] Create `web/app/docs/layout.tsx` — a thin wrapper that renders a small top strip inside the standard section padding: a link back to `/` ("Shipper" wordmark or "← Home") and inline links to `/docs/console` and `/docs/skills` using the standard mono underline link style. Keep it minimal; this is not a full nav bar.
- [x] Create `web/app/docs/page.tsx` — heading ("Docs"), one sentence framing the two ways to use Shipper, and two `border border-white p-6` cards linking to `/docs/console` ("Use the web console") and `/docs/skills` ("Use the skills directly"). Export `metadata` with an appropriate title.

### Section 2: Console docs page

- [x] Create `web/app/docs/console/page.tsx` with `metadata` and this super-simple structure, sourcing copy from [README.md](/Users/matt/Documents/shipper/README.md):
  - **Install** — reuse the `CopyInstallCommand` component.
  - **Run** — `shipper` in your repo opens `http://shipper.localhost`; first run picks your agent (Claude Code, Cursor CLI, or opencode) and auto-installs all five skills into the repo.
  - **Plan** — press `n`, describe the feature, answer clarifying questions; a plan lands in `.shipper/open/`.
  - **Build** — press `b` on an open plan; one agent session per phase until done, plan moves to `.shipper/done/`.
  - **Spike** — press `s` for small one-off tasks (plan + build in a single session).
  - Keep each step to 1–2 sentences; use `font-mono` for keys, commands, and paths.

### Section 3: Skills docs page

- [x] Create `web/app/docs/skills/page.tsx` with `metadata` and this structure:
  - One-paragraph framing: every skill the console uses is a plain agent skill installed in your repo — you can invoke them directly from Claude Code, Cursor, or opencode without running the console.
  - Where they live: installed automatically on first `shipper` run into `.claude/skills/`, `.cursor/skills/`, or `.opencode/skill/`.
  - Five skill cards (reuse the workflow card style) each with the mono skill name, a one-liner (adapt from [web/components/workflow.tsx](/Users/matt/Documents/shipper/web/components/workflow.tsx) and each skill's frontmatter description), and an example invocation, e.g. "use shipper-plan to plan &lt;feature&gt;":
    - `shipper-plan` — explore, ask questions, write a phased plan to `.shipper/open/`.
    - `shipper-build` — execute one phase of a plan per session; finished plans move to `.shipper/done/`.
    - `shipper-spike` — small one-off feature: plan and build in a single session.
    - `shipper-ship` — turn a completed plan into a reviewable PR via `gh`.
    - `shipper-bug` — evidence-first bug catalog and fix workflow in `.shipper/bugs/`.
  - A short closing note that plans are committed markdown, so console users and direct-skill users see the same `.shipper/` files.

#### Completion Notes

- Four new routes under `web/app/docs/`: shared layout with minimal nav, index with two link cards, console walkthrough (numbered steps + `CopyInstallCommand`), and skills page (five cards in a 2-column grid).
- `bun run build` in `web/` passes; all three docs routes statically generated. Hero/footer Docs links are Phase 3.

## Phase 3: Link the docs from the existing site

- Wire up discovery of the docs pages without adding a site header, then verify the whole site builds.
- Outcomes: Docs reachable from hero and footer; `bun run build` passes in `web/`.

### Section 1: Hero and footer links

- [x] In [web/components/hero.tsx](/Users/matt/Documents/shipper/web/components/hero.tsx) (read the current working-tree version first — it has uncommitted edits), add a "Docs" link alongside the existing "View on GitHub" link, using `next/link` to `/docs` and the same mono underline classes. Place both links in a single row (e.g. a flex container with a gap) rather than stacking paragraphs.
- [x] In [web/components/footer.tsx](/Users/matt/Documents/shipper/web/components/footer.tsx), add a "Docs" link to `/docs` next to the GitHub link, same styling.

### Section 2: Verification

- [x] Run `bun run build` inside `web/` and confirm it succeeds with the three new routes statically generated.
- [x] Run `bun run dev` inside `web/` and manually spot-check `/`, `/docs`, `/docs/console`, and `/docs/skills` render correctly with the black/white styling and working links.

#### Completion Notes

- Hero and footer now expose `/docs` in a horizontal flex row (`gap-6`) beside the existing GitHub links; Docs uses internal `next/link`, GitHub stays external.
- `bun run build` in `web/` passes with all seven routes statically generated (`/`, `/docs`, `/docs/console`, `/docs/skills`, plus `_not-found`).
