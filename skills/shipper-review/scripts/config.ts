import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_FILE, resolveConfig, type ReviewConfig } from "./review-config.ts";

// Imports must stay limited to node: builtins. The skill is installed without node_modules.
// Policy values live in review-config.ts so the setup console can bundle them.

export {
  CONFIG_FILE,
  DEFAULT_CONFIG,
  DEFAULT_EVIDENCE_KINDS,
  DEFAULT_RISK_FLOOR,
  LANES,
  resolveConfig,
  type Lane,
  type ReviewConfig,
  type RiskRule,
  type Tier,
} from "./review-config.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
