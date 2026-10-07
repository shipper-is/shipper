# Shipper

Shipper is a standalone CLI that orchestrates AI coding agents to **plan** and **build** features in any repository. It ships as a compiled binary with a local web workspace — no Node.js required at runtime.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/shipper-is/shipper/main/install.sh | sh
```

Pin a version:

```bash
SHIPPER_VERSION=0.2.2 sh -c 'curl -fsSL https://raw.githubusercontent.com/shipper-is/shipper/main/install.sh | sh'
```

macOS binaries are **unsigned** in v1. Installing via `curl | sh` avoids Gatekeeper quarantine; downloading the binary directly in a browser may require removing the quarantine attribute or allowing it in System Settings.

Shipper checks for updates once per day and shows the install command in the UI when a newer release is available. There is no self-update in v1 — re-run the install script to upgrade.

## What it does

1. **Plan** — runs the `shipper-plan` skill through your coding agent to produce a structured markdown plan in `.shipper/plans/open/`.
2. **Build** — runs the `shipper-loop` skill so the agent orchestrates every remaining phase (via `shipper-build` subagents) until the plan is complete, moving finished plans to `.shipper/plans/done/`.

Running `shipper` starts a local web server and opens your browser at **`http://shipper.localhost`** (port 80, with fallback to `:8712` if 80 is unavailable). Browsers resolve `*.localhost` to your machine with no hosts-file setup. Shipper deliberately uses `.localhost`, not `.local` — the latter is reserved for Bonjour/mDNS and behaves unreliably.

The workspace has three sections:

- **Left nav** — open and done plans, live-updating from `.shipper/`
- **Main window** — plan overview, agent chat, inline questions, follow-up messages, build controls
- **Right rail** — a passthrough terminal (real PTY) for interactive commands like `vim` or `git add -p`

### New plan flow

1. Click **New plan** (or press `n`), describe the feature.
2. Confirm the agent and model if prompted; Shipper refreshes bundled skills in your global agent directories and starts a headless agent session.
3. Answer clarifying questions inline when prompted.
4. A new plan file appears in `.shipper/plans/open/`.

### Build flow

1. Select an open plan and click **Build** (or press `b`).
2. Shipper starts one agent session with `shipper-loop`; that agent drives every remaining phase to completion.
3. Progress updates live as the agent (and its subagents) check boxes in the plan file.
4. Questions from the orchestrator pause the run; everything else continues in that single session.

## Supported agents

| Agent | Question handling |
|-------|-------------------|
| **Claude Code** | Native `AskUserQuestion` via the Agent SDK (`canUseTool`). |
| **Cursor CLI** | Shipper question protocol (fenced `shipper-question` JSON blocks). Cursor's native AskQuestion is unusable headlessly — it fabricates "skipped" answers. |
| **opencode** | Same question protocol as Cursor. The built-in `question` tool stalls under the SDK, so the protocol preamble overrides it. |

Agent choice is stored per project on your machine (`~/.config/shipper/`), not in the repo — so teammates can use different agents on the same codebase.

## Where things live

| Path | Contents |
|------|----------|
| `<repo>/.shipper/plans/open/` | Active plans (commit these) |
| `<repo>/.shipper/plans/done/` | Completed plans |
| `<repo>/.shipper/spikes/open/` | Active spikes |
| `<repo>/.shipper/spikes/done/` | Completed spikes |
| `<repo>/.shipper/bugs/open/` | Open bug reports |
| `<repo>/.shipper/bugs/done/` | Fixed bugs |
| `~/.config/shipper/config.json` | Per-project agent preference, last plan |
| `~/.config/shipper/logs/` | NDJSON session logs (last 20 retained) |
| `~/.cache/shipper/llama/` | Pinned llama.cpp `llama-server` binary (per platform) |
| `~/.cache/shipper/models/` | Embedding GGUF (`nomic-embed-text-v1.5` Q4_K_M) |
| `~/.cache/shipper/embed/` | Embedding server state, lock, idle timer, daemon log |
| `~/.cache/shipper/index/` | Per-repo semantic search index files |
| `~/.claude/skills/shipper-*/` | Global skills for Claude Code (auto-discovered) |
| `~/.cursor/skills/shipper-*/` | Global skills for Cursor CLI (auto-discovered) |
| `~/.config/opencode/skills/shipper-*/` | Global skills for opencode (auto-discovered) |

Bundled `shipper-plan`, `shipper-loop`, `shipper-build`, `shipper-spike`, `shipper-ship`, and `shipper-bug` skills are embedded in the binary and installed **globally** for each detected coding agent on startup (or via `shipper skills`). Repos no longer receive skill copies — stale per-repo copies from older versions are removed on boot.

## Debugging

Every agent session writes an NDJSON log to `~/.config/shipper/logs/<timestamp>-<agent>.ndjson` with typed `AgentEvent`s and raw adapter I/O. Error notices in the chat show the log path for the failed session.

Demo mode (no agent required):

```bash
shipper --demo
```

This opens the browser and runs a scripted chat + question flow so you can verify the UI without a live agent.

## Development

Requires [Bun](https://bun.sh).

```bash
bun install
bun run dev                    # web UI in current directory
bun run dev -- --dir /path/to/repo
bun run dev -- --demo          # scripted demo in the browser
bun run typecheck
bun test
bun run build                  # local platform → dist/shipper
bun run build:release          # all four release targets → dist/shipper-*
./dist/shipper --version
```

### Release

Push a `v*` tag to trigger `.github/workflows/release.yml`, which builds `shipper-darwin-arm64`, `shipper-darwin-x64`, `shipper-linux-x64`, and `shipper-linux-arm64` with SHA256 checksums attached to the GitHub Release.

```bash
git tag v0.2.2 && git push origin v0.2.2
```

## Modules

Modules are open source, opinionated feature specs — agent-built replacements for SaaS tools like Intercom or Mixpanel. Instead of subscribing to a third-party service, you install a module and let your coding agent build the feature directly into your codebase. You own the code, and the agent can maintain it over time.

Browse available modules at [shipper.is/modules](https://shipper.is/modules).

```bash
shipper modules list                    # show modules from the GitHub repo
shipper modules add customer-support    # install into .shipper/modules/<id>/
```

Then plan the build in your coding agent:

```
/shipper-plan https://shipper.is/modules/customer-support
```

The `shipper-plan` skill installs the module (or uses files already in `.shipper/modules/`), reads the spec, maps it to your stack, and writes a tailored plan to `.shipper/plans/open/`. Commit `.shipper/modules/` alongside your plans — it is the long-term reference for maintaining the feature.

## Semantic search (MCP)

Shipper can give your coding agent semantic search over every plan, spike, bug, and review in `.shipper/` — open and done. An MCP server embeds chunks with a small local model and ranks results by meaning, so questions like "have we planned something like this before?" or "is this a regression of an old bug?" take one tool call instead of grepping hundreds of files.

### One-step setup

```bash
shipper mcp install
```

This registers the MCP server with every detected agent (Claude Code, Cursor, opencode), prefetches the embedding assets, and prints a reminder to restart your agent. Use `--agent <claude|cursor|opencode>` to target one agent, or `--no-download` to skip the prefetch.

On first use, Shipper downloads a pinned llama.cpp build from GitHub (about 12–17 MB depending on platform) and an 84 MB GGUF embedding model from Hugging Face (`nomic-embed-text-v1.5` Q4_K_M). Both are SHA-256 verified into `~/.cache/shipper/`. Everything runs on `127.0.0.1` — no embeddings or document text leave your machine.

The shared embedding server shuts down after 15 idle minutes by default. Change that with `shipper embed start --idle-minutes <n>` (persisted in config), or manage it manually with `shipper embed start|stop|status`.

### MCP tools

| Tool | Purpose |
|------|---------|
| `shipper_search` | Semantic search across plans, spikes, bugs, and reviews |
| `shipper_similar` | Find documents similar to an existing Shipper file |
| `shipper_get_doc` | Read a Shipper markdown file (optional line range) |
| `shipper_list_docs` | List indexed Shipper documents |
| `shipper_reindex` | Rebuild or refresh the search index |

Bundled skills (`shipper-plan`, `shipper-spike`, `shipper-bug`, `shipper-build`) call `shipper_search` when the tool is available and fall back to grep/glob otherwise.

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
| `shipper` | Start the web workspace (default) |
| `shipper skills` | Install or refresh global skills for detected agents |
| `shipper modules list` | List available modules from the GitHub repo |
| `shipper modules add <id-or-url>` | Install a module into `.shipper/modules/<id>/` |
| `shipper embed start\|stop\|status` | Manage the shared local embedding server |
| `shipper index` | Build or refresh the semantic search index |
| `shipper search <query>` | Semantically search plans, spikes, bugs, and reviews |
| `shipper mcp` | Run the Shipper MCP server (stdio) |
| `shipper mcp install\|uninstall` | Register or unregister the MCP server with agents |

Use `shipper skills` without starting the console when you want the bundled skills in your own coding agent — e.g. type `/shipper-plan` in Cursor CLI or Claude Code to plan a feature directly in your editor.

```bash
shipper skills                  # install for all detected agents
shipper skills --agent cursor   # force install for one agent
```

### Flags

| Flag | Description |
|------|-------------|
| `--dir <path>` | Target repository (default: current directory) |
| `--port <n>` | HTTP port override (default: 80, fallback 8712) |
| `--no-open` | Do not open the browser automatically |
| `--demo` | Scripted chat/question demo in the browser |
| `--version` | Print version and exit |

## Keyboard shortcuts

Press `?` in the browser for the full shortcut list. Highlights: `n` new plan, `b` build, `/` focus chat, `Ctrl+\`` toggle terminal.
