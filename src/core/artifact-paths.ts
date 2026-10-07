import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  ARTIFACT_TYPES,
  DEFAULT_ARTIFACT_PATHS,
  type ArtifactType,
  type EffectiveConfig,
} from "../shared/config-schema.ts";
import { ensureShipperGitignore } from "./config.ts";

const SCAFFOLD_TYPES = ["plans", "spikes", "bugs"] as const satisfies readonly ArtifactType[];
const STRAY_TYPES = ["plans", "spikes", "bugs", "reviews"] as const satisfies readonly ArtifactType[];

function absFromRepo(repoRoot: string, rel: string): string {
  return join(repoRoot, ...rel.split("/").filter((part) => part.length > 0));
}

/** Absolute paths for each artifact type. `effective.paths` is already validated. */
export function resolveArtifactDirs(
  repoRoot: string,
  effective: EffectiveConfig,
): Record<ArtifactType, string> {
  const dirs = {} as Record<ArtifactType, string>;
  for (const type of ARTIFACT_TYPES) {
    dirs[type] = absFromRepo(repoRoot, effective.paths[type]);
  }
  return dirs;
}

export async function ensureArtifactDirs(
  repoRoot: string,
  effective: EffectiveConfig,
): Promise<void> {
  const dirs = resolveArtifactDirs(repoRoot, effective);
  for (const type of SCAFFOLD_TYPES) {
    await mkdir(join(dirs[type], "open"), { recursive: true });
    await mkdir(join(dirs[type], "done"), { recursive: true });
  }
  await ensureShipperGitignore(repoRoot);
}

async function countMdFiles(dir: string): Promise<number> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return 0;
  }
  let count = 0;
  for (const name of names) {
    if (name.endsWith(".md")) count += 1;
  }
  return count;
}

/**
 * Markdown left in a default artifact directory after that type was configured
 * somewhere else. Reviews are counted in the directory itself; plans, spikes,
 * and bugs also include `open/` and `done/`.
 */
export async function findStrayArtifacts(
  repoRoot: string,
  effective: EffectiveConfig,
): Promise<Array<{ type: ArtifactType; dir: string; count: number }>> {
  const found: Array<{ type: ArtifactType; dir: string; count: number }> = [];
  for (const type of STRAY_TYPES) {
    const configured = effective.paths[type];
    const fallback = DEFAULT_ARTIFACT_PATHS[type];
    if (configured === fallback) continue;

    const defaultAbs = absFromRepo(repoRoot, fallback);
    const scanDirs =
      type === "reviews"
        ? [defaultAbs]
        : [defaultAbs, join(defaultAbs, "open"), join(defaultAbs, "done")];
    let count = 0;
    for (const dir of scanDirs) {
      count += await countMdFiles(dir);
    }
    if (count > 0) {
      found.push({ type, dir: fallback, count });
    }
  }
  return found;
}
