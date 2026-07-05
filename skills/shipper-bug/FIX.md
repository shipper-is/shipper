The FIX step takes a cataloged bug file from ".shipper/bugs/open" and drives it to a proven fix. Create a todo list with the stages below and check them off as you go. The hard rule throughout: no code edits until the Root Cause section of the bug file is written down with its evidence.

## Stage 1: Reproduce

Reproduce the bug before touching any code. Run the app, run the command, hit the endpoint — whatever it takes to see the failure with your own eyes. Write the exact recipe (commands, URLs, clicks, inputs) into the Reproduction section of the bug file; this recipe is reused verbatim later as the fix verification and as the "How to Verify" section of the PR.

If reproduction is genuinely infeasible (production-only data, timing-dependent race, hardware-specific), you may substitute a proven mechanism: trace the failure path through the code and evidence (logs, stack traces, database state) until you can demonstrate exactly how the observed symptom is produced. Note in the Reproduction section that the bug was mechanism-proven rather than reproduced, and why.

## Stage 2: Diagnose

Trace from symptom to root cause. Use parallel subagents when useful to investigate different layers or hypotheses at once. The bar for "diagnosed" is strict: you can point at the specific code and explain the mechanism such that the bug is inevitable — not "this looks suspicious" or "this is probably it."

- Distinguish the root cause from the trigger. The input that surfaces the bug is rarely the code that is wrong.
- If confidence is low, do not guess. Add temporary instrumentation, re-reproduce, and observe. Remove the instrumentation before the fix commit.
- Write the Root Cause section of the bug file before making any fix: name the file(s) and logic at fault, explain the mechanism, and cite the evidence that proves it (the failing run, the log line, the traced code path).

## Stage 3: Classify

Now that the root cause is known, size the fix. If it fits a single phase of work, continue. If the root cause reveals a design flaw that requires multi-phase work, stop here: commit the bug file with its completed diagnosis, and prompt the user to run the shipper-plan skill using the Root Cause section as the plan's starting context. The bug file stays in "open" and the eventual plan should reference it.

## Stage 4: Fix

If a git repo is initialized, read and follow [./GIT.md](./GIT.md) for branching, the worktree question, and bug file location. Also ask whether the user wants a PR created automatically when finished (if not already decided).

Rules for the fix itself:

- Fix the cause, not the symptom. If the honest fix at the root is not possible right now and only a symptom-level mitigation is (e.g. guarding against a bad value produced upstream), implement it but label it explicitly as a mitigation in the Fix section — and the bug file stays in "open" with a note about the real fix still owed.
- Make the smallest change that removes the cause. No drive-by refactors, no opportunistic cleanup, no fixing adjacent code smells.
- One bug per file, branch, and fix. Other bugs discovered during diagnosis get their own bug files via the CATALOG step — never fold them into this fix.

Write the Fix section of the bug file: what changed, and why that layer is the right place for it.

## Stage 5: Prove

The default requirement is a regression test that fails before the fix and passes after. Run the test against the pre-fix code (stash the fix or check out the prior commit) and capture the failure, then run it with the fix applied and capture the pass. Paste both results into the Regression Guard section — the failing-then-passing pair is the evidence that cannot be faked.

If an automated test is genuinely infeasible for this bug, a documented manual verification is the allowed exception: re-run the exact Reproduction recipe with the fix applied and paste the real output or a screenshot into the Regression Guard section, plus one line explaining why a test was not feasible.

Either way, also re-run the original reproduction to confirm the symptom is gone, and check the blast radius: identify what else shares the code you touched and confirm those paths still behave.

Commit the fix and its test together in one commit, with the bug file updates included. Follow [./GIT.md](./GIT.md) for the single-commit rule and branch setup.

## Stage 6: Close

Set `fixed_at` in the bug file's frontmatter to the current time as a quoted ISO 8601 timestamp and move the file from ".shipper/bugs/open" to ".shipper/bugs/done". If the user opted for an automatic PR, use the shipper-ship skill (if installed and available) for the PR format — the bug file supplies the verification recipe and test evidence; shipper-ship writes `pr_url` and `pr_number` per its GIT.md. Then follow [./GIT.md](./GIT.md) for worktree cleanup as the last action. Finish by giving the user a brief summary: the root cause in plain language, what the fix was, and the proof it works.
