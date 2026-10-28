import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Imports must stay limited to node: builtins. The skill is installed without node_modules.

export const LANES = ["quality", "uptime", "intent", "performance", "security"] as const;
export type Lane = (typeof LANES)[number];
export type Tier = "light" | "heavy";

export type RiskRule = { name: string; paths: string[]; lanes: Lane[] };

export type ReviewConfig = {
  riskFloor: RiskRule[];
  floorIgnore: string[];
  sampleRate: number;
  budget: { maxFiles: number; maxChangedLines: number };
  evidenceKinds: Record<Lane, string[]>;
};

export const CONFIG_FILE = ".shipper/config.json";

export const DEFAULT_RISK_FLOOR: RiskRule[] = [
  {
    name: "auth",
    lanes: ["security", "uptime"],
    paths: [
      "*auth*",
      "**/*auth*/**",
      "*session*",
      "*permission*",
      "*rbac*",
      "*login*",
      "*oauth*",
      "*jwt*",
      "*middleware*",
    ],
  },
  {
    name: "billing",
    lanes: ["security", "uptime", "intent"],
    paths: [
      "*billing*",
      "**/*billing*/**",
      "*payment*",
      "**/*payment*/**",
      "*stripe*",
      "*invoice*",
      "*subscription*",
      "*checkout*",
    ],
  },
  {
    name: "migrations",
    lanes: ["uptime", "performance"],
    paths: [
      "**/migrations/**",
      "**/migrate/**",
      "*migration*",
      "*.sql",
      "schema.prisma",
      "**/db/schema*",
    ],
  },
  {
    name: "infra",
    lanes: ["uptime", "security"],
    paths: [
      ".github/workflows/**",
      ".circleci/**",
      "Dockerfile*",
      "*.dockerfile",
      "docker-compose*",
      "*.tf",
      "*.tfvars",
      "**/terraform/**",
      "**/infra/**",
      "**/k8s/**",
      "**/helm/**",
      "vercel.json",
      "fly.toml",
      "netlify.toml",
      "wrangler.toml",
      "Procfile",
    ],
  },
  {
    name: "dependencies",
    lanes: ["security"],
    paths: [
      "package.json",
      "bun.lock",
      "bun.lockb",
      "package-lock.json",
      "yarn.lock",
      "pnpm-lock.yaml",
      "requirements*.txt",
      "pyproject.toml",
      "poetry.lock",
      "uv.lock",
      "Pipfile*",
      "Gemfile",
      "Gemfile.lock",
      "*.gemspec",
      "go.mod",
      "go.sum",
      "Cargo.toml",
      "Cargo.lock",
      "composer.json",
      "composer.lock",
      "Podfile",
      "Podfile.lock",
      "build.gradle*",
      "pom.xml",
    ],
  },
  {
    name: "secrets",
    lanes: ["security"],
    paths: [".env*", "*secret*", "*credential*", "*.pem", "*.key"],
  },
];

export const DEFAULT_EVIDENCE_KINDS: Record<Lane, string[]> = {
  quality: ["rule-citation"],
  uptime: ["repro-test", "ci-failure", "migration-check", "contract-trace"],
  intent: ["criterion-trace", "claim-check", "scope-trace"],
  performance: ["query-plan", "benchmark", "bundle-diff", "production-query"],
  security: ["repro-test", "cross-tenant-probe", "scanner", "secret-match", "code-trace"],
};

export const DEFAULT_CONFIG: ReviewConfig = {
  riskFloor: DEFAULT_RISK_FLOOR,
  floorIgnore: ["*.md", "*.mdx"],
  sampleRate: 0.05,
  budget: { maxFiles: 150, maxChangedLines: 6000 },
  evidenceKinds: DEFAULT_EVIDENCE_KINDS,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string" && v.length > 0);
}

function isLane(value: unknown): value is Lane {
  return typeof value === "string" && (LANES as readonly string[]).includes(value);
}

function parseRule(value: unknown): RiskRule | null {
  if (!isRecord(value)) return null;
  const { name, paths, lanes } = value;
  if (
    typeof name !== "string" ||
    !isStringArray(paths) ||
    !Array.isArray(lanes) ||
    !lanes.every(isLane)
  ) {
    return null;
  }
  return { name, paths, lanes };
}

/** Invalid keys keep their defaults and produce a warning; unknown keys are ignored. */
export function resolveConfig(raw: unknown): { config: ReviewConfig; warnings: string[] } {
  const warnings: string[] = [];
  const config: ReviewConfig = {
    riskFloor: [...DEFAULT_RISK_FLOOR],
    floorIgnore: [...DEFAULT_CONFIG.floorIgnore],
    sampleRate: DEFAULT_CONFIG.sampleRate,
    budget: { ...DEFAULT_CONFIG.budget },
    evidenceKinds: { ...DEFAULT_EVIDENCE_KINDS },
  };
  if (raw === undefined) return { config, warnings };
  if (!isRecord(raw)) {
    warnings.push(`review in ${CONFIG_FILE} is not an object; using defaults`);
    return { config, warnings };
  }

  if (raw.replaceDefaultRiskFloor === true) config.riskFloor = [];
  if (raw.riskFloor !== undefined) {
    const rules = Array.isArray(raw.riskFloor) ? raw.riskFloor.map(parseRule) : [null];
    if (rules.every((r): r is RiskRule => r !== null)) {
      config.riskFloor.push(...rules);
    } else {
      warnings.push("riskFloor must be an array of { name, paths, lanes }; ignoring it");
    }
  }

  if (raw.floorIgnore !== undefined) {
    if (isStringArray(raw.floorIgnore)) {
      config.floorIgnore = raw.floorIgnore;
    } else {
      warnings.push("floorIgnore must be an array of globs; using default");
    }
  }

  if (raw.sampleRate !== undefined) {
    if (typeof raw.sampleRate === "number" && raw.sampleRate >= 0 && raw.sampleRate <= 1) {
      config.sampleRate = raw.sampleRate;
    } else {
      warnings.push("sampleRate must be a number from 0 to 1; using default");
    }
  }

  if (raw.budget !== undefined) {
    if (isRecord(raw.budget)) {
      for (const key of ["maxFiles", "maxChangedLines"] as const) {
        const value = raw.budget[key];
        if (value === undefined) continue;
        if (typeof value === "number" && Number.isInteger(value) && value > 0) {
          config.budget[key] = value;
        } else {
          warnings.push(`budget.${key} must be a positive integer; using default`);
        }
      }
    } else {
      warnings.push("budget must be an object; using defaults");
    }
  }

  if (raw.evidenceKinds !== undefined) {
    if (isRecord(raw.evidenceKinds)) {
      for (const [lane, kinds] of Object.entries(raw.evidenceKinds)) {
        if (isLane(lane) && isStringArray(kinds)) {
          config.evidenceKinds[lane] = kinds;
        } else {
          warnings.push(
            `evidenceKinds.${lane} is not a known lane with a string array; ignoring it`,
          );
        }
      }
    } else {
      warnings.push("evidenceKinds must be an object; using defaults");
    }
  }

  return { config, warnings };
}

/** Reads `review` from the repo config only; review settings are team policy, like `paths`. */
export async function loadConfig(
  repo: string,
): Promise<{ config: ReviewConfig; warnings: string[] }> {
  let text: string;
  try {
    text = await readFile(join(repo, CONFIG_FILE), "utf8");
  } catch {
    return resolveConfig(undefined);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const result = resolveConfig(undefined);
    result.warnings.push(`${CONFIG_FILE} is not valid JSON; using review defaults`);
    return result;
  }
  return resolveConfig(isRecord(parsed) ? parsed.review : undefined);
}

export function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[arg.slice(2)] = next;
      i++;
    } else {
      out[arg.slice(2)] = true;
    }
  }
  return out;
}
