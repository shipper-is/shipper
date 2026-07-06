#!/usr/bin/env bun
/**
 * Local dev/release-style build for the current platform.
 * Version is read from package.json and injected via --define.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import pkg from "../package.json" with { type: "json" };

const VERSION = pkg.version;
const distDir = join(import.meta.dir, "..", "dist");
const outfile = join(distDir, "shipper");
const entry = join(import.meta.dir, "..", "src", "index.ts");
const define = `--define __SHIPPER_VERSION__='"${VERSION}"'`;

await mkdir(distDir, { recursive: true });

console.log(`Building Shipper v${VERSION} → dist/shipper`);

const proc = Bun.spawn(
  ["bun", "build", "--compile", entry, "--outfile", outfile, define],
  { stdout: "inherit", stderr: "inherit" },
);

const code = await proc.exited;
if (code !== 0) {
  process.exit(code);
}
