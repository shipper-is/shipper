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

- `paths` and `review` are read only from the repo config. Ignore them in the global and local files. The rest of those files still applies.
- `instructions` are combined, not replaced (see below).

What the user asks for in the current conversation always beats config.

## Keys and defaults

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
| `models.<agent>.<skill-name>` | none | Launch model when starting that skill as a subagent: a string, or `{ "model" }` when that skill also has a role. Agents: `claude`, `cursor`, `opencode`. Same skill names as instructions (see Models) |
| `models.<agent>.shipper-plan.research` | none | Research subagents while planning |
| `models.<agent>.shipper-spike.research` | none | Research subagents while planning a spike |
| `models.<agent>.shipper-bug.investigate` | none | Investigation subagents while diagnosing a bug |
| `models.<agent>.shipper-loop.phase` | falls back to `models.<agent>.shipper-build` | Model for each phase subagent |
| `models.<agent>.shipper-review.triage` | none | One model id for the triage subagent |
| `models.<agent>.shipper-review.light` | none | Ordered list of model ids for light-tier reviewers |
| `models.<agent>.shipper-review.heavy` | none | Ordered list of model ids for heavy-tier reviewers |
| `search.enabled` | `true` | Whether to use the `shipper_search` MCP tools |
| `search.extraDirs` | `[]` | Extra markdown directories included in search |
| `review` | none | shipper-review only: extra risk-floor rules, ignored paths, sample rate, size budget, and accepted evidence kinds. shipper-review's scripts read and validate it; other skills ignore it |

All `paths` are relative to the repository root and use forward slashes. Strip trailing slashes, drop `.` and empty segments, and resolve `..` that stays inside the repository (`docs/plans/` and `./a/../b` become `docs/plans` and `b`). Reject an empty result, a leading `/`, a backslash, a path that escapes the repository, and any `.git` or `node_modules` segment. An invalid value keeps the default for that artifact type and does not drop the rest of the file. If two artifact types normalize to the same directory, the earlier of plans, spikes, bugs, and reviews keeps it; the later one stays on its default.

In the rest of these skill files, `<plans>`, `<spikes>`, `<bugs>`, and `<reviews>` mean the resolved directories from this table. When you tell the user where a file is, use the real path, not the placeholder. Create a directory (and its `open/` and `done/` subfolders where listed) if it does not exist yet.

## Instructions

Collect instructions in this order: global `all`, global `<this skill>`, repo `all`, repo `<this skill>`, local `all`, local `<this skill>`. Skip empty strings. `<this skill>` is only `shipper-plan`, `shipper-build`, `shipper-loop`, `shipper-spike`, `shipper-ship`, or `shipper-bug`. shipper-review follows `instructions.all` only. Treat them as standing preferences for this repository. When two conflict, the later one wins. They never override this skill's hard rules (for example a read-only restriction or a required document structure), and they never override what the user asks for in the current conversation.

## Models

`models` are keyed by coding agent, then by skill name. Use `claude` if you are Claude Code, `cursor` if you are Cursor (editor or CLI), and `opencode` if you are opencode. You cannot change your own model. Pass `model` when starting another Shipper skill: that is `models.<your agent>.<that skill>` when the value is a string, or `models.<your agent>.<that skill>.model` when the skill is an object. Pass the role or tier key when starting that skill's own helpers (`research`, `investigate`, `phase`, `triage`, `light`, or `heavy`). A list is walked in order, round-robin, so the user can alternate families. If the subagent tool rejects an id, retry that subagent once without a model and say so. `shipper models list --agent <claude|cursor|opencode> --json` prints `{ "agents": { "<kind>": [{ "id", "label" }] } }`. When a review tier is unset, run that command and choose from it: the fastest available model for triage, fast models from two vendors for light, and frontier models from two vendors for heavy. When the command fails, keep today's behavior (choose from what the subagent tool accepts) and record it in the review coverage notes. `shipper-build` and `shipper-ship` have no child slot.

## Search

If `search.enabled` is `false`, do not call `shipper_search`, `shipper_similar`, or `shipper_reindex`. Use grep or glob over the artifact directories instead.
