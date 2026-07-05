# Shipper

Shipper is a standalone CLI that orchestrates AI coding agents to **plan** and **build** features in any repository. It ships as a compiled binary with a full-screen terminal UI (TUI) — no Node.js required at runtime.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/shipper-is/shipper/main/install.sh | sh
```

Pin a version:

```bash
SHIPPER_VERSION=0.1.0 sh -c 'curl -fsSL https://raw.githubusercontent.com/shipper-is/shipper/main/install.sh | sh'
```

macOS binaries are **unsigned** in v1. Installing via `curl | sh` avoids Gatekeeper quarantine; downloading the binary directly in a browser may require removing the quarantine attribute or allowing it in System Settings.

Shipper checks for updates once per day and shows the install command in the status bar when a newer release is available. There is no self-update in v1 — re-run the install script to upgrade.

## What it does

1. **Plan** — runs the `shipper-plan` skill through your coding agent to produce a structured markdown plan in `.shipper/open/`.
2. **Build** — loops the `shipper-build` skill phase-by-phase until the plan is complete, moving finished plans to `.shipper/done/`.

```text
$ cd my-project
$ shipper

  Shipper · my-project · cursor
  ─────────────────────────────────
  Open plans
    ● Add user auth          Phase 2/4 · 13/41 tasks
  ─────────────────────────────────
  ↑↓ select · n new plan · b build · q quit
```

### New plan flow

1. Press `n`, describe the feature (multi-line; `Ctrl+D` to submit).
2. Confirm the agent; Shipper installs bundled skills into your repo and starts a headless agent session.
3. Answer clarifying questions in the TUI modal when prompted.
4. A new plan file appears in `.shipper/open/`.

### Build flow

1. Select an open plan and press `Enter` or `b`.
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

Bundled `shipper-plan` and `shipper-build` skills are embedded in the binary and installed into agent-specific directories at run time (`.cursor/skills/`, `.claude/skills/`, `.opencode/skill/`).

## Debugging

Every agent session writes an NDJSON log to `~/.config/shipper/logs/<timestamp>-<agent>.ndjson` with typed `AgentEvent`s and raw adapter I/O. Error panels in the TUI show the log path for the failed session.

Demo mode (no agent required):

```bash
shipper --demo
```

## Development

Requires [Bun](https://bun.sh).

```bash
bun install
bun run dev                    # TUI in current directory
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
git tag v0.1.0 && git push origin v0.1.0
```

## CLI flags

| Flag | Description |
|------|-------------|
| `--dir <path>` | Target repository (default: current directory) |
| `--demo` | Scripted feed/modal demo |
| `--version` | Print version and exit |
