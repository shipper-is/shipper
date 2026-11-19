---
severity: major
reported_at: "2026-11-18T22:32:00-05:00"
branch: shipper/bug-cli-doesnt-install-review-skill
base_branch: main
fixed_at: "2026-11-18T22:43:37-05:00"
pr_url: https://github.com/shipper-is/shipper/pull/32
pr_number: 32
---

# CLI does not install the review skill

## Symptom
- `shipper` and `shipper skills` install the bundled agent skills, but `shipper-review` is never written into the agent's global skills directory.
- The review skill should be installed with the other bundled skills, including the scripts the skill runs.
- Observed in the CLI install path (`shipper` startup, `shipper skills`, and the setup console refresh action).

## Reproduction
1. From the repo root, install into a throwaway home so the real agent directories are untouched:

```bash
home=$(mktemp -d)
HOME="$home" bun -e '
import { installSkillsGlobally, SKILLS } from "./src/core/skills.ts";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
const summaries = await installSkillsGlobally(["cursor"]);
const root = join(process.env.HOME, ".cursor", "skills");
const installed = (await readdir(root)).sort();
console.log("bundled:", Object.keys(SKILLS).sort().join(", "));
console.log("summary:", JSON.stringify(summaries));
console.log("installed:", installed.join(", "));
console.log("has shipper-review:", installed.includes("shipper-review"));
'
rm -rf "$home"
```

2. Observed output before the fix:

```
bundled: shipper-bug, shipper-build, shipper-loop, shipper-plan, shipper-ship, shipper-spike
summary: [{"agent":"cursor","root":"/var/folders/c8/pkjc4rjj1jq39dpwtpxj4rvh0000gn/T/tmp.778idcwg7F/.cursor/skills"}]
installed: shipper-bug, shipper-build, shipper-loop, shipper-plan, shipper-ship, shipper-spike
has shipper-review: false
```

`skills/shipper-review/` is present in the repo (`SKILL.md`, `CONFIG.md`, `LANES.md`, and `scripts/`). None of it was written.

## Root Cause
`installSkillsGlobally`, `removeRepoSkills`, and `getSkillStatus` all walk `SKILL_NAMES` in `src/shared/config-schema.ts`. That tuple is the six skills whose config shape is a launch model plus optional role (`shipper-plan`, `shipper-build`, `shipper-loop`, `shipper-spike`, `shipper-ship`, `shipper-bug`). `src/core/skills.ts` embeds only those six, and `SKILLS` is typed `Record<SkillName, ...>`, so the install loop cannot name `shipper-review`.

`shipper-review` is kept out of `SKILL_NAMES` on purpose: its model config is `{ triage, light, heavy }`, and `instructions.<skill>` does not include it (it follows `instructions.all` only). The installer was wired to that config tuple, so the review skill was never embedded. `skills/shipper-review/scripts/config.ts` already says the skill is installed without `node_modules` and limits itself to Node builtins, which only works if those scripts are copied next to `SKILL.md`. They are not.

Evidence: the reproduction above prints the six bundled names and `has shipper-review: false` after `installSkillsGlobally(["cursor"])`. The same function is what `shipper` startup, `shipper skills`, and the setup console refresh action call.

## Fix
`INSTALLED_SKILL_NAMES` is the install set: the six `SKILL_NAMES` plus `shipper-review`. Install, repo cleanup, and the setup-console status walk that list. `SKILL_NAMES` is unchanged, so instructions and launch-model rows still omit review.

`src/core/skills.ts` embeds `SKILL.md`, `LANES.md`, `CONFIG.md`, and the four scripts under `scripts/`. The scripts stay TypeScript source (`with { type: "text" }`) so the installed copy can be run with Bun. Vitest compiles those `.ts` imports as modules, so `vitest.config.ts` serves the raw source only when `src/core/skills.ts` imports them.

## Regression Guard
The new test was run before the installer change:

```
FAIL  src/core/core.test.ts > installSkillsGlobally > installs shipper-review, including its scripts
Error: ENOENT: no such file or directory, open '/var/folders/c8/pkjc4rjj1jq39dpwtpxj4rvh0000gn/T/shipper-home-i16odM/.cursor/skills/shipper-review/SKILL.md'

FAIL  src/core/core.test.ts > removeRepoSkills > deletes shipper-owned skill dirs but leaves unrelated skills untouched
AssertionError: promise resolved "'old'" instead of rejecting
```

After the fix, the same file passes, and the original reproduction writes the skill:

```
installed: shipper-bug, shipper-build, shipper-loop, shipper-plan, shipper-review, shipper-ship, shipper-spike
has shipper-review: true
review files: SKILL.md, LANES.md, CONFIG.md, scripts/risk-floor.ts, scripts/policy.ts, scripts/config.ts, scripts/review-config.ts
review files match bundled source
```

Importing the installed scripts with Bun resolves their relative imports:

```
quality,uptime,intent,performance,security
warnings 0
```

`bun run test` — 37 files, 250 tests, all passed. `bun run typecheck` passed. `getSkillStatus` now lists `shipper-review` and marks it outdated when `scripts/policy.ts` differs from the bundle. `SKILL_NAMES` is still the six config skills, so the instructions and launch-model forms are unchanged. `removeRepoSkills` also deletes a repo-local `.claude/skills/shipper-review`, `.cursor/skills/shipper-review`, or `.opencode/skill/shipper-review` so it cannot shadow the global copy.
