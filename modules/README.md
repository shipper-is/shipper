# Shipper Modules

Shipper Modules are open source, opinionated feature specs that coding agents build directly into your codebase. Each module describes behavior, data model, UX, and architecture in stack-neutral terms so the planning agent can adapt them to your repo's framework, ORM, and conventions.

## Folder structure

- One folder per module at the top level of `modules/`.
- The folder name is the module **id** — kebab-case only (e.g. `customer-support`).
- **Flat structure:** markdown files live directly inside the module folder. No subfolders.
- **`MODULE.md` is required** — it is the entry file every consumer reads first.
- Optional reference files use UPPERCASE names (e.g. `DATA-MODEL.md`, `WIDGET.md`) and are linked from `MODULE.md` with relative paths (`./DATA-MODEL.md`).

## MODULE.md frontmatter

Every `MODULE.md` must start with YAML frontmatter between `---` delimiters:

```yaml
---
type: module
id: customer-support
name: Customer Support
description: In-app support widget and team inbox for end-user conversations.
category: support
version: 1
replaces:
  - Intercom
  - Zendesk
  - Crisp
---
```

| Key | Required | Description |
|-----|----------|-------------|
| `type` | yes | Must be the literal `module`. |
| `id` | yes | Kebab-case identifier; must match the folder name. |
| `name` | yes | Human-readable display name for cards and headings. |
| `description` | yes | One sentence for marketplace cards and agent context. |
| `category` | yes | Grouping label (e.g. `support`, `analytics`, `growth`). |
| `version` | yes | Integer; starts at `1`. Increment when the spec changes in breaking or material ways. |
| `replaces` | yes | List of SaaS products this module replaces (marketing copy on shipper.is). |

## Stack-adaptive philosophy

Modules describe **what** to build, not **how** to wire a specific stack:

- Use stack-neutral language: entities, relationships, user flows, and UI behavior — not framework-specific APIs, ORM models, or database dialects.
- State soft assumptions explicitly (e.g. "the host app has a database and authenticated users") rather than hard-coding React, Postgres, or Supabase.
- Reference files may include generic field tables and lifecycle diagrams in prose; avoid SQL or JSX that locks consumers to one stack.
- The **shipper-plan** skill reads the module, explores the host repo, and produces a tailored plan that maps module requirements onto the repo's actual conventions.

## MODULE.md body structure

After the frontmatter, `MODULE.md` should include these sections (headings may vary slightly, but the content must be present):

1. **Overview** — What the module is, which SaaS tools it replaces, and the build-not-buy rationale (you own the code; the agent can maintain it).
2. **What you get** — Bullet list of concrete features the implementation should deliver.
3. **Assumptions** — What the host repo should already have (database, auth model, admin roles, etc.).
4. **Reference files** — Links to sibling markdown files with `./FILE.md` relative paths and a one-line description of each.

## Authoring conventions

- No emojis.
- Kebab-case ids; UPPERCASE reference filenames.
- Cross-reference sibling files with relative `./` links only.
- Keep reference files focused: one concern per file (data model, a UI surface, maintenance guidance).
- When you change behavior or schema in a material way, bump `version` in frontmatter.

## Installing modules in a project

Users install modules with `shipper modules add <id>`, which copies markdown into `.shipper/modules/<id>/` in their repo. That folder should be **committed** — it is the long-term spec the agent uses when maintaining the feature.

To plan a build: `/shipper-plan https://shipper.is/modules/<id>` in a supported coding agent.
