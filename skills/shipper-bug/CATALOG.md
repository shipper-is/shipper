The CATALOG step turns a bug report of any quality — even a single sentence — into a structured bug file that the FIX step (or a future engineer) can pick up cold.

1. Gather just enough context from the codebase to understand what the user is describing: find the feature area involved, and check ".shipper/bugs/open" for an existing file describing the same bug (if one exists, update it instead of creating a duplicate).

2. If the report is missing information you cannot recover yourself — exact steps they took, what they expected to see, which environment it happened in — use the tool you have available to ask the user clarifying questions. Only ask for what you genuinely cannot reconstruct; prefer reproducing it yourself over interrogating the user.

3. Create the bug file at ".shipper/bugs/open/<short-bug-name>.md" with YAML frontmatter and the section skeleton below. Sections that belong to later steps are created empty — they get filled in during FIX, never speculatively at intake.

```yaml
---
severity: blocking | major | minor
reported_at: "2026-07-04T22:15:00-05:00"
---
```

(`branch`, `base_branch`, `fixed_at`, `pr_url`, and `pr_number` are added later by the FIX step and the shipper-ship skill; never add them at intake.)

The body of the bug file:

----
# <Short bug title>

## Symptom
- What actually happens, in one or two sentences
- What was expected to happen instead
- Where it was observed (page, command, environment)

## Reproduction
- Exact numbered steps or the exact command to trigger the bug (fill in during FIX if not yet known; until then write "Not yet reproduced" plus whatever partial detail the reporter gave)

## Root Cause
- (empty until diagnosed)

## Fix
- (empty until fixed)

## Regression Guard
- (empty until proven)
----

Severity guidance: "blocking" means a core flow is broken or data is at risk, "major" means a feature misbehaves but there is a workaround, "minor" means cosmetic or edge-case annoyance. When unsure between two, pick the higher one.

Keep the Symptom section faithful to what was actually observed. Do not editorialize a suspected cause into the symptom — suspicions go nowhere until the Root Cause section is earned with evidence during FIX.

4. If the user only wanted the bug cataloged, commit the bug file and stop here. Otherwise proceed directly into FIX.md.
