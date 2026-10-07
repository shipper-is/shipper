import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export async function ensureShipperDirs(repoPath: string): Promise<void> {
  for (const root of ["plans", "spikes", "bugs"] as const) {
    await mkdir(join(repoPath, ".shipper", root, "open"), { recursive: true });
    await mkdir(join(repoPath, ".shipper", root, "done"), { recursive: true });
  }
}
