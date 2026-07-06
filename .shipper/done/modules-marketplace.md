---
type: plan
branch: shipper/modules-marketplace
base_branch: main
worktree: .shipper/worktrees/modules-marketplace
started_at: "2026-07-05T21:48:00-04:00"
phase_commits:
  1: 3a37126
  2: ee2cf44
  3: 32b1754
  4: 54bdeb8
completed_at: "2026-07-05T22:02:00-04:00"
pr_url: https://github.com/shipper-is/shipper/pull/15
pr_number: 15
---

# Modules Marketplace

## A: Plan Overview

Add a new "Modules" feature to Shipper: an open source marketplace of opinionated, agent-buildable pieces of product functionality (e.g. customer support, product analytics) that users can build directly into their own codebase instead of buying a SaaS tool.

The feature has four parts:

1. **Module content format** — a new top-level `modules/` folder in this repository. Each module is a folder containing a `MODULE.md` file with custom YAML frontmatter plus additional reference markdown files. Modules describe architecture, data model, UX, and maintenance guidance in a stack-adaptive way (the agent adapts the module to the host repo's stack). One fully fleshed-out seed module ships with this plan: `customer-support`.
2. **CLI: `shipper modules`** — a new command group on the existing commander CLI. `shipper modules list` shows available modules from the GitHub repo; `shipper modules add <id-or-url>` fetches a module's markdown files and installs them into `.shipper/modules/<id>/` in the current directory.
3. **Skill update: module-aware `shipper-plan`** — the existing planning skill learns to recognize a module reference in the user's prompt (a `https://shipper.is/modules/<id>` URL or bare module id), install the module via the CLI (with a raw-GitHub fallback), read its contents, and produce a Shipper plan for building that module into the current repo.
4. **Web: `/modules` pages on shipper.is** — an index page explaining what Modules are plus a card per module, and a detail page per module, rendered dynamically at build time from the repo's `modules/` folder. Each module has a copy button that copies `/shipper-plan https://shipper.is/modules/<id>` so users can paste it straight into their coding editor.

End-to-end flow:

```mermaid
flowchart LR
    A[User browses shipper.is/modules] --> B[Copies /shipper-plan https://shipper.is/modules/customer-support]
    B --> C[Pastes into Claude Code / Cursor / opencode]
    C --> D[shipper-plan skill detects module URL]
    D --> E[Runs shipper modules add customer-support]
    E --> F[Module markdown lands in .shipper/modules/customer-support/]
    F --> G[Skill reads module + host repo, asks questions]
    G --> H[Writes tailored plan to .shipper/open/]
    H --> I[User builds it with shipper-build]
```

## B: Related Files

Files to create:

- [modules/customer-support/MODULE.md](/Users/matt/Documents/shipper/modules/customer-support/MODULE.md) — seed module entry file
- [modules/customer-support/DATA-MODEL.md](/Users/matt/Documents/shipper/modules/customer-support/DATA-MODEL.md), [modules/customer-support/WIDGET.md](/Users/matt/Documents/shipper/modules/customer-support/WIDGET.md), [modules/customer-support/INBOX.md](/Users/matt/Documents/shipper/modules/customer-support/INBOX.md), [modules/customer-support/MAINTENANCE.md](/Users/matt/Documents/shipper/modules/customer-support/MAINTENANCE.md) — seed module reference files
- [src/core/modules.ts](/Users/matt/Documents/shipper/src/core/modules.ts) — module fetch/install/frontmatter logic
- [src/core/modules.test.ts](/Users/matt/Documents/shipper/src/core/modules.test.ts) — tests for the above
- [web/lib/modules.ts](/Users/matt/Documents/shipper/web/lib/modules.ts) — build-time module loader for the site
- [web/app/modules/page.tsx](/Users/matt/Documents/shipper/web/app/modules/page.tsx) — modules index page
- [web/app/modules/[id]/page.tsx](/Users/matt/Documents/shipper/web/app/modules/[id]/page.tsx) — module detail page
- [web/components/copy-module-command.tsx](/Users/matt/Documents/shipper/web/components/copy-module-command.tsx) — copy-command button

Files to modify:

- [src/index.ts](/Users/matt/Documents/shipper/src/index.ts) — register the `modules` command group
- [src/constants.ts](/Users/matt/Documents/shipper/src/constants.ts) — raw content / API URL constants
- [skills/shipper-plan/SKILL.md](/Users/matt/Documents/shipper/skills/shipper-plan/SKILL.md) — module-aware planning flow
- [web/lib/constants.ts](/Users/matt/Documents/shipper/web/lib/constants.ts) — site URL constant for the copy command
- [web/app/docs/layout.tsx](/Users/matt/Documents/shipper/web/app/docs/layout.tsx) — nav link to Modules
- [web/components/footer.tsx](/Users/matt/Documents/shipper/web/components/footer.tsx) and/or [web/components/hero.tsx](/Users/matt/Documents/shipper/web/components/hero.tsx) — link to Modules from the home page
- [web/next.config.ts](/Users/matt/Documents/shipper/web/next.config.ts) — only if needed for reading files outside `web/` (see Gotchas)
- [README.md](/Users/matt/Documents/shipper/README.md) — document modules and the new CLI command

## C: Existing Code to Utilize

- **CLI command registration** — `src/index.ts` already registers a `skills` subcommand with commander; the `modules` command group follows the exact same shape:

```140:146:/Users/matt/Documents/shipper/src/index.ts
  program
    .command("skills")
    .description("install Shipper skills globally for your coding agents")
    .option("--agent <kind>", "install for a specific agent (claude, cursor, opencode)")
    .action(async (opts: { agent?: string }) => {
      await runSkillsInstall(opts.agent);
    });
```

- **Idempotent file writing** — `writeSkillIfChanged()` in [src/core/skills.ts](/Users/matt/Documents/shipper/src/core/skills.ts) (lines 89-102) writes a file only when content differs. Reuse this pattern (copy it into `src/core/modules.ts`; it is not exported) so `shipper modules add` is safe to re-run.
- **Frontmatter parsing** — `parseFrontmatter()` in [src/core/plan-store.ts](/Users/matt/Documents/shipper/src/core/plan-store.ts) (lines 103-141) shows the established pattern: split on `---` lines, parse the block with the `yaml` package (already a dependency), tolerate malformed input by returning a default. Write an analogous `parseModuleFrontmatter()` in `src/core/modules.ts`.
- **GitHub constants** — `GITHUB_REPO = "shipper-is/shipper"` already exists in both [src/constants.ts](/Users/matt/Documents/shipper/src/constants.ts) and [web/lib/constants.ts](/Users/matt/Documents/shipper/web/lib/constants.ts) (kept in sync manually, per the comment in the web copy).
- **Copy-to-clipboard UI** — [web/components/copy-install-command.tsx](/Users/matt/Documents/shipper/web/components/copy-install-command.tsx) is the site's one clipboard component: bordered `<pre>` + inverted button, 2-second "Copied" state, silent failure. `copy-module-command.tsx` should be a close copy of it that accepts the command string as a prop.
- **Card/page layout** — [web/app/docs/skills/page.tsx](/Users/matt/Documents/shipper/web/app/docs/skills/page.tsx) is the template for the modules index page: `max-w-6xl` container, `text-3xl md:text-4xl` heading, `text-white/60` body copy, `border border-white p-6` cards in a `md:grid-cols-2` grid.
- **Skill authoring conventions** — the sibling reference-file pattern used by `shipper-bug` and `shipper-spike` (e.g. "Use the related ./PLAN.md, ./BUILD.md, and ./GIT.md reference files") is the model for how MODULE.md points at its own reference files.

## D: Codebase Conventions to Follow

- **Bun everywhere in the CLI** — prefer `Bun.file()` / `fetch` built-ins; the repo rule file mandates Bun APIs. Note the existing `src/core/*.ts` files use `node:fs/promises` — matching the surrounding file's style is acceptable, but new fetch logic must use the global `fetch`.
- **Tests** — repo root uses vitest (`bun run test` runs `vitest run`); test files sit next to source as `<name>.test.ts` (see `src/core/plan-store.test.ts`). Network calls must be mockable: structure `src/core/modules.ts` so the fetch function can be injected or the URL builder tested separately.
- **TypeScript style** — explicit exported types (`export type ModuleMeta = {...}`), narrow validation helpers (`asMetaString`-style) rather than schema libraries in core files, `satisfies` for const maps.
- **Web: server components by default** — only the copy button needs `"use client"`. Content pages are statically generated; per-page `metadata` exports for titles (see `web/app/docs/skills/page.tsx` lines 3-7).
- **Web styling** — black/white palette only: `text-white/60` secondary text, `border-white` / `border-white/20` borders, `font-mono` for commands, ids, and paths. No new UI libraries.
- **Markdown skill/module files** — YAML frontmatter at the very top; UPPERCASE reference filenames (`DATA-MODEL.md`, not `data-model.md`); relative `./FILE.md` cross-references; no emojis.
- **Kebab-case ids** — module folder names are kebab-case and match the frontmatter `id` (same convention as skill folder names matching frontmatter `name`).

## E: Gotchas

- **The shipper-plan skill is declared READ-ONLY.** Installing a module writes files to `.shipper/modules/`. The skill text must explicitly carve out this exception ("the only writes allowed are the plan file and installing module files into `.shipper/modules/`") or agents will refuse to run the install step.
- **Skills are embedded in the compiled binary and installed globally** from `~/.claude/skills/` etc. Editing `skills/shipper-plan/SKILL.md` only takes effect for users after a new binary release — there is no dynamic skill fetch. Do not try to make the skill "phone home" for updated instructions; the module content itself is what gets fetched dynamically.
- **`skills-lock.json` hashes `SKILL.md` files** for external `skills add` tooling. After editing `skills/shipper-plan/SKILL.md`, the `computedHash` for `shipper-plan` will be stale. Update it (the hash is a sha256 of the SKILL.md content — verify by checking how existing hashes were computed, or regenerate with the external tooling if available). The Shipper binary itself never reads this file, so this only affects external installers.
- **The web app reads files outside its Vercel root directory.** The site's root directory is `web/`, but `web/lib/modules.ts` must read `../modules/*/MODULE.md` at build time. Vercel's "Include source files outside of the Root Directory" setting must be enabled (it is the default for new projects, but verify). Locally this works with plain `node:fs` reads resolved from `process.cwd()` up to the repo root. Since all module pages are statically generated (use `generateStaticParams`), the files are only needed at build time — no runtime fs access on the deployed site.
- **The web app has its own dependency tree** (`web/package.json`, `web/bun.lock`). The `yaml` package available at the repo root is NOT available in `web/`. Either add a small dependency to `web/` for frontmatter parsing (e.g. `yaml`) or hand-roll a minimal key: value parser. Recommendation: add `yaml` to `web/` — module frontmatter may contain lists.
- **Do not render module markdown with `dangerouslySetInnerHTML` or a heavyweight pipeline.** The repo root already uses `react-markdown`; adding `react-markdown` to `web/` is the consistent choice for rendering MODULE.md bodies on detail pages.
- **GitHub API rate limits.** `shipper modules list` and file enumeration for `add` use the unauthenticated GitHub Contents API (60 requests/hour per IP). One request per list and one per add is fine, but fail with a clear error message on 403/429 rather than a stack trace.
- **Modules must stay flat.** The CLI enumerates one directory level (markdown files directly inside `modules/<id>/`). Enforce this as a stated constraint in the module format documentation rather than building recursive fetching.
- **`.shipper/modules/` in user repos should be committed**, like plans — the module files are the long-term reference the agent uses to maintain the feature. State this in the skill and module docs. Do not add it to `ensureShipperDirs()` in [src/core/plan-store.ts](/Users/matt/Documents/shipper/src/core/plan-store.ts) — the folder should only exist in repos that actually use a module (`shipper modules add` creates it).
- **Web content for skills is currently hardcoded and slightly stale** (the docs page still says skills install into the repo, but they install globally now). Modules must NOT repeat this mistake — the index and detail pages render from `modules/` dynamically at build time. That is a hard requirement of this plan.
- **Next.js 16 dynamic route params are async** — in `web/app/modules/[id]/page.tsx`, `params` is a Promise and must be awaited (`const { id } = await params;`).

---

## Plan

## Phase 1: Module format and seed module

- Define the module content format and author the first real module so every later phase has concrete content to build against.
- Outcomes: a documented MODULE.md format; a complete `customer-support` module in `modules/`; a format reference other module authors can follow.

### Section 1: Module format definition

- [x] Create the top-level [modules/](/Users/matt/Documents/shipper/modules/) folder with a `modules/README.md` that documents the format: one folder per module, kebab-case id, flat structure (markdown files only, no subfolders), `MODULE.md` entry file required.
- [x] Define the MODULE.md frontmatter schema in that README with these keys: `type: module` (literal), `id` (matches folder name), `name` (display name), `description` (one sentence for cards and agent context), `category` (e.g. `support`, `analytics`, `growth`), `version` (integer, starts at 1), `replaces` (list of SaaS tools this module replaces, e.g. `[Intercom, Zendesk]` — used for marketing copy on the site).
- [x] Document the stack-adaptive philosophy in the README: modules describe behavior, data model, UX, and architecture in stack-neutral terms; the planning agent adapts them to the host repo's stack; modules must never assume a specific framework, ORM, or database beyond stated soft assumptions.
- [x] Document the body structure convention for MODULE.md: an overview section (what the module is, what SaaS it replaces, why build-not-buy), a "What you get" feature list, an "Assumptions" section (what the host repo should have, e.g. a database and an authenticated user concept), and a "Reference files" section linking sibling files with relative `./FILE.md` links.

### Section 2: Seed module — customer-support

- [x] Create [modules/customer-support/MODULE.md](/Users/matt/Documents/shipper/modules/customer-support/MODULE.md) with valid frontmatter (`id: customer-support`, `category: support`, `replaces: [Intercom, Zendesk, Crisp]`) and a body covering: overview and build-not-buy rationale; feature list (in-app support widget for end users, message threads, an internal inbox/admin view for the team, email notification hooks as an optional extension); assumptions (host app has a database, an authenticated end-user concept, and some notion of admin/staff users); links to the four reference files.
- [x] Write [modules/customer-support/DATA-MODEL.md](/Users/matt/Documents/shipper/modules/customer-support/DATA-MODEL.md): stack-neutral entity descriptions for conversations, messages, and participants — fields, relationships, status lifecycle (open, awaiting-reply, resolved), and indexing guidance. Describe entities in prose plus generic field tables, not SQL for a specific database.
- [x] Write [modules/customer-support/WIDGET.md](/Users/matt/Documents/shipper/modules/customer-support/WIDGET.md): the end-user support widget — placement (floating launcher), conversation list and thread view, message composer, unread indicators, empty states, and accessibility notes.
- [x] Write [modules/customer-support/INBOX.md](/Users/matt/Documents/shipper/modules/customer-support/INBOX.md): the internal team inbox — conversation queue with status filters, assignment to staff, reply flow, resolve/reopen, and basic metrics (open count, median first-response time).
- [x] Write [modules/customer-support/MAINTENANCE.md](/Users/matt/Documents/shipper/modules/customer-support/MAINTENANCE.md): guidance for the agent maintaining the feature over time — where the module's plan and code live, how to extend it (e.g. adding canned responses, email ingestion), and how to re-plan against a newer module version.
- [x] Review all five files against the format README: valid frontmatter, flat folder, relative links resolve, no emojis, stack-neutral language throughout.

#### Completion Notes

- `modules/README.md` is the author-facing format spec; `customer-support` is the reference implementation other modules should mirror.
- Frontmatter uses a YAML list for `replaces` (not inline bracket syntax) so parsers handle it consistently.
- Status enum values use underscores (`awaiting_reply`) in the data model; display copy may use spaces.
- Phase 2+ should treat `modules/customer-support/` as the fixture for CLI list/add tests and web static generation.

## Phase 2: CLI — `shipper modules` command

- Add the ability to discover and install modules from the CLI. This is the mechanism the shipper-plan skill invokes.
- Outcomes: `shipper modules list` prints available modules from GitHub; `shipper modules add <id-or-url>` installs a module into `.shipper/modules/<id>/` in the current directory; both are covered by tests.

### Section 1: Core module logic

- [x] Add constants to [src/constants.ts](/Users/matt/Documents/shipper/src/constants.ts): `MODULES_BRANCH = "main"`, a raw-content base URL builder (`https://raw.githubusercontent.com/${GITHUB_REPO}/main/modules/`), a GitHub Contents API URL builder (`https://api.github.com/repos/${GITHUB_REPO}/contents/modules`), and `SITE_URL = "https://shipper.is"`.
- [x] Create [src/core/modules.ts](/Users/matt/Documents/shipper/src/core/modules.ts) with: `export type ModuleMeta = { id, name, description, category, version, replaces }`; `parseModuleFrontmatter(markdown): ModuleMeta | null` following the `parseFrontmatter` pattern from [src/core/plan-store.ts](/Users/matt/Documents/shipper/src/core/plan-store.ts) (yaml package, tolerant of malformed input, returns null when `type` is not `module`).
- [x] Add `parseModuleReference(input: string): string | null` to the same file: accepts a bare kebab-case id (`customer-support`), a site URL (`https://shipper.is/modules/customer-support`, with or without trailing slash), or a GitHub URL to the module folder, and returns the module id. Pure function, easy to test.
- [x] Add `listRemoteModules(fetchFn = fetch)` — calls the Contents API on `modules/`, filters to directories, and for each fetches `MODULE.md` from the raw URL and parses frontmatter to return `ModuleMeta[]`. Skip entries whose MODULE.md is missing or invalid rather than failing the whole list.
- [x] Add `installModule(id: string, targetDir: string, fetchFn = fetch)` — calls the Contents API on `modules/<id>` to enumerate files, filters to `.md` files, downloads each from its raw URL, and writes them into `<targetDir>/.shipper/modules/<id>/` using a write-if-changed helper copied from the `writeSkillIfChanged` pattern in [src/core/skills.ts](/Users/matt/Documents/shipper/src/core/skills.ts). Return a summary (`{ id, files: string[], root: string }`). Throw a descriptive `Error` for: unknown module (404), rate-limited API (403/429 with a message mentioning GitHub rate limits), and missing/invalid MODULE.md in the fetched set.
- [x] Accept `fetchFn` as an injectable parameter (defaulting to global `fetch`) so tests never hit the network.

### Section 2: CLI wiring

- [x] In [src/index.ts](/Users/matt/Documents/shipper/src/index.ts), add a `modules` command group modeled on the existing `skills` command: `shipper modules list` prints each module as `id — name: description` lines; `shipper modules add <module>` resolves the reference via `parseModuleReference`, runs `installModule` against `process.cwd()` (respecting the existing `--dir` global option if present on the parsed options), and prints the installed file list and destination path.
- [x] On success, `add` should print a next-step hint: `Run /shipper-plan <id> in your coding agent to plan the build.`
- [x] Handle errors by printing `error.message` and exiting with code 1, matching the style of `runSkillsInstall` error handling.

### Section 3: Tests

- [x] Create [src/core/modules.test.ts](/Users/matt/Documents/shipper/src/core/modules.test.ts) covering: `parseModuleReference` for bare ids, shipper.is URLs (with/without trailing slash), GitHub URLs, and invalid input; `parseModuleFrontmatter` for valid frontmatter, missing frontmatter, wrong `type`, and malformed YAML; `installModule` with a stubbed `fetchFn` asserting files land in `.shipper/modules/<id>/` (use a temp dir), re-running is a no-op for unchanged content, and 404/403 produce the descriptive errors.
- [x] Run `bun run typecheck`, `bun run lint`, and `bun run test` and fix any failures.

#### Completion Notes

- `src/core/modules.ts` exports `modulePlanHint()` for the CLI next-step message; Phase 3 can reuse the same copy in skill text.
- `parseModuleReference` accepts GitHub `tree` and `blob` URLs under `modules/<id>` (optional trailing path for blob links to specific files).
- `installModule` validates MODULE.md after writing files; a module folder with only invalid markdown fails install even if the API returned files.
- `shipper modules add` reads the root `--dir` option via commander `optsWithGlobals()` — same pattern Phase 3 should document for agents running the CLI from a non-cwd repo.
- Remote list/add hit the live GitHub API in production; tests stub `fetch` entirely. Until this branch merges to `main`, `shipper modules list` against production will not include `customer-support` yet.

## Phase 3: Module-aware shipper-plan skill

- Teach the planning skill to recognize module references and plan a module build.
- Outcomes: pasting `/shipper-plan https://shipper.is/modules/customer-support` into any supported agent installs the module and produces a tailored plan; the non-module planning flow is unchanged.

### Section 1: Skill content

- [x] Update [skills/shipper-plan/SKILL.md](/Users/matt/Documents/shipper/skills/shipper-plan/SKILL.md) with a new "Module references" section placed after the intro: if the user's request contains a Shipper module reference (a `shipper.is/modules/<id>` URL, a `modules/<id>` GitHub URL, or an explicit module id), follow the module flow below; otherwise the existing four-step flow applies unchanged.
- [x] Document the module flow in the skill: (1) install the module by running `shipper modules add <id>`; if the `shipper` CLI is not installed, fall back to fetching `https://raw.githubusercontent.com/shipper-is/shipper/main/modules/<id>/MODULE.md` plus each reference file it links, writing them to `.shipper/modules/<id>/`; (2) read every file in `.shipper/modules/<id>/` — the module is the feature spec; (3) explore the host codebase to map the module's stack-neutral requirements (data model, UI surfaces, auth assumptions) onto the repo's actual stack and conventions; (4) ask clarifying questions focused on integration choices the module leaves open (placement, naming, which optional features to include) — do not re-ask things the module already decides; (5) write the plan, citing both module files (as the spec) and host repo files (as the integration points).
- [x] Amend the read-only rule in the skill: the allowed writes are the plan markdown file and the module files installed into `.shipper/modules/<id>/` (via the CLI or the fallback fetch). Running `shipper modules add` is explicitly permitted.
- [x] Require module plans to note the module id and version in the plan body (e.g. a line in the Plan Overview: "Built from module `customer-support` v1") so future maintenance can detect drift, and to instruct that `.shipper/modules/` is committed to the repo.
- [x] Update the stale `computedHash` for `shipper-plan` in [skills-lock.json](/Users/matt/Documents/shipper/skills-lock.json) — first verify how the existing hashes are derived (sha256 of the SKILL.md bytes is the likely scheme; confirm by hashing an unchanged skill file and comparing).

### Section 2: Docs alignment

- [x] Update [README.md](/Users/matt/Documents/shipper/README.md): add a "Modules" section explaining the concept (open source, agent-built replacements for SaaS features), the `shipper modules list` / `shipper modules add` commands, the `/shipper-plan <module-url>` flow, and that module files live in `.shipper/modules/` (committed).
- [x] Update the mirrored skill description in [web/app/docs/skills/page.tsx](/Users/matt/Documents/shipper/web/app/docs/skills/page.tsx) so the `shipper-plan` card mentions module planning (this file is hardcoded; keep the copy short).

#### Completion Notes

- `skills-lock.json` uses sha256 of raw `SKILL.md` bytes; all pre-existing lock hashes were already stale vs current files on `main` — only `shipper-plan` was updated in this phase.
- Module flow is placed before the standard flow so agents branch early; the read-only carve-out is in the "Standard flow" section and applies to module installs too.
- Phase 4 should use `modulePlanCommand(id)` returning `/shipper-plan https://shipper.is/modules/${id}` — the skill and README use the full URL form consistently.

## Phase 4: Web — Modules pages on shipper.is

- Surface modules on the marketing site with copyable plan commands, rendered from the repo's `modules/` folder at build time.
- Outcomes: `/modules` index page explaining the concept and listing all modules; `/modules/[id]` detail pages rendering MODULE.md; copy buttons producing `/shipper-plan https://shipper.is/modules/<id>`; nav links from home and docs.

### Section 1: Build-time module loading

- [x] Add `yaml` and `react-markdown` to [web/package.json](/Users/matt/Documents/shipper/web/package.json) dependencies via `bun install` inside `web/`.
- [x] Add `SITE_URL = "https://shipper.is"` and a `moduleplanCommand(id)` helper (returns `/shipper-plan ${SITE_URL}/modules/${id}`) to [web/lib/constants.ts](/Users/matt/Documents/shipper/web/lib/constants.ts).
- [x] Create [web/lib/modules.ts](/Users/matt/Documents/shipper/web/lib/modules.ts): resolve the repo-root `modules/` directory relative to the web app (e.g. `path.join(process.cwd(), "..", "modules")`, with a comment noting the Vercel "include files outside root directory" requirement); export `getAllModules(): ModuleEntry[]` (read each `modules/*/MODULE.md`, parse frontmatter with `yaml`, skip invalid entries, sort by name) and `getModule(id): ModuleEntry | null` (frontmatter plus the markdown body with frontmatter stripped, and the list of sibling reference files). Server-only module — never import it from a client component.
- [x] Verify the local build picks up the seed module: run `bun run build` inside `web/` and confirm `/modules` and `/modules/customer-support` appear in the static generation output.

### Section 2: Index page

- [x] Create [web/app/modules/page.tsx](/Users/matt/Documents/shipper/web/app/modules/page.tsx) with `metadata` export. Structure it like the skills docs page: heading ("Modules"), then an explainer section covering the pitch — SaaS tools made sense when building was expensive; agents changed that; Modules are opinionated, open source feature specs your agent builds directly into your codebase, so you own the code and the agent can maintain it. Then a short "How it works" list: copy the command, paste it into your coding agent, review the plan, build it with shipper-build.
- [x] Render a card per module from `getAllModules()`: `font-mono` module id, display name, description, category, "replaces Intercom, Zendesk, Crisp" line from the `replaces` frontmatter, a link to the detail page, and an inline copy button for the plan command.
- [x] Reuse the existing card styling (`border border-white p-6`, grid `md:grid-cols-2`) and black/white palette.

### Section 3: Detail page and copy component

- [x] Create [web/components/copy-module-command.tsx](/Users/matt/Documents/shipper/web/components/copy-module-command.tsx) as a `"use client"` component modeled on [web/components/copy-install-command.tsx](/Users/matt/Documents/shipper/web/components/copy-install-command.tsx), taking the command string as a prop (same bordered `<pre>` + inverted Copy button + 2s "Copied" feedback).
- [x] Create [web/app/modules/[id]/page.tsx](/Users/matt/Documents/shipper/web/app/modules/[id]/page.tsx): `generateStaticParams` from `getAllModules()`; `generateMetadata` from the module name/description; `await params` (Next 16 async params); `notFound()` for unknown ids. Page layout: module name heading, description, the copy-command block near the top, the rendered MODULE.md body via `react-markdown` (style headings/lists/code with the site's palette using component overrides or prose-like utility classes), and a "Reference files" list linking to the files on GitHub (`${GITHUB_URL}/tree/main/modules/<id>`).
- [x] Add "Modules" links: nav item in [web/app/docs/layout.tsx](/Users/matt/Documents/shipper/web/app/docs/layout.tsx), a link in [web/components/footer.tsx](/Users/matt/Documents/shipper/web/components/footer.tsx), and a card on [web/app/docs/page.tsx](/Users/matt/Documents/shipper/web/app/docs/page.tsx) alongside the console and skills cards.

### Section 4: Verification

- [x] Run `bun run build` in `web/` and confirm all module routes statically generate without errors.
- [x] Manually verify with `bun run dev` in `web/`: index page renders the customer-support card, detail page renders the full MODULE.md, the copy button copies exactly `/shipper-plan https://shipper.is/modules/customer-support`, and nav links work.
- [x] From the repo root, run `bun run typecheck`, `bun run lint`, and `bun run test` one final time to confirm nothing in the CLI regressed.

#### Completion Notes

- `web/app/modules/layout.tsx` adds a shared header (Home / Docs / Modules) for module pages; not in the original file list but mirrors `docs/layout.tsx`.
- `modulePlanCommand()` in `web/lib/constants.ts` matches the full-URL form used by the shipper-plan skill and README.
- `web/lib/modules.ts` duplicates frontmatter parsing from `src/core/modules.ts` — keep in sync if the schema changes.
- Static build confirms `/modules` and `/modules/customer-support`; adding a new folder under `modules/` auto-generates routes on next deploy with no code changes.
