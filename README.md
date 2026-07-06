# Shipper

Shipper is a standalone CLI that orchestrates AI coding agents to **plan** and **build** features in any repository. It ships as a compiled binary with a local web workspace — no Node.js required at runtime.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/shipper-is/shipper/main/install.sh | sh
```

Pin a version:

```bash
SHIPPER_VERSION=0.2.0 sh -c 'curl -fsSL https://raw.githubusercontent.com/shipper-is/shipper/main/install.sh | sh'
```

macOS binaries are **unsigned** in v1. Installing via `curl | sh` avoids Gatekeeper quarantine; downloading the binary directly in a browser may require removing the quarantine attribute or allowing it in System Settings.

Shipper checks for updates once per day and shows the install command in the UI when a newer release is available. There is no self-update in v1 — re-run the install script to upgrade.

## What it does

1. **Plan** — runs the `shipper-plan` skill through your coding agent to produce a structured markdown plan in `.shipper/open/`.
2. **Build** — loops the `shipper-build` skill phase-by-phase until the plan is complete, moving finished plans to `.shipper/done/`.

Running `shipper` starts a local web server and opens your browser at **`http://shipper.localhost`** (port 80, with fallback to `:8712` if 80 is unavailable). Browsers resolve `*.localhost` to your machine with no hosts-file setup. Shipper deliberately uses `.localhost`, not `.local` — the latter is reserved for Bonjour/mDNS and behaves unreliably.

The workspace has three sections:

- **Left nav** — open and done plans, live-updating from `.shipper/`
- **Main window** — plan overview, agent chat, inline questions, follow-up messages, build controls
- **Right rail** — a passthrough terminal (real PTY) for interactive commands like `vim` or `git add -p`

### New plan flow

1. Click **New plan** (or press `n`), describe the feature.
2. Confirm the agent and model if prompted; Shipper refreshes bundled skills in your global agent directories and starts a headless agent session.
3. Answer clarifying questions inline when prompted.
4. A new plan file appears in `.shipper/open/`.

### Build flow

1. Select an open plan and click **Build** (or press `b`).
2. Shipper runs one agent session per phase, auto-continuing until the plan is done.
3. Progress updates live as the agent checks boxes in the plan file.
4. Questions pause the loop; everything else continues automatically.

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
| `<repo>/.shipper/open/` | Active plans (commit these) |
| `<repo>/.shipper/done/` | Completed plans |
| `~/.config/shipper/config.json` | Per-project agent preference, last plan |
| `~/.config/shipper/logs/` | NDJSON session logs (last 20 retained) |
| `~/.claude/skills/shipper-*/` | Global skills for Claude Code (auto-discovered) |
| `~/.cursor/skills/shipper-*/` | Global skills for Cursor CLI (auto-discovered) |
| `~/.config/opencode/skills/shipper-*/` | Global skills for opencode (auto-discovered) |

Bundled `shipper-plan`, `shipper-build`, `shipper-spike`, `shipper-ship`, and `shipper-bug` skills are embedded in the binary and installed **globally** for each detected coding agent on startup (or via `shipper skills`). Repos no longer receive skill copies — stale per-repo copies from older versions are removed on boot.

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
git tag v0.2.0 && git push origin v0.2.0
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

The `shipper-plan` skill installs the module (or uses files already in `.shipper/modules/`), reads the spec, maps it to your stack, and writes a tailored plan to `.shipper/open/`. Commit `.shipper/modules/` alongside your plans — it is the long-term reference for maintaining the feature.

## CLI

### Commands

| Command | Description |
|---------|-------------|
| `shipper` | Start the web workspace (default) |
| `shipper skills` | Install or refresh global skills for detected agents |
| `shipper modules list` | List available modules from the GitHub repo |
| `shipper modules add <id-or-url>` | Install a module into `.shipper/modules/<id>/` |

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
