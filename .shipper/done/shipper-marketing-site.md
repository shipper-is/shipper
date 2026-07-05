# Shipper Marketing Site (Next.js landing page)

## A: Plan Overview

Add a marketing/billboard website for the Shipper framework to this repository, living in a new `web/` subdirectory. The site is a single landing page built with Next.js (App Router) and Tailwind CSS, styled strictly black and white with sharp edges (no border radius anywhere). It pitches Shipper to three audiences — developers, vibe-coders, and non-developers — with the message that anyone on the team can ship confidently. The primary call to action is a copy-to-clipboard button for the install script. A link to the GitHub repo is the only external navigation. The app will be deployed on Vercel using the default Next.js build (no static export configuration needed).

The rest of the repository is a Bun-compiled CLI/TUI ([README.md](/Users/matt/Documents/shipper/README.md)) and must remain untouched except for `.gitignore` additions. The `web/` directory gets its own `package.json` and is fully self-contained.

## B: Related Files

Files to reference (do not modify):

- [src/constants.ts](/Users/matt/Documents/shipper/src/constants.ts) — the canonical install command. The site must display exactly this string:

```1:5:/Users/matt/Documents/shipper/src/constants.ts
/** GitHub org/repo for releases and install script downloads. */
export const GITHUB_REPO = "shipper-is/shipper";

export const INSTALL_COMMAND = `curl -fsSL https://raw.githubusercontent.com/${GITHUB_REPO}/main/install.sh | sh`;
```

- [README.md](/Users/matt/Documents/shipper/README.md) — source of truth for what Shipper is and does; use it as the basis for all marketing copy (plan/build workflow, supported agents, compiled binary, plans committed to the repo).
- [skills/shipper-plan/SKILL.md](/Users/matt/Documents/shipper/skills/shipper-plan/SKILL.md) and [skills/shipper-build/SKILL.md](/Users/matt/Documents/shipper/skills/shipper-build/SKILL.md) — describe the plan/build workflow if more copy detail is needed.

Files to modify:

- [.gitignore](/Users/matt/Documents/shipper/.gitignore) — add `web/node_modules/`, `web/.next/`, `web/next-env.d.ts`.

Files to create (all inside `web/`):

- `web/package.json`, `web/tsconfig.json`, `web/next.config.ts`, `web/postcss.config.mjs`
- `web/app/layout.tsx`, `web/app/page.tsx`, `web/app/globals.css`
- `web/lib/constants.ts` (install command + GitHub URL for the site)
- `web/components/copy-install-command.tsx` (client component for the CTA)
- Section components under `web/components/` (hero, personas, workflow, footer — see Plan)

## C: Existing Code to Utilize

- The install command string and GitHub repo slug from [src/constants.ts](/Users/matt/Documents/shipper/src/constants.ts). Do NOT import from `../src` — the web app must not reach outside `web/` (separate tsconfig, separate deploy root on Vercel). Instead, duplicate the two values into `web/lib/constants.ts` with a comment: `// Keep in sync with src/constants.ts at the repo root.`
- The ASCII TUI mock in the README (lines 26–36) can be reused verbatim inside a `<pre>` block as a monochrome "screenshot" of the product — it fits the black/white terminal aesthetic and requires no image assets.

## D: Codebase Conventions to Follow

- **Bun for everything** (workspace rule in CLAUDE.md): use `bun install`, `bun run dev`, `bun run build` inside `web/`. Do not use npm/pnpm/yarn. Next.js's own compiler is fine (the "no vite/webpack" rule refers to not introducing separate bundlers).
- **TypeScript everywhere** — the repo is fully TS; the Next.js app must be TS (`.tsx`), strict mode on, matching the root repo's strictness.
- **No emojis** in code or copy.
- Prettier is configured at the repo root ([.prettierrc](/Users/matt/Documents/shipper/.prettierrc) if present — check and match its settings, e.g. quotes/semicolons) so `web/` code formats consistently.
- Keep components small and flat — this codebase favors simple modules over abstraction layers.

## E: Gotchas

- **Do not touch the root `package.json` or root tooling.** The root `lint`, `typecheck`, and `test` scripts are scoped to `src/` and CI (`.github/workflows/release.yml`) builds the CLI binary. The web app is intentionally not wired into root scripts or CI in this plan.
- **Root ESLint config**: the root ESLint setup targets `src/`. Do not extend it into `web/`; rely on `eslint-config-next` inside `web/` only if you add linting there — otherwise skip ESLint in `web/` entirely to avoid config conflicts.
- **Sharp edges means zero border radius.** Do not use any `rounded-*` Tailwind classes. Buttons, code blocks, cards, and inputs are all square. Enforce visually, not with config hacks.
- **Strict black/white palette.** Only `#000000` and `#ffffff` (plus opacity variants of those two for dim text/borders, e.g. `text-white/60`, `border-white/20`). No grays defined as separate hex values, no accent colors.
- **Copy-to-clipboard requires a client component.** `navigator.clipboard.writeText` only works in the browser; the CTA component needs `"use client"` at the top. Keep the rest of the page as server components.
- **Vercel deploy uses `web/` as the Root Directory.** This is a Vercel dashboard setting, not code. Note it in the site README; nothing in the repo needs `vercel.json`.
- **`create-next-app` scaffolding noise.** If scaffolding with `bunx create-next-app`, delete the default assets (`app/favicon.ico` can stay, but remove default SVGs in `public/`, boilerplate page content, and default README copy). Alternatively scaffold by hand — the file list in section B is complete.
- **Tailwind v4** uses the `@tailwindcss/postcss` plugin and a CSS-first config (`@import "tailwindcss"` in `globals.css`); there is no `tailwind.config.ts` by default. Don't create a v3-style config file.
- **macOS unsigned binary caveat** (README line 17): the copy near the install CTA should mention that installing via `curl | sh` avoids Gatekeeper quarantine — it's a real user-facing detail, one short line is enough.

## Plan

## Phase 1: Scaffold the Next.js app

- Stand up a runnable, empty Next.js App Router app in `web/` with Tailwind CSS v4, TypeScript strict mode, and the black/white base theme.
- Outcomes: `bun run dev` inside `web/` serves a blank black page with white text at `localhost:3000`; `bun run build` succeeds; nothing outside `web/` changed except `.gitignore`.

### Section 1: Project setup

- [x] Create `web/` at the repo root and scaffold Next.js (latest stable, App Router, TypeScript, Tailwind, no ESLint prompt needed) using `bunx create-next-app@latest web` or manual file creation — either way, end state must use Bun (`bun install`) and match the file list in section B.
- [x] Remove scaffold boilerplate: default `public/` SVGs, default page/layout content, boilerplate CSS beyond the Tailwind import.
- [x] Add `web/node_modules/`, `web/.next/`, and `web/next-env.d.ts` to the root [.gitignore](/Users/matt/Documents/shipper/.gitignore).
- [x] Verify `bun run dev` and `bun run build` both work from inside `web/`.

### Section 2: Base theme and layout

- [x] In `web/app/globals.css`, set the global theme: `@import "tailwindcss"`, black background, white text, and a font stack — use a geometric sans (e.g. `next/font` with Inter or Geist) for body text and a monospace font for code/terminal elements.
- [x] In `web/app/layout.tsx`, set metadata (title: "Shipper — plan and build features with AI agents", description drawn from README line 3), apply fonts, and render children on a full-black body.
- [x] Create `web/lib/constants.ts` exporting `INSTALL_COMMAND`, `GITHUB_REPO`, and `GITHUB_URL` (`https://github.com/shipper-is/shipper`), values copied from [src/constants.ts](/Users/matt/Documents/shipper/src/constants.ts) with a keep-in-sync comment.

#### Completion Notes (Phase 1)

- Scaffolded with `bunx create-next-app@latest web --typescript --tailwind --no-eslint --app --no-src-dir --import-alias "@/*" --use-bun --turbopack --yes` on branch `shipper/marketing-site`. Next.js 16.2.10, Tailwind v4, React 19.
- Geist Sans + Geist Mono via `next/font/google`; `.font-mono` utility class defined in `globals.css` for Phase 2 code blocks.
- `page.tsx` is an empty `<main className="min-h-screen" />` — Phase 2 adds section components.
- `public/` SVGs and scaffold README removed; default `favicon.ico` kept.
- Next.js warns about multiple lockfiles (root `bun.lock` + `web/bun.lock`). Harmless for local dev; optional fix in Phase 3: set `turbopack.root` in `next.config.ts` or document ignoring the warning.

## Phase 2: Landing page content and CTA

- Build the full single-page experience: hero with install CTA, audience/persona section, how-it-works workflow section, and footer.
- Outcomes: complete, polished landing page; copy button copies the exact install command; GitHub link works; strict black/white sharp-edged style throughout.

### Section 1: Copy-install CTA component

- [x] Create `web/components/copy-install-command.tsx` as a client component (`"use client"`): renders the install command in a monospace, white-bordered, square block with a "Copy" button.
- [x] On click, call `navigator.clipboard.writeText(INSTALL_COMMAND)`, flip the button label to "Copied" for ~2 seconds, then revert. Handle the promise rejection silently (no error UI needed).
- [x] Style: inverted button (white background, black text) that swaps to outlined on hover; no rounded corners; command text selectable.

### Section 2: Hero section

- [x] Create `web/components/hero.tsx`: large bold headline pitching the core promise (e.g. "Plan it. Build it. Ship it." — anyone on the team ships confidently with AI agents), a subheadline summarizing Shipper in one sentence (from README line 3), the `CopyInstallCommand` CTA, and a secondary link to GitHub.
- [x] Include the ASCII TUI mock from README lines 26–36 in a bordered `<pre>` block beside or below the CTA as the product visual.
- [x] Add the one-line macOS note under the install block: installing via `curl | sh` avoids Gatekeeper quarantine on macOS.

### Section 3: Audience and workflow sections

- [x] Create `web/components/personas.tsx` with three square, white-bordered cards — Developers ("stay in flow; plans are committed markdown, builds run phase-by-phase with your agent of choice"), Vibe-coders ("structure without ceremony; describe the feature, answer a few questions, watch it build"), Non-developers ("ship real changes; the plan/build loop asks clarifying questions and handles the code"). Ground every claim in README content; do not invent features.
- [x] Create `web/components/workflow.tsx` showing the two-step loop: 1. Plan — `shipper-plan` explores the codebase, asks clarifying questions, writes a phased markdown plan to `.shipper/open/`; 2. Build — `shipper-build` executes one phase per agent session until the plan lands in `.shipper/done/`. Mention agent-agnostic support (Claude Code, Cursor CLI, opencode) and that it ships as a single compiled binary with no runtime dependencies.
- [x] Create `web/components/footer.tsx`: repeat the install command (reuse `CopyInstallCommand`), GitHub link, and a plain-text "Shipper" wordmark. No nav menu needed.
- [x] Assemble all sections in `web/app/page.tsx` in order: hero, personas, workflow, footer, separated by `border-t border-white/20` dividers for the sharp editorial look.

#### Completion Notes (Phase 2)

- Five section components under `web/components/`: `copy-install-command.tsx` (client), `hero.tsx`, `personas.tsx`, `workflow.tsx`, `footer.tsx`. All except the CTA are server components.
- Hero uses a two-column grid on `lg` breakpoints (copy left, TUI mock right); stacks on smaller screens.
- Copy button uses `aria-label` that updates on copy; GitHub links use `rel="noopener noreferrer"` and `target="_blank"`.
- No `rounded-*` classes anywhere in `web/`. Palette is strictly black/white with opacity variants only.
- `bun run build` passes. Responsive polish (mobile overflow, a11y audit) deferred to Phase 3.

## Phase 3: Polish and verification

- Final quality pass so the page is production-ready for Vercel.
- Outcomes: responsive layout, clean build, documented deploy step.

### Section 1: Responsive and accessibility pass

- [x] Verify the layout works at mobile widths (stack persona cards, wrap the install command with horizontal scroll on the `<pre>`/code block rather than overflow).
- [x] Ensure the copy button is a real `<button>` with an accessible label, and the GitHub link has `rel="noopener noreferrer"` with `target="_blank"`.
- [x] Confirm no `rounded-*` classes and no colors outside black/white/opacity variants anywhere in `web/`.

### Section 2: Build verification and docs

- [x] Run `bun run build` in `web/` and fix any type or build errors.
- [x] Create a short `web/README.md`: how to run locally with Bun, and a note that Vercel deployment requires setting the project Root Directory to `web/`.
- [x] Manually verify in the browser: copy button copies the exact string from `web/lib/constants.ts`, GitHub link opens the repo, page renders correctly in light-mode browsers (the page forces black regardless of `prefers-color-scheme`).

#### Completion Notes (Phase 3)

- Install command `<pre>` uses `whitespace-pre` + `overflow-x-auto` (not `break-all`) so mobile scrolls horizontally instead of overflowing.
- `color-scheme: dark` on `html` keeps browser chrome consistent when the OS is in light mode; body stays `#000` / `#fff`.
- `turbopack.root` set in `next.config.ts` to silence the multiple-lockfile warning from Phase 1.
- `web/README.md` documents `bun run dev` and Vercel Root Directory = `web/`.
- `bun run build` passes. Browser smoke test: copy CTA, GitHub links, mobile layout at 375px width.
