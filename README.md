# Shipper

Shipper is a standalone CLI for planning and building features with the coding agent you already use. Skills such as `shipper-plan`, `shipper-loop`, and `shipper-build` run in Claude Code, Cursor, or opencode. Running `shipper` with no command opens a local setup console that shows how this repo and this user are configured.

It ships as a compiled binary — no Node.js required at runtime.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/shipper-is/shipper/main/install.sh | sh
```

Pin a version:

```bash
SHIPPER_VERSION=0.2.7 sh -c 'curl -fsSL https://raw.githubusercontent.com/shipper-is/shipper/main/install.sh | sh'
```

macOS binaries are **unsigned** in v1. Installing via `curl | sh` avoids Gatekeeper quarantine; downloading the binary directly in a browser may require removing the quarantine attribute or allowing it in System Settings.

Shipper checks for updates once a day. When a newer release exists, the setup console shows an "Update available" badge with the install command. Upgrade from the terminal with `shipper update` (runs the same install script), or `shipper update --check` to see whether you are behind.

## What it does

1. **Plan** — in your coding agent, run `/shipper-plan`. The skill writes a structured markdown plan to the configured plans directory (default `.shipper/plans/open/`).
2. **Build** — run `/shipper-loop` on that plan. The agent drives every remaining phase through `shipper-build` subagents, then moves the finished plan to `<plans>/done/` (default `.shipper/plans/done/`).
3. **See the setup** — run `shipper` to open the setup console: configuration, artifact directories, installed skills, MCP registration, the search index, and detected agents.

Running `shipper` starts a local web server and opens your browser at **`http://shipper.localhost`** (port 80). If port 80 is unavailable, it binds the first free port from 8712 upward. Browsers resolve `*.localhost` to your machine with no hosts-file setup. Shipper deliberately uses `.localhost`, not `.local` — the latter is reserved for Bonjour/mDNS and behaves unreliably.

The first run installs the bundled skills into each detected agent's global skills directory and creates the default artifact folders. It does not create `.shipper/config.json` or `.shipper/config.local.json` until you save configuration.

Agents run in your own coding agent. The console does not start plan or build sessions.

### Setup console

The page has seven sections:

- **Overview** — one-line status for configuration, artifacts, skills, MCP, search, and agents.
- **Configuration** — the merged settings, plus editable Repo, Local, and Global files.
- **Artifacts** — configured directories, open and done counts, and stray files left in an old default directory.
- **Skills** — whether each bundled skill matches the copy installed for each detected agent. **Refresh skills** reinstalls them.
- **Search** — whether search is on, the index, and the local embedding server. **Sync index**, **Rebuild index**, **Start server**, and **Stop server** live here. Index actions stay disabled when `search.enabled` is false.
- **MCP** — registration state per detected agent, with install and uninstall.
- **Agents** — which of Claude Code, Cursor, and opencode are on this machine, with install hints for the ones that are not.

A warning marker appears next to a section that needs attention (a broken config file, stray artifacts, outdated skills, an unregistered MCP server, or a stale index).

## Supported agents

| Agent | How Shipper uses it |
|-------|---------------------|
| **Claude Code** | Skills install under `~/.claude/skills/`. MCP registers with `claude mcp`. |
| **Cursor** | Skills install under `~/.cursor/skills/`. MCP registers in `~/.cursor/mcp.json`. |
| **opencode** | Skills install under `~/.config/opencode/skills/`. MCP registers in `opencode.json`. |

There is no per-project default agent. You invoke the skills in whichever agent you have open. Model ids in config apply only when a skill starts a subagent (for example `shipper-loop` starting `shipper-build`), and only if that agent's tool accepts the id.

## Where things live

Artifact directories below are the **defaults**. A repo can move them with `paths` in `.shipper/config.json`. Plans, spikes, and bugs keep fixed `open/` and `done/` subfolders. Reviews sit directly in their directory.

| Path | Contents |
|------|----------|
| `<repo>/.shipper/config.json` | Committed repo config (shared by the team) |
| `<repo>/.shipper/config.local.json` | This user's overrides for this repo (not committed) |
| `<repo>/.shipper/.gitignore` | Keeps `config.local.json` out of git |
| `<repo>/.shipper/plans/open/` | Active plans, default location (commit these) |
| `<repo>/.shipper/plans/done/` | Completed plans, default location |
| `<repo>/.shipper/spikes/open/` | Active spikes, default location |
| `<repo>/.shipper/spikes/done/` | Completed spikes, default location |
| `<repo>/.shipper/bugs/open/` | Open bug reports, default location |
| `<repo>/.shipper/bugs/done/` | Fixed bugs, default location |
| `<repo>/.shipper/reviews/` | Reviews, default location |
| `~/.config/shipper/config.json` | Global user defaults and machine state (`embeddings`, `state`) |
| `~/.cache/shipper/llama/` | Pinned llama.cpp `llama-server` binary (per platform) |
| `~/.cache/shipper/models/` | Embedding GGUF (`nomic-embed-text-v1.5` Q4_K_M) |
| `~/.cache/shipper/embed/` | Embedding server state, lock, idle timer, daemon log |
| `~/.cache/shipper/index/` | Per-repo semantic search index files |
| `~/.claude/skills/shipper-*/` | Global skills for Claude Code |
| `~/.cursor/skills/shipper-*/` | Global skills for Cursor |
| `~/.config/opencode/skills/shipper-*/` | Global skills for opencode |

`$XDG_CONFIG_HOME/shipper/config.json` is the global file when `XDG_CONFIG_HOME` is set.

Bundled `shipper-plan`, `shipper-loop`, `shipper-build`, `shipper-spike`, `shipper-ship`, and `shipper-bug` skills are embedded in the binary and installed **globally** for each detected coding agent on startup (or via `shipper skills`). Repos no longer receive skill copies — stale per-repo copies from older versions are removed on boot.

## Configuration

Three JSON files share one settings shape. Missing files are normal.

| Layer | Path | Committed? |
|-------|------|------------|
| Global user defaults | `$XDG_CONFIG_HOME/shipper/config.json`, or `~/.config/shipper/config.json` | No. Applies to every repo for this user. |
| Repo config | `<repo>/.shipper/config.json` | Yes. Shared by the team. |
| Local override | `<repo>/.shipper/config.local.json` | No. Shipper writes `.shipper/.gitignore` so this file stays untracked. |

**Precedence** (lowest to highest): built-in defaults, then global, then repo, then local. Objects merge field by field: a local `git.branchMode` replaces only that field, not the whole `git` object. Arrays such as `search.extraDirs` are replaced, not combined. What you ask for in the current chat always beats config.

Two exceptions:

- **`paths` and `review` are repo-only.** Plans are committed, so the team has to agree where they live, and review thresholds are team policy that one person should not be able to lower locally. Either key in the global or local file is ignored. The setup console lists those keys as ignored, shows the review policy on the Effective tab (including the built-in risk rules), and edits `review` only on the Repo tab.
- **`instructions` accumulate.** Order: global `all`, global skill, repo `all`, repo skill, local `all`, local skill. Empty strings are skipped. When two conflict, the later text wins. They never override a skill's hard rules or an explicit request in the chat. Skill names are `shipper-plan`, `shipper-build`, `shipper-loop`, `shipper-spike`, `shipper-ship`, and `shipper-bug`. `shipper-review` follows `instructions.all` only.

A file that is not valid JSON, or that gives a known key a value that key does not allow, is skipped entirely (one bad field drops the file). Unknown keys are kept and do not make the file invalid. An invalid path keeps that artifact type's default and does not drop the rest of the file. Paths are relative, use forward slashes, and must stay inside the repo (no `..` escapes, no `.git` or `node_modules` segments).

`git.branchMode` left unset means each skill uses its own default (`shipper-build` and `shipper-loop` stay on the current branch; `shipper-spike` and `shipper-bug` create a feature branch). `models` supply the launch model when a skill starts another Shipper skill, and the role or tier when a skill starts its own helpers. If the subagent tool rejects an id, retry that subagent once without a model.

`shipper config` prints each layer and the effective value of every key, with the layer it came from. `shipper config --json` prints the same data as JSON. `shipper config path` prints the three file paths. `shipper models list` prints the models each installed harness reports. `shipper models list --agent <claude|cursor|opencode> --json` prints `{ "agents": { "<kind>": [{ "id", "label" }] } }`.

| Key | Default | Meaning |
|-----|---------|---------|
| `paths.plans` | `.shipper/plans` | Plans live in `<plans>/open/` and `<plans>/done/` |
| `paths.spikes` | `.shipper/spikes` | Spikes live in `<spikes>/open/` and `<spikes>/done/` |
| `paths.bugs` | `.shipper/bugs` | Bugs live in `<bugs>/open/` and `<bugs>/done/` |
| `paths.reviews` | `.shipper/reviews` | Reviews live directly in `<reviews>/` |
| `git.branchMode` | not set | `"current"` or `"feature"`. When not set, each skill uses its own default |
| `git.commitEachPhase` | `true` | shipper-build and shipper-loop: commit after each phase |
| `git.branchPrefix` | `"shipper/"` | Prefix for feature branches Shipper creates. Letters, digits, `.`, `_`, `/`, and `-` only |
| `instructions.all` | none | Extra instructions for every Shipper skill |
| `instructions.<skill-name>` | none | Extra instructions for one skill. Names: `shipper-plan`, `shipper-build`, `shipper-loop`, `shipper-spike`, `shipper-ship`, `shipper-bug` |
| `models.<agent>.<skill-name>` | none | Launch model when starting that skill as a subagent: a string, or `{ "model" }` when that skill also has a role. Agents: `claude`, `cursor`, `opencode`. Same skill names as instructions (see `skills/CONFIG.md`) |
| `models.<agent>.shipper-plan.research` | none | Research subagents while planning |
| `models.<agent>.shipper-spike.research` | none | Research subagents while planning a spike |
| `models.<agent>.shipper-bug.investigate` | none | Investigation subagents while diagnosing a bug |
| `models.<agent>.shipper-loop.phase` | falls back to `models.<agent>.shipper-build` | Model for each phase subagent |
| `models.<agent>.shipper-review.triage` | none | One model id for the triage subagent |
| `models.<agent>.shipper-review.light` | none | Ordered list of model ids for light-tier reviewers |
| `models.<agent>.shipper-review.heavy` | none | Ordered list of model ids for heavy-tier reviewers |
| `search.enabled` | `true` | Whether to use the `shipper_search` MCP tools |
| `search.extraDirs` | `[]` | Extra markdown directories included in search |
| `review.riskFloor` | `[]` | shipper-review: extra `{ name, paths, lanes }` rules that force heavy review, added to the built-in auth, billing, migration, infra, dependency, and secrets rules |
| `review.replaceDefaultRiskFloor` | `false` | shipper-review: drop the built-in risk-floor rules |
| `review.floorIgnore` | `["*.md", "*.mdx"]` | shipper-review: globs that never trigger a risk-floor rule |
| `review.sampleRate` | `0.05` | shipper-review: share of low-risk units that get a heavy review anyway |
| `review.budget` | `{ "maxFiles": 150, "maxChangedLines": 6000 }` | shipper-review: a larger diff escalates instead of being reviewed |
| `review.evidenceKinds.<lane>` | see `skills/shipper-review/scripts/config.ts` | shipper-review: proof kinds that let a finding block, per lane |

Example repo config:

```json
{
  "paths": {
    "plans": "docs/shipper/plans",
    "spikes": "docs/shipper/spikes"
  },
  "git": { "branchMode": "feature", "branchPrefix": "feat/" },
  "instructions": {
    "all": "This repo uses pnpm workspaces. Never edit generated files under src/gen/.",
    "shipper-plan": "Every plan must include a rollout and rollback section."
  },
  "search": { "extraDirs": ["docs/adr"] }
}
```

Example local override:

```json
{
  "git": { "commitEachPhase": false },
  "models": {
    "cursor": {
      "shipper-build": "composer-2.5",
      "shipper-plan": { "model": "composer-2.5", "research": "composer-2.5-fast" },
      "shipper-review": {
        "triage": "composer-2.5-fast",
        "light": ["composer-2.5-fast", "gpt-5.4-mini"],
        "heavy": ["gpt-5.4", "claude-opus-4.8"]
      }
    }
  },
  "instructions": { "all": "Explain changes to me in plain language; I am new to this codebase." }
}
```

Changing `paths` does not move existing files. The Artifacts section warns when markdown is still sitting in a default directory you no longer use. Commit `.shipper/config.json` so the team shares the repo layer.

The global file also stores machine state the console does not edit: embedding idle minutes (`embeddings.idleMinutes`) and the daily update check (`state`). An older global file shaped as `{ projects, defaults }` is migrated on boot and on `shipper skills`. Project agent choices from that file are dropped.

## Development

Requires [Bun](https://bun.sh).

```bash
bun install
bun run dev                    # setup console in the current directory
bun run dev -- --dir /path/to/repo
bun run typecheck
bun test
bun run build                  # local platform → dist/shipper
bun run build:release          # all four release targets → dist/shipper-*
./dist/shipper --version
```

### Release

Push a `v*` tag to trigger `.github/workflows/release.yml`, which builds `shipper-darwin-arm64`, `shipper-darwin-x64`, `shipper-linux-x64`, and `shipper-linux-arm64` with SHA256 checksums attached to the GitHub Release.

```bash
git tag v0.2.7 && git push origin v0.2.7
```

## Semantic search (MCP)

Shipper can give your coding agent semantic search over plans, spikes, bugs, and reviews — open and done — in the configured artifact directories (default `.shipper/`). An MCP server embeds chunks with a small local model and ranks results by meaning, so questions like "have we planned something like this before?" or "is this a regression of an old bug?" take one tool call instead of grepping hundreds of files.

`shipper search --type` accepts `plan`, `spike`, `bug`, `review`, and `doc`. Directories listed in `search.extraDirs` are included as type `doc`. That scan is not recursive in v1: only markdown files directly inside each extra directory are indexed.

Set `search.enabled` to `false` to turn search off. `shipper index`, `shipper search`, and the search MCP tools then tell the agent to use grep or glob instead. `shipper_get_doc` and `shipper_list_docs` keep working.

### One-step setup

```bash
shipper mcp install
```

This registers the MCP server with every detected agent (Claude Code, Cursor, opencode), prefetches the embedding assets, and prints a reminder to restart your agent. Use `--agent <claude|cursor|opencode>` to target one agent, or `--no-download` to skip the prefetch. The setup console can install and uninstall MCP per agent as well.

On first use, Shipper downloads a pinned llama.cpp build from GitHub (about 12–17 MB depending on platform) and an 84 MB GGUF embedding model from Hugging Face (`nomic-embed-text-v1.5` Q4_K_M). Both are SHA-256 verified into `~/.cache/shipper/`. Everything runs on `127.0.0.1` — no embeddings or document text leave your machine.

The shared embedding server shuts down after 15 idle minutes by default. Change that with `shipper embed start --idle-minutes <n>` (persisted in the global config), or manage it from the console or with `shipper embed start|stop|status`.

### MCP tools

| Tool | Purpose |
|------|---------|
| `shipper_search` | Semantic search across plans, spikes, bugs, reviews, and extra-dir docs |
| `shipper_similar` | Find documents similar to an existing Shipper file |
| `shipper_get_doc` | Read a markdown file inside a Shipper artifact directory (optional line range) |
| `shipper_list_docs` | List Shipper documents from the configured directories |
| `shipper_reindex` | Rebuild or refresh the search index |

Bundled skills (`shipper-plan`, `shipper-spike`, `shipper-bug`, `shipper-build`) call `shipper_search` when search is enabled and the tool is available, and fall back to grep/glob otherwise.

### Manual agent config

If `shipper mcp install` cannot write a config (unparseable JSON, or opencode's `.jsonc`), paste one of these (adjust the `shipper` binary path if it is not on your `PATH`):

**Cursor** — `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "shipper": {
      "command": "shipper",
      "args": ["mcp", "--dir", "${workspaceFolder}"]
    }
  }
}
```

**opencode** — `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "shipper": {
      "type": "local",
      "command": ["shipper", "mcp"],
      "enabled": true
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add --scope user shipper -- shipper mcp
```

### Removal

```bash
shipper mcp uninstall
shipper embed stop
rm -rf ~/.cache/shipper
```

## CLI

### Commands

| Command | Description |
|---------|-------------|
| `shipper` | Open the setup console (default) |
| `shipper config` | Show the effective configuration and which layer set each key |
| `shipper config path` | Print the global, repo, and local config file paths |
| `shipper models list` | Print the models each installed harness reports |
| `shipper update` | Install the latest release (or `--check` for status only) |
| `shipper skills` | Install or refresh global skills for detected agents |
| `shipper embed start\|stop\|status` | Manage the shared local embedding server |
| `shipper index` | Build or refresh the semantic search index |
| `shipper search <query>` | Semantically search plans, spikes, bugs, reviews, and docs |
| `shipper mcp` | Run the Shipper MCP server (stdio) |
| `shipper mcp install\|uninstall` | Register or unregister the MCP server with agents |

Use `shipper skills` without starting the console when you want the bundled skills in your own coding agent — e.g. type `/shipper-plan` in Cursor or Claude Code to plan a feature directly in your editor.

```bash
shipper skills                  # install for all detected agents
shipper skills --agent cursor   # force install for one agent
shipper config                  # effective settings for this repo
shipper config --json           # the same data as JSON
shipper config path             # the three config file paths
shipper models list             # models each installed harness reports
shipper models list --json      # the same catalog as JSON
```

### Flags

| Flag | Description |
|------|-------------|
| `--dir <path>` | Target repository (default: current directory) |
| `--port <n>` | HTTP port override (default: 80, then the first free port from 8712 upward) |
| `--no-open` | Do not open the browser automatically |
| `--version` | Print version and exit |
| `--json` | On `shipper config`, `shipper search`, and `shipper models list`, print JSON |
| `--type <types>` | On `shipper search`, comma-separated types: `plan`, `spike`, `bug`, `review`, `doc` |
| `--status <status>` | On `shipper search`: `open`, `done`, or `any` |
| `--limit <n>` | On `shipper search`, max results (1–25) |
| `--force` | On `shipper index`, rebuild the index from scratch |
| `--agent <kind>` | On `skills`, `mcp install`, `mcp uninstall`, and `models list`: `claude`, `cursor`, or `opencode` |
| `--no-download` | On `mcp install`, skip prefetching the embedding model |
| `--idle-minutes <n>` | On `embed start`, persist the idle shutdown time |
