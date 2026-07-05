---
name: shipper-bug
description: Catalog and fix bugs using an evidence-first Shipper workflow
---

The goal of this skill is to take a bug report from the user, catalog it as a structured bug file, and drive it to a high-confidence fix. Like the shipper-spike skill, one engineer owns the whole lifecycle: cataloging, diagnosis, fix, and proof all happen in a single flow.

The core opinion of this skill is that bugs fail differently than features. Features fail from missing context; bugs fail from wrong diagnosis. The classic failure is patching a symptom (adding a null check, a try/catch, a retry) instead of removing the cause, then declaring the bug fixed without ever having seen it happen. Every rule in this skill exists to prevent that. The ordering is non-negotiable:

1. Evidence before diagnosis — reproduce the bug (or prove the failure mechanism) before naming a cause
2. Diagnosis before fix — no edits until the root cause is written down with its evidence
3. Proof before close — a regression guard that demonstrably fails before the fix and passes after

Bugs are cataloged as one markdown file per bug in a ".shipper/bugs" folder at the root of the repository (committed to the repository), containing "open" and "done" folders that mirror the plan folders. The bug file is the audit trail: it starts as a normalized report and accumulates the reproduction recipe, the diagnosis, the fix rationale, and the proof as the bug moves through the pipeline.

This skill has two entry points:

- The user reports a new bug (even a one-line description). Start with CATALOG.md to normalize it into a bug file, then continue into FIX.md unless the user only wants it cataloged for later.
- The user points you at an existing bug file in ".shipper/bugs/open". Read it, catch up on whatever sections are already filled in, and continue from the appropriate step of FIX.md.

Scope rule: this skill only carries a bug through to a fix when the fix fits a single phase of work. If diagnosis reveals a design flaw that requires multi-phase work, stop after the Root Cause section is written and prompt the user to run the shipper-plan skill, using the completed diagnosis as the plan's starting context. The diagnosis is never wasted work.

Use the related ./CATALOG.md and ./FIX.md reference files for the detailed process you should follow in each half of this skill.
