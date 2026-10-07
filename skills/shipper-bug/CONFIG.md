This file tells you where Shipper artifacts live in this repository and which preferences the team and the user have set. Read it before doing anything else in a Shipper skill.

## Files to read

Read each of these files if it exists. Missing files are normal; skip them silently.

1. Global user defaults: `$XDG_CONFIG_HOME/shipper/config.json`, or `~/.config/shipper/config.json` when `XDG_CONFIG_HOME` is not set.
2. Repo config (committed, shared by the team): `.shipper/config.json` at the repository root.
3. Local override (uncommitted, this user only): `.shipper/config.local.json` at the repository root.

If a file is not valid JSON, or a known key has a value that key does not allow, tell the user which file is broken in one sentence and continue as if it did not exist. One bad field drops the whole file. Ignore keys you do not recognize; they stay in the file and do not make it invalid.

## Precedence

Later files win: global, then repo, then local. Merge field by field: a local `git.branchMode` replaces only that field, not the whole `git` object. Arrays such as `search.extraDirs` are replaced, not combined. An invalid `search.extraDirs` entry is dropped and the remaining entries still replace the lower layer. A layer that sets `search.extraDirs` replaces the lower array even when every entry is dropped.

Exceptions:

- `paths` is read only from the repo config. Ignore `paths` in the global and local files. The rest of those files still applies.
- `instructions` are combined, not replaced (see below).

What the user asks for in the current conversation always beats config.

## Keys and defaults

| Key | Default | Meaning |
|-----|---------|---------|
| `paths.plans` | `.shipper/plans` | Plans live in `<plans>/open/` and `<plans>/done/` |
| `paths.spikes` | `.shipper/spikes` | Spikes live in `<spikes>/open/` and `<spikes>/done/` |
| `paths.bugs` | `.shipper/bugs` | Bugs live in `<bugs>/open/` and `<bugs>/done/` |
| `paths.reviews` | `.shipper/reviews` | Reviews live directly in `<reviews>/` |
| `paths.modules` | `.shipper/modules` | Modules live in `<modules>/<id>/` |
| `git.branchMode` | not set | `"current"` or `"feature"`. When not set, each skill uses its own default |
| `git.commitEachPhase` | `true` | shipper-build and shipper-loop: commit after each phase |
| `git.branchPrefix` | `"shipper/"` | Prefix for feature branches Shipper creates. Letters, digits, `.`, `_`, `/`, and `-` only |
| `instructions.all` | none | Extra instructions for every Shipper skill |
| `instructions.<skill-name>` | none | Extra instructions for one skill. Names: `shipper-plan`, `shipper-build`, `shipper-loop`, `shipper-spike`, `shipper-ship`, `shipper-bug` |
| `models.<agent>.<skill-name>` | none | Model to use when starting a subagent for that skill. Agents: `claude`, `cursor`, `opencode`. Same skill names as instructions |
| `search.enabled` | `true` | Whether to use the `shipper_search` MCP tools |
| `search.extraDirs` | `[]` | Extra markdown directories included in search |

All `paths` are relative to the repository root and use forward slashes. Strip trailing slashes, drop `.` and empty segments, and resolve `..` that stays inside the repository (`docs/plans/` and `./a/../b` become `docs/plans` and `b`). Reject an empty result, a leading `/`, a backslash, a path that escapes the repository, and any `.git` or `node_modules` segment. An invalid value keeps the default for that artifact type and does not drop the rest of the file. If two artifact types normalize to the same directory, the earlier of plans, spikes, bugs, reviews, and modules keeps it; the later one stays on its default.

In the rest of these skill files, `<plans>`, `<spikes>`, `<bugs>`, `<reviews>`, and `<modules>` mean the resolved directories from this table. When you tell the user where a file is, use the real path, not the placeholder. Create a directory (and its `open/` and `done/` subfolders where listed) if it does not exist yet.

## Instructions

Collect instructions in this order: global `all`, global `<this skill>`, repo `all`, repo `<this skill>`, local `all`, local `<this skill>`. Skip empty strings. `<this skill>` is only `shipper-plan`, `shipper-build`, `shipper-loop`, `shipper-spike`, `shipper-ship`, or `shipper-bug`. shipper-review follows `instructions.all` only. Treat them as standing preferences for this repository. When two conflict, the later one wins. They never override this skill's hard rules (for example a read-only restriction or a required document structure), and they never override what the user asks for in the current conversation.

## Models

`models` are keyed by coding agent, then by skill name. Use `claude` if you are Claude Code, `cursor` if you are Cursor (editor or CLI), and `opencode` if you are opencode. You cannot change your own model. Only use this setting when you start a subagent to run a Shipper skill: if `models.<your agent>.<that skill>` is set and your subagent tool accepts a model, pass it. If the tool rejects the value, retry once without a model and mention it to the user. Skill names are the same six as `instructions`.

## Search

If `search.enabled` is `false`, do not call `shipper_search`, `shipper_similar`, or `shipper_reindex`. Use grep or glob over the artifact directories instead.
