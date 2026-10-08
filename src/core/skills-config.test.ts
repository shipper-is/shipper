import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SKILL_NAMES } from "../shared/config-schema.ts";

const skillsRoot = join(import.meta.dirname, "../../skills");
const configCopies = [...SKILL_NAMES, "shipper-review"];

describe("CONFIG.md", () => {
  it("keeps every skill copy byte-identical to skills/CONFIG.md", async () => {
    const canonical = await readFile(join(skillsRoot, "CONFIG.md"));
    const found: string[] = [];

    for (const entry of await readdir(skillsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const copyPath = join(skillsRoot, entry.name, "CONFIG.md");
      try {
        const copy = await readFile(copyPath);
        expect(copy.equals(canonical)).toBe(true);
        found.push(entry.name);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }

    expect(found.sort()).toEqual([...configCopies].sort());
  });

  it("links CONFIG.md from every bundled skill and shipper-review", async () => {
    for (const name of configCopies) {
      const skill = await readFile(join(skillsRoot, name, "SKILL.md"), "utf8");
      expect(skill).toContain("[./CONFIG.md](./CONFIG.md)");
    }
  });
});
