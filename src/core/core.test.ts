import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SKILLS,
  installSkillsGlobally,
  removeRepoSkills,
} from "./skills.ts";

describe("installSkillsGlobally", () => {
  let homeDir: string;
  let previousHome: string | undefined;
  let previousXdg: string | undefined;

  beforeEach(async () => {
    previousHome = process.env["HOME"];
    previousXdg = process.env["XDG_CONFIG_HOME"];
    homeDir = await mkdtemp(join(tmpdir(), "shipper-home-"));
    process.env["HOME"] = homeDir;
    delete process.env["XDG_CONFIG_HOME"];
  });

  afterEach(async () => {
    if (previousHome === undefined) {
      delete process.env["HOME"];
    } else {
      process.env["HOME"] = previousHome;
    }
    if (previousXdg === undefined) {
      delete process.env["XDG_CONFIG_HOME"];
    } else {
      process.env["XDG_CONFIG_HOME"] = previousXdg;
    }
    if (homeDir) await rm(homeDir, { recursive: true, force: true });
  });

  it("writes all skills with all files under the claude global directory", async () => {
    const summaries = await installSkillsGlobally(["claude"]);
    expect(summaries).toEqual([{ agent: "claude", root: join(homeDir, ".claude", "skills") }]);

    for (const name of Object.keys(SKILLS) as (keyof typeof SKILLS)[]) {
      for (const { file, content } of SKILLS[name]) {
        const path = join(homeDir, ".claude", "skills", name, file);
        expect(await readFile(path, "utf8")).toBe(content);
      }
    }
  });

  it("writes opencode skills under .config/opencode/skills by default", async () => {
    await installSkillsGlobally(["opencode"]);

    for (const { file, content } of SKILLS["shipper-plan"]) {
      const path = join(homeDir, ".config", "opencode", "skills", "shipper-plan", file);
      expect(await readFile(path, "utf8")).toBe(content);
    }
  });

  it("respects XDG_CONFIG_HOME for opencode", async () => {
    const xdgHome = await mkdtemp(join(tmpdir(), "shipper-xdg-"));
    process.env["XDG_CONFIG_HOME"] = xdgHome;

    await installSkillsGlobally(["opencode"]);

    const path = join(xdgHome, "opencode", "skills", "shipper-build", "SKILL.md");
    expect(await readFile(path, "utf8")).toBe(SKILLS["shipper-build"][0].content);

    await rm(xdgHome, { recursive: true, force: true });
  });

  it("is idempotent and overwrites edited files back to embedded content", async () => {
    await installSkillsGlobally(["cursor"]);
    await installSkillsGlobally(["cursor"]);

    const path = join(homeDir, ".cursor", "skills", "shipper-build", "SKILL.md");
    expect(await readFile(path, "utf8")).toBe(SKILLS["shipper-build"][0].content);

    await writeFile(path, "stale content", "utf8");
    await installSkillsGlobally(["cursor"]);
    expect(await readFile(path, "utf8")).toBe(SKILLS["shipper-build"][0].content);
  });
});

describe("removeRepoSkills", () => {
  let repoDir: string;

  afterEach(async () => {
    if (repoDir) await rm(repoDir, { recursive: true, force: true });
  });

  it("deletes shipper-owned skill dirs but leaves unrelated skills untouched", async () => {
    repoDir = await mkdtemp(join(tmpdir(), "shipper-repo-cleanup-"));

    const shipperPlan = join(repoDir, ".cursor", "skills", "shipper-plan");
    const customSkill = join(repoDir, ".cursor", "skills", "my-custom-skill");
    const claudeShipper = join(repoDir, ".claude", "skills", "shipper-build");
    const opencodeShipper = join(repoDir, ".opencode", "skill", "shipper-spike");

    await mkdir(shipperPlan, { recursive: true });
    await writeFile(join(shipperPlan, "SKILL.md"), "old", "utf8");
    await mkdir(customSkill, { recursive: true });
    await writeFile(join(customSkill, "SKILL.md"), "keep me", "utf8");
    await mkdir(claudeShipper, { recursive: true });
    await writeFile(join(claudeShipper, "SKILL.md"), "old", "utf8");
    await mkdir(opencodeShipper, { recursive: true });
    await writeFile(join(opencodeShipper, "SKILL.md"), "old", "utf8");

    await removeRepoSkills(repoDir);

    await expect(readFile(join(shipperPlan, "SKILL.md"), "utf8")).rejects.toThrow();
    await expect(readFile(join(claudeShipper, "SKILL.md"), "utf8")).rejects.toThrow();
    await expect(readFile(join(opencodeShipper, "SKILL.md"), "utf8")).rejects.toThrow();
    expect(await readFile(join(customSkill, "SKILL.md"), "utf8")).toBe("keep me");
  });
});
