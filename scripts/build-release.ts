#!/usr/bin/env bun
/**
 * Cross-platform release builds. Produces dist/shipper-<os>-<arch> per target.
 * Version is read from package.json and injected via --define.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import pkg from "../package.json" with { type: "json" };

const VERSION = pkg.version;

const TARGETS = [
  { bun: "bun-darwin-arm64", artifact: "shipper-darwin-arm64" },
  { bun: "bun-darwin-x64", artifact: "shipper-darwin-x64" },
  { bun: "bun-linux-x64", artifact: "shipper-linux-x64" },
  { bun: "bun-linux-arm64", artifact: "shipper-linux-arm64" },
] as const;

const distDir = join(import.meta.dir, "..", "dist");
await mkdir(distDir, { recursive: true });

const define = `--define __SHIPPER_VERSION__='"${VERSION}"'`;
const entry = join(import.meta.dir, "..", "src", "index.ts");

console.log(`Building Shipper v${VERSION} for ${TARGETS.length} targets…`);

for (const { bun, artifact } of TARGETS) {
  const outfile = join(distDir, artifact);
  console.log(`  ${bun} → ${artifact}`);
  const proc = Bun.spawn(
    [
      "bun",
      "build",
      "--compile",
      `--target=${bun}`,
      entry,
      "--outfile",
      outfile,
      define,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  const code = await proc.exited;
  if (code !== 0) {
    console.error(`Build failed for ${bun}`);
    process.exit(code);
  }
}

console.log(`Done. Artifacts in ${distDir}/`);
