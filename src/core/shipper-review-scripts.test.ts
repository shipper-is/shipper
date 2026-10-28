import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  LANES,
  loadConfig,
  resolveConfig,
  type Lane,
} from "../../skills/shipper-review/scripts/config.ts";
import {
  evaluate,
  validateScorecard,
  type Finding,
  type Scorecard,
} from "../../skills/shipper-review/scripts/policy.ts";
import {
  buildReport,
  countCoChange,
  groupUnits,
  matchesGlob,
  parseNumstat,
  type ChangedFile,
  type FloorReport,
} from "../../skills/shipper-review/scripts/risk-floor.ts";

const noSample = { ...DEFAULT_CONFIG, sampleRate: 0 };

function file(path: string, additions = 10): ChangedFile {
  return { path, status: "M", additions, deletions: 0 };
}

function report(paths: string[], config = noSample): FloorReport {
  return buildReport({
    target: "branch",
    base: "main",
    mergeBase: "base",
    head: "abc1234",
    files: paths.map((p) => file(p)),
    config,
  });
}

function fullCoverage(floor: FloorReport): Scorecard["lanes"] {
  return Object.fromEntries(
    LANES.map((lane) => [
      lane,
      {
        status: "completed",
        coverage: floor.units.map((u) => ({ unit: u.id, tier: u.floor[lane] })),
      },
    ]),
  ) as Scorecard["lanes"];
}

function finding(overrides: Partial<Finding> & { lane: Lane }): Finding {
  return {
    id: "F1",
    persona: "Adversarial QA",
    severity: "high",
    blocker: true,
    location: "src/a.ts:10",
    summary: "crashes on empty input",
    authorFamily: "claude",
    evidence: { kind: "repro-test", ref: "test/a.repro.test.ts fails" },
    verification: { result: "upheld", verifierFamily: "gpt" },
    ...overrides,
  };
}

describe("risk floor", () => {
  it("matches name globs against the file name and path globs against the whole path", () => {
    expect(matchesGlob("src/lib/useAuth.ts", "*auth*")).toBe(true);
    expect(matchesGlob("db/migrations/001_init.sql", "**/migrations/**")).toBe(true);
    expect(matchesGlob(".github/workflows/ci.yml", ".github/workflows/**")).toBe(true);
    expect(matchesGlob("web/package.json", "package.json")).toBe(true);
    expect(matchesGlob("src/a.{ts,tsx}", "*.{js,jsx}")).toBe(false);
    expect(matchesGlob("src/a.tsx", "*.{ts,tsx}")).toBe(true);
    expect(matchesGlob("src/components/Button.tsx", "*auth*")).toBe(false);
  });

  it("puts sensitive paths on a heavy floor for the rule's lanes only", () => {
    const floor = report(["src/auth/session.ts", "src/ui/button.tsx", "db/migrations/002.sql"]);
    const auth = floor.units.find((u) => u.id === "src/auth")!;
    expect(auth.floor.security).toBe("heavy");
    expect(auth.floor.uptime).toBe("heavy");
    expect(auth.floor.quality).toBe("light");
    expect(floor.units.find((u) => u.id === "src/ui")!.floor).toEqual({
      quality: "light",
      uptime: "light",
      intent: "light",
      performance: "light",
      security: "light",
    });
    expect(floor.units.find((u) => u.id === "db/migrations")!.floor.performance).toBe("heavy");
  });

  it("keeps ignored paths such as docs off the floor", () => {
    const floor = report(["docs/auth.md", "src/auth.ts"]);
    expect(floor.files.find((f) => f.path === "docs/auth.md")!.rules).toEqual([]);
    expect(floor.files.find((f) => f.path === "src/auth.ts")!.rules).toEqual(["auth"]);
  });

  it("groups tests with the changed source file they cover", () => {
    const units = groupUnits(["src/core/config.ts", "test/config.test.ts", "test/other.test.ts"]);
    expect(units.get("src/core")).toEqual(["src/core/config.ts", "test/config.test.ts"]);
    expect(units.get("test")).toEqual(["test/other.test.ts"]);
  });

  it("samples low-risk units deterministically and samples none at rate zero", () => {
    const paths = Array.from({ length: 200 }, (_, i) => `pkg${i}/index.ts`);
    const all = report(paths, { ...DEFAULT_CONFIG, sampleRate: 1 });
    expect(all.units.every((u) => u.sampled && u.floor.intent === "heavy")).toBe(true);
    expect(report(paths).units.some((u) => u.sampled)).toBe(false);
    const a = report(paths, DEFAULT_CONFIG)
      .units.filter((u) => u.sampled)
      .map((u) => u.id);
    const b = report(paths, DEFAULT_CONFIG)
      .units.filter((u) => u.sampled)
      .map((u) => u.id);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBeLessThan(40);
  });

  it("flags a diff over the file or line budget", () => {
    const config = { ...noSample, budget: { maxFiles: 2, maxChangedLines: 1000 } };
    expect(report(["a.ts", "b.ts"], config).budget.exceeded).toBe(false);
    expect(report(["a.ts", "b.ts", "c.ts"], config).budget.exceeded).toBe(true);
  });

  it("parses numstat, treating binary files as zero lines", () => {
    const files = parseNumstat("3\t1\tsrc/a.ts\n-\t-\tlogo.png", "M\tsrc/a.ts\nA\tlogo.png");
    expect(files).toEqual([
      { path: "src/a.ts", status: "M", additions: 3, deletions: 1 },
      { path: "logo.png", status: "A", additions: 0, deletions: 0 },
    ]);
  });

  it("reports files that usually change with a unit but are missing from the diff", () => {
    const log = [
      "@@",
      "src/a.ts",
      "src/b.ts",
      "@@",
      "src/a.ts",
      "src/b.ts",
      "@@",
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
    ].join("\n");
    expect(countCoChange(log, ["src/a.ts"], new Set(["src/a.ts"]))).toEqual([
      { path: "src/b.ts", count: 3 },
    ]);
  });

  it("reads the review key from the repo config and falls back on broken JSON", async () => {
    const repo = await mkdtemp(join(tmpdir(), "shipper-review-"));
    await mkdir(join(repo, ".shipper"));
    expect((await loadConfig(repo)).config.sampleRate).toBe(DEFAULT_CONFIG.sampleRate);

    await writeFile(
      join(repo, ".shipper", "config.json"),
      JSON.stringify({ git: { branchMode: "feature" }, review: { sampleRate: 0.2 } }),
    );
    expect((await loadConfig(repo)).config.sampleRate).toBe(0.2);

    await writeFile(join(repo, ".shipper", "config.json"), "{ nope");
    const broken = await loadConfig(repo);
    expect(broken.config.sampleRate).toBe(DEFAULT_CONFIG.sampleRate);
    expect(broken.warnings[0]).toContain("not valid JSON");
  });

  it("adds repo rules to the defaults and rejects invalid config keys", () => {
    const { config, warnings } = resolveConfig({
      riskFloor: [{ name: "tenancy", paths: ["**/tenants/**"], lanes: ["security"] }],
      sampleRate: 2,
    });
    expect(config.riskFloor.map((r) => r.name)).toContain("tenancy");
    expect(config.riskFloor.map((r) => r.name)).toContain("auth");
    expect(config.sampleRate).toBe(DEFAULT_CONFIG.sampleRate);
    expect(warnings).toHaveLength(1);
  });
});

describe("policy", () => {
  const floor = report(["src/ui/button.tsx"]);

  it("is ready for human review when every lane passes", () => {
    const result = evaluate(
      { commit: "abc1234", lanes: fullCoverage(floor), findings: [] },
      floor,
      noSample,
    );
    expect(result.verdict).toBe("ready");
    expect(result.header).toBe(
      "Verdict: READY FOR HUMAN REVIEW\nQUIPS: Quality PASS · Uptime PASS · Intent PASS · Performance PASS · Security PASS",
    );
    expect(result.frontmatter).toMatchObject({ verdict: "ready", security: "pass" });
  });

  it("sends a proven, cross-checked blocker back to the author", () => {
    const result = evaluate(
      { commit: "abc1234", lanes: fullCoverage(floor), findings: [finding({ lane: "uptime" })] },
      floor,
      noSample,
    );
    expect(result.verdict).toBe("fix");
    expect(result.lanes.uptime).toBe("block");
    expect(result.blockers).toEqual(["F1"]);
  });

  it("demotes blockers without evidence, without an upheld verification, or below high severity", () => {
    const findings = [
      finding({ id: "A", lane: "uptime", evidence: null }),
      finding({ id: "B", lane: "uptime", verification: { result: "not-run" } }),
      finding({
        id: "D",
        lane: "performance",
        evidence: { kind: "code-trace", ref: "looks like N+1" },
      }),
      finding({
        id: "E",
        lane: "quality",
        severity: "medium",
        evidence: { kind: "rule-citation", ref: "docs/a.md" },
      }),
    ];
    const result = evaluate(
      { commit: "abc1234", lanes: fullCoverage(floor), findings },
      floor,
      noSample,
    );
    expect(result.verdict).toBe("ready");
    expect(result.demoted.map((d) => d.id)).toEqual(["A", "B", "D", "E"]);
    expect(result.lanes.performance).toBe("suggest");
  });

  it("escalates a proven blocker that only the author's model family checked", () => {
    const result = evaluate(
      {
        commit: "abc1234",
        lanes: fullCoverage(floor),
        findings: [
          finding({ lane: "uptime", verification: { result: "upheld", verifierFamily: "Claude" } }),
        ],
      },
      floor,
      noSample,
    );
    expect(result.verdict).toBe("escalate");
    expect(result.lanes.uptime).toBe("block");
    expect(result.reasons[0]).toContain("same model family");
  });

  it("ignores findings the verifier deleted or the author fixed", () => {
    const findings = [
      finding({
        id: "A",
        lane: "uptime",
        verification: { result: "deleted", verifierFamily: "gpt" },
      }),
      finding({ id: "B", lane: "uptime", status: "fixed" }),
    ];
    const result = evaluate(
      { commit: "abc1234", lanes: fullCoverage(floor), findings },
      floor,
      noSample,
    );
    expect(result.verdict).toBe("ready");
    expect(result.lanes.uptime).toBe("pass");
  });

  it("escalates confirmed security findings and keeps them open until a named human dismisses them", () => {
    const security = finding({
      lane: "security",
      persona: "Tenancy Guard",
      evidence: { kind: "cross-tenant-probe", ref: "org B read org A invoices" },
    });
    const lanes = fullCoverage(floor);
    expect(
      evaluate({ commit: "abc1234", lanes, findings: [security] }, floor, noSample).verdict,
    ).toBe("escalate");
    expect(
      evaluate(
        { commit: "abc1234", lanes, findings: [{ ...security, status: "dismissed" }] },
        floor,
        noSample,
      ).verdict,
    ).toBe("escalate");
    expect(
      evaluate(
        {
          commit: "abc1234",
          lanes,
          findings: [{ ...security, status: "dismissed", dismissedBy: "@sec-lead" }],
        },
        floor,
        noSample,
      ).verdict,
    ).toBe("ready");
  });

  it("escalates an unproven high-severity security concern instead of dropping it", () => {
    const result = evaluate(
      {
        commit: "abc1234",
        lanes: fullCoverage(floor),
        findings: [finding({ lane: "security", evidence: null })],
      },
      floor,
      noSample,
    );
    expect(result.verdict).toBe("escalate");
  });

  it("fails closed when the security lane does not complete or skips a scanner", () => {
    const failed = fullCoverage(floor);
    failed.security = { status: "failed", reason: "timeout", coverage: [] };
    expect(
      evaluate({ commit: "abc1234", lanes: failed, findings: [] }, floor, noSample).verdict,
    ).toBe("escalate");

    const skipped = fullCoverage(floor);
    skipped.security = { ...skipped.security, scannersSkipped: ["dependency audit"] };
    expect(
      evaluate({ commit: "abc1234", lanes: skipped, findings: [] }, floor, noSample).verdict,
    ).toBe("escalate");
  });

  it("escalates when triage reviewed a unit below its risk floor or skipped a unit", () => {
    const authFloor = report(["src/auth/session.ts"]);
    const lowered = fullCoverage(authFloor);
    lowered.security = { status: "completed", coverage: [{ unit: "src/auth", tier: "light" }] };
    const result = evaluate(
      { commit: "abc1234", lanes: lowered, findings: [] },
      authFloor,
      noSample,
    );
    expect(result.verdict).toBe("escalate");
    expect(result.reasons[0]).toContain("below its heavy floor");

    const missing = fullCoverage(authFloor);
    missing.intent = { status: "completed", coverage: [] };
    expect(
      evaluate({ commit: "abc1234", lanes: missing, findings: [] }, authFloor, noSample).verdict,
    ).toBe("escalate");
  });

  it("escalates on budget overruns, self-consistency disagreement, and disputed blockers", () => {
    const lanes = fullCoverage(floor);
    expect(
      evaluate({ commit: "abc1234", lanes, findings: [], budgetExceeded: true }, floor, noSample)
        .verdict,
    ).toBe("escalate");
    expect(
      evaluate(
        {
          commit: "abc1234",
          lanes,
          findings: [],
          selfConsistency: [{ unit: "src/ui", lane: "uptime", agreed: false }],
        },
        floor,
        noSample,
      ).verdict,
    ).toBe("escalate");
    expect(
      evaluate(
        {
          commit: "abc1234",
          lanes,
          findings: [
            finding({
              lane: "intent",
              status: "disputed",
              evidence: { kind: "criterion-trace", ref: "AC2 unmet" },
            }),
          ],
        },
        floor,
        noSample,
      ).verdict,
    ).toBe("escalate");
  });

  it("escalates when the scorecard was written for a different commit", () => {
    const result = evaluate(
      { commit: "fff0000", lanes: fullCoverage(floor), findings: [] },
      floor,
      noSample,
    );
    expect(result.verdict).toBe("escalate");
  });

  it("rejects malformed scorecards", () => {
    expect(validateScorecard({ commit: "a", lanes: {}, findings: [] })).toContain(
      "lanes.quality is missing",
    );
    expect(validateScorecard({ commit: "a", lanes: fullCoverage(floor), findings: [] })).toEqual(
      [],
    );
  });
});
