This file is the authoritative pre-push CI workflow for shipper-ship. Run it on the feature branch after locating the branch (GIT.md) and before pushing. The goal is to fail fast locally: catch what the build machines would reject and fix it now, instead of waiting a CI cycle to find out.

## Detect the checks

Find the checks that will run on the build machines when this PR is opened. Look for:

- GitHub Actions: `.github/workflows/*.yml` and `*.yaml`
- GitLab: `.gitlab-ci.yml`
- CircleCI: `.circleci/config.yml`
- Others: `azure-pipelines.yml`, `bitbucket-pipelines.yml`, `.buildkite/`, `Jenkinsfile`
- Hooks that also gate merges: `.husky/`, `.pre-commit-config.yaml`, `lefthook.yml`

Keep only the jobs that trigger on a pull request (or a push to the PR branch) against the base branch. Honor path and branch filters: if a workflow only runs on `web/**` and the diff does not touch `web/`, skip it.

For each job you keep, collect the commands from its `run` steps (or the equivalent `script` blocks). Run those exact commands with the same flags (for example `--frozen-lockfile`, `--max-warnings 0`, `--noEmit`) rather than a looser version of your own. When a step calls a package script or a make target, run that script or target. Skip setup-only steps such as checkout, toolchain setup, and caching. If the CI matrix has several entries, run one combination that matches the local toolchain.

Never run steps with side effects outside the machine: deploys, releases, publishing, pushing, uploading coverage or artifacts, or anything that needs CI-only secrets. Skip them and record why.

If the repository has no CI configuration, fall back to the checks a reviewer would expect: the test, lint, typecheck, and format-check scripts in `package.json`, a `Makefile`, or the language's standard equivalents. Say in the PR that no CI configuration was found and which commands you ran instead.

## Run the checks

Run cheapest first so failures surface fast: format check, lint, typecheck, build, unit tests, then slower integration or end-to-end suites. Stop at the first failing check and fix it before moving on.

If a check needs services you cannot start locally (a database, Docker, a browser, a paid API), skip it and record why. If a single check would take far longer than the rest combined (for example a full end-to-end suite), ask the user via the question tool whether to run it, run only the tests covering the changed code, or skip it.

## Fix failures

When a failure is caused by this branch's changes, fix the root cause, rerun that check, and continue. If a check reports formatting problems, run the repo's own formatter in write mode rather than editing by hand.

Never make a check pass by weakening it: no skipping or deleting tests, no lowering lint rules or thresholds, no `@ts-ignore` or equivalent suppressions added to get green, and no `--no-verify`.

If a failure is not caused by this branch (it touches code the diff does not, or the same check is already failing on the base branch, which `gh run list --branch <base>` can confirm), do not fix it here. Record it for the Risks section of the PR.

If the fix is non-trivial, changes behavior beyond the plan's scope, or you cannot find the cause after a reasonable attempt, stop and ask the user via the question tool: fix it now, open the PR with the failure documented, or abort.

When the fixes are done, rerun every check you ran once more if the fixes touched code shared with earlier checks.

## Commit fixes

Commit CI fixes on the feature branch as their own commit, following the repository's commit message conventions, before pushing. If the user chose to leave the build uncommitted (current-branch mode with committing disabled), GIT.md has already asked how to handle uncommitted work; include the fixes under that same choice.

## Report

Feed the results into the PR description:

- Test & Hardening Evidence: list each check you ran with its exact command and result, plus a short excerpt of real output for the test run. Mention any failures you found and fixed locally in one line each.
- Risks, Gaps & Least-Confident Areas: list every CI check you skipped and why, and any pre-existing failures you left alone.
