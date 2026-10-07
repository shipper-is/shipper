import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { resolveRepoRoot } from "./repo-root.ts";

const temps: string[] = [];

afterEach(async () => {
  for (const dir of temps.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeTempRepo(withShipper = true): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "shipper-repo-root-"));
  temps.push(root);
  if (withShipper) {
    await mkdir(join(root, ".shipper", "plans", "open"), { recursive: true });
  }
  return root;
}

describe("resolveRepoRoot", () => {
  it("prefers an explicit dir over cwd and root URIs", async () => {
    const explicit = await makeTempRepo();
    const cwdRoot = await makeTempRepo();
    const result = await resolveRepoRoot({
      explicitDir: explicit,
      rootUris: [pathToFileURL(cwdRoot).href],
      cwd: cwdRoot,
    });
    expect(result).toBe(await import("node:fs/promises").then((fs) => fs.realpath(explicit)));
  });

  it("ignores an explicit dir that still contains ${", async () => {
    const cwdRoot = await makeTempRepo();
    const result = await resolveRepoRoot({
      explicitDir: "${workspaceFolder}",
      cwd: cwdRoot,
    });
    expect(result).toBe(await import("node:fs/promises").then((fs) => fs.realpath(cwdRoot)));
  });

  it("uses the first file:// root URI over cwd", async () => {
    const uriRoot = await makeTempRepo();
    const cwdRoot = await makeTempRepo();
    const result = await resolveRepoRoot({
      rootUris: [pathToFileURL(uriRoot).href],
      cwd: cwdRoot,
    });
    expect(result).toBe(await import("node:fs/promises").then((fs) => fs.realpath(uriRoot)));
  });

  it("walks up from a nested folder to find .shipper", async () => {
    const root = await makeTempRepo();
    const nested = join(root, "src", "search");
    await mkdir(nested, { recursive: true });
    await writeFile(join(nested, "file.ts"), "", "utf8");
    const result = await resolveRepoRoot({ cwd: nested });
    expect(result).toBe(await import("node:fs/promises").then((fs) => fs.realpath(root)));
  });

  it("falls back to .git when .shipper is absent", async () => {
    const root = await makeTempRepo(false);
    await mkdir(join(root, ".git"), { recursive: true });
    const nested = join(root, "pkg");
    await mkdir(nested, { recursive: true });
    const result = await resolveRepoRoot({ cwd: nested });
    expect(result).toBe(await import("node:fs/promises").then((fs) => fs.realpath(root)));
  });
});
