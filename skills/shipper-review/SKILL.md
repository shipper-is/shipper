---
name: shipper-review
description: Orchestrate a multi-lane, adversarial code review of a PR or branch by spinning up parallel read-only review subagents (bugs, security, edge cases, performance, conventions, test coverage, PR-claims, production-data impact) plus cost-aware scenario tests via the shipper-test skill, then aggregate everything into one severity-ordered findings report headed by merge-risk and production-risk verdicts, persisted as a review artifact in `<reviews>/`. Use before requesting human review on a PR, or whenever the user asks for a thorough review of changes.
---

The goal of this skill is to compress a senior engineer's review of a change down to reading one findings table, checking the merge-risk and production-risk verdicts, and (when relevant) watching a scenario-test replay. You are the orchestrator: you do not review code yourself. You triage the change, spin up a fresh subagent per review lane, run scenario tests where they replace manual verification, and aggregate the results into a single report.

Before anything else, read and follow [./CONFIG.md](./CONFIG.md). It tells you where plans, spikes, bugs, reviews, and modules live in this repository (written below as `<plans>`, `<spikes>`, `<bugs>`, `<reviews>`, and `<modules>`) and which team and personal preferences apply.

This skill is repo-agnostic. Nothing in it assumes a particular stack; repo-specific rules enter only through the host repo's own documents (see the conventions lane).

Reviews are findings-only. No lane ever edits code, and neither do you. Fixes are a separate, explicit request from the user after they read the report. The single write this skill makes is the review artifact in `<reviews>/` (see Step 6).

## Step 1: Identify the target

The user points you at a PR, a branch, or local changes. Defaults: if a PR exists for the current branch, review the PR; otherwise review branch changes against the merge-base with the default branch (committed + staged + unstaged); `uncommitted changes` only when the user says so. Make sure the target is checked out locally before launching lanes.

## Step 2: Triage

Read enough to route the review, not to perform it: the diff stat, the changed files list, the PR description (or the Shipper plan under `<plans>`), and the repo's `.shipper/tests/TESTING.md` if present. From this, decide:

- **Which lanes run.** Every lane below runs by default; skip a lane only when it is plainly inapplicable (no schema/data changes → skip production-data; no PR description → skip claims verification). Record what you skipped and why — it goes in the report.
- **Which scenario tests run.** If the change touches a flow already covered by a scenario in `.shipper/tests/`, plan to re-run it. If the PR's verification steps are manual and the flow is high-consequence (auth, payments, data loss, realtime, native app behavior), plan to create or extend a scenario via the shipper-test skill. Note the expected runner cost in the report (e.g. "one ubuntu runner, ~10 min").
- **Model tiers.** Lanes run on two tiers: **normal** (stronger reasoning) and **cheap** (faster/cheaper). Defaults: bugs, security, edge cases, and production-data on normal; conventions, test coverage, and claims verification on cheap; performance on cheap unless the change is data/query-heavy. Resolve tier to a concrete model from what your harness offers (pick a frontier model for normal and a fast/mini model for cheap) unless the user names models or overrides a lane's tier.

**Cursor only:** when running inside Cursor, the bugs and security lanes are delegated to Cursor's dedicated review subagents instead of general-purpose ones — launch exactly one `bugbot` subagent (description "Bugbot") for the bugs lane and one `security-review` subagent (description "Security Review") for the security lane, each with this prompt shape:

```text
Full Repository Path: <absolute repository path>
Diff: <"branch changes" or "uncommitted changes">
Custom Instructions: <only when the user gave specific review instructions>
```

Do not compute the diff for them (they do it themselves from the repository path), and do not pass `Base Branch` unless the branch should be compared against something other than the repo's default base. On any other harness (Claude Code, CLI agents, etc.), run bugs and security as general-purpose subagents with the lane charters below — the discipline is in the prompt, not the tool. All other lanes are general-purpose subagents everywhere.

## Step 3: Run the review lanes in parallel

Lanes are read-only, so launch them concurrently. Each lane is a fresh subagent with a self-contained prompt (it cannot see this conversation) containing: the absolute repository path, the diff target ("branch changes against merge-base with <base>, including committed, staged, and unstaged" or "uncommitted changes"), its lane charter, and this output contract:

> Report findings only — do not edit any file. For each finding: severity (Critical / High / Medium / Low), location as `file:line`, a one-sentence description of the defect and its consequence, and your confidence. Verify each finding against the actual code before reporting it; a false positive costs more than a miss. If you find nothing, say so explicitly. Never include secrets or raw personal data in findings.

Lane charters:

- **Bugs** (normal): behavioral defects introduced by this diff — logic errors, broken contracts between caller and callee, regressions in flows that share the touched code, incorrect async/await or error handling, off-by-one and state-machine mistakes. Trace each suspect path through the real code; report only defects you can explain mechanically.
- **Security** (normal): injection, authz/authn gaps, secrets in code or logs, unsafe deserialization or eval, SSRF/path traversal, overly broad permissions, new dependencies with supply-chain risk, data exposure across trust boundaries (client vs server, user vs admin).
- **Edge cases** (normal): empty/null/huge inputs, unicode and encoding, timezone and DST boundaries, concurrency and double-submit, offline and mid-operation failure, pagination boundaries, first-run vs long-lived state, permission-denied paths. Focus on inputs and states the happy path never sees.
- **Performance** (cheap; normal for data-heavy changes): N+1 queries, missing indexes implied by new query shapes, unbounded loops or list growth, payloads that scale with data size, sync work on hot paths, cache invalidation mistakes.
- **Conventions & architecture** (cheap): first discover the host repo's own rules — root agent docs (AGENTS.md, CLAUDE.md, CONTRIBUTING), architecture docs, lint configs, anything the repo declares as review standards — then check the diff against *those*, citing the rule violated. Do not import outside style opinions; if the repo declares no rule, it is not a finding.
- **Test coverage** (cheap): new logic paths without tests, tests that exercise code but assert nothing meaningful, mocks that mock away the behavior under test, and tests deleted or weakened by the diff.
- **PR-claims verification** (cheap; only when a PR description or plan completion notes exist): treat every claim as unverified — "reused X", "follows pattern Y", "tested by Z" — and spot-check each against the diff and repo. Report claims that are false, unverifiable, or overstated. This lane reviews the description, not the code.
- **Production-data impact** (normal; only when the diff touches schema, queries, or data handling AND read-only production access is detectable — a readonly database MCP connection, a replica URL, or similar): run read-only queries to check the change against reality — row counts a migration would lock, real data shapes that violate new constraints or parsers (nulls, duplicates, lengths, encodings), and whether new query patterns are sane at production scale. Hard rules: SELECT/read-only operations only, never a write or DDL statement, and report aggregates or counts — never raw personal data.

Monitor the lanes; if one fails or returns something malformed, retry it once with the same prompt, then report it as "lane did not complete" rather than blocking the review.

## Step 4: Scenario tests (sequential, via shipper-test)

While lanes run, execute the scenario-test decision from triage — this lane writes files and publishes workflows, so it must not race other writers on the branch:

1. **Re-run existing** scenarios that cover the changed flow: publish the parked workflow per shipper-test's lifecycle, run it on the PR branch so evidence matches the code under review, capture the run URL and recording.
2. **Extend or create** a scenario (with the shipper-test skill, in a subagent) when triage found manual verification steps worth replacing. Follow shipper-test end to end: contract sentence, copy the nearest passing scenario, publish → iterate → capture evidence → retire the workflow copy.
3. Either way, record: gate result, run URL, recording/screenshot artifacts, and approximate runner minutes consumed.

A scenario failure is a finding (usually High or Critical) — report it with the journal excerpt and recording; do not fix the product code.

## Step 5: Aggregate and report

Merge all lane outputs into one report. The report always opens with this static header — exact labels, exact order — so anyone (including non-engineers) can read the first three lines and know where the change stands:

```text
Merge risk: <HIGH | MEDIUM | LOW>
Production risk: <HIGH | MEDIUM | LOW>
Overview: <2-4 plain-language sentences on what the review found, written so both technical and non-technical team members understand it — what the change does, what if anything is worrying, and what should happen next. No jargon, no file paths.>
```

The two risks answer different questions:

- **Merge risk**: how much risk the *codebase* takes on if this merges as is — blast radius (what shares the touched code), reversibility (schema/auth/billing changes are hard to undo), and the worst unresolved finding. LOW means we see little risk in merging.
- **Production risk**: how confident we are that this PR won't take down or break anything in *production* — runtime failure modes, migration locks, load behavior, breakage of live user flows. LOW means we don't think anything will break.

After the header, the rest of the report follows:

- **Dedupe** findings that share a root cause across lanes into one row noting both lanes.
- **One table**, sorted by severity: `Severity | Location (file:line) | Finding | Lane`.
- **Scenario evidence**: gate status, run link, recording link or embedded screenshots.
- **Risk justifications**: one sentence per risk verdict explaining what drove it.
- **Coverage notes**: lanes skipped and why, lanes that did not complete, claims that could not be verified.

Deliver the report in chat, and when the target is a PR, post it as a single PR comment (`gh pr comment`) beginning with the same static header. On re-review, edit that same comment rather than stacking new ones.

## Step 6: Persist the review artifact

Every review leaves a discrete artifact behind: one markdown file in `<reviews>/` at the root of the repository (create the folder if it does not exist; it is committed to the repository).

**Filename**: name the file after the review target, kebab-case — `pr-<number>-<short-title>.md` when reviewing a PR, `<branch-name-kebab>.md` otherwise. One file per target: a re-review updates the existing file rather than creating a new one.

**Frontmatter**: start the file with a YAML frontmatter block:

```yaml
---
type: review
repo: owner/name
pr_url: https://github.com/owner/name/pull/123
pr_number: 123
branch: shipper/add-auth
base_branch: main
commit: abc1234
source: <plans>/done/add-auth.md
merge_risk: medium
production_risk: low
reviewed_at: "2026-07-29T23:20:00-04:00"
---
```

- `repo`: `owner/name` derived from the origin remote; fall back to the repository directory name if there is no remote.
- `pr_url`, `pr_number`: only when the target is a PR.
- `branch`, `base_branch`: the reviewed branch and what it was diffed against.
- `commit`: the short sha of the HEAD you reviewed — this is what makes a re-review meaningful.
- `source`: the repo-relative path to the Shipper plan, spike, or bug file this change came from, when one exists. Find it by scanning frontmatter in `<plans>/`, `<spikes>/`, and `<bugs>/` (both `open/` and `done/`) for a file whose `branch`, `pr_number`, or `pr_url` matches the review target. Omit the key if nothing matches — never guess.
- `merge_risk`, `production_risk`: the two risk verdicts from the report header (low / medium / high).
- `reviewed_at`: quoted ISO 8601 timestamp of when the review completed.

**Body**: the full Step 5 report, starting with the static header — findings table, scenario evidence, risk justifications, coverage notes, and any rule-encoding proposals. The artifact is the durable copy of the report; chat and the PR comment are views of it.

Commit the artifact (message like `Add shipper review for PR #123`). If the working tree has uncommitted changes that are not yours, commit only the review file. This is the one write this skill is permitted.

## Re-review mode

When the user says findings were addressed, do not rerun the full sweep. Diff the fix commits, rerun only the lanes whose findings they touch (plus bugs, which always reruns — fixes introduce bugs), re-run a scenario only if the fix touched its flow, and update the report and PR comment with each finding marked resolved / disputed / still open.

Update the review artifact in place: refresh `commit`, `merge_risk`, `production_risk`, and `reviewed_at` in the frontmatter, refresh the report header (risks and overview), mark each finding's resolution status in the body, and commit the update. Do not create a second file for the same target.

## Encode repeated findings

If the same class of finding appears across multiple reviews of a repo, the review is compensating for a missing rule. Propose encoding it where the repo keeps its rules — a lint rule, an agent-docs entry, an architecture note — so future diffs never contain it. List these proposals at the end of the report; creating them is the user's call.

## How this fits the Shipper framework

- **shipper-ship** should run this skill after opening the PR and before requesting human review; the report becomes part of the PR's evidence, and the artifact in `<reviews>/` links back to the plan, spike, or bug file that produced the change.
- **shipper-test** is this skill's mechanism for executable verification; this skill decides *when* a scenario is worth its cost, shipper-test defines *how* it is built and run.
- **shipper-loop / shipper-build** may treat a clean shipper-review report as a completion gate for a plan's final phase.
