import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getProjectConfig,
  resolveDefaultModel,
  saveModelChoice,
  setProjectConfig,
} from "./config.ts";
import { buildSpikePrompt } from "./prompts.ts";
import {
  SKILLS,
  globalSkillPath,
  installSkillsGlobally,
  removeRepoSkills,
} from "./skills.ts";

describe("config", () => {
  it("returns empty config for unknown projects", async () => {
    const repo = await mkdtemp(join(tmpdir(), "shipper-config-empty-"));
    const cfg = await getProjectConfig(repo);
    expect(cfg).toEqual({});
  });

  it("persists project config patches", async () => {
    const repo = await mkdtemp(join(tmpdir(), "shipper-config-persist-"));
    await setProjectConfig(repo, { agent: "cursor", lastPlan: "foo.md" });
    const cfg = await getProjectConfig(repo);
    expect(cfg.agent).toBe("cursor");
    expect(cfg.lastPlan).toBe("foo.md");
  });
});

describe("model config", () => {
  it("saves a model choice at project scope", async () => {
    const repo = await mkdtemp(join(tmpdir(), "shipper-model-save-"));
    await saveModelChoice(repo, "cursor", "shipper-plan", "composer-2.5");
    const cfg = await getProjectConfig(repo);
    expect(cfg.models?.cursor?.["shipper-plan"]).toBe("composer-2.5");
  });

  it("falls back to the global default when the project has none", async () => {
    const repoA = await mkdtemp(join(tmpdir(), "shipper-model-global-a-"));
    const repoB = await mkdtemp(join(tmpdir(), "shipper-model-global-b-"));
    await saveModelChoice(repoA, "cursor", "shipper-plan", "composer-2.5");
    expect(await resolveDefaultModel(repoB, "cursor", "shipper-plan")).toBe("composer-2.5");
  });

  it("prefers the project value over the global default", async () => {
    const repoA = await mkdtemp(join(tmpdir(), "shipper-model-priority-a-"));
    const repoB = await mkdtemp(join(tmpdir(), "shipper-model-priority-b-"));
    await saveModelChoice(repoA, "cursor", "shipper-plan", "global-model");
    await saveModelChoice(repoB, "cursor", "shipper-plan", "project-model");
    expect(await resolveDefaultModel(repoA, "cursor", "shipper-plan")).toBe("global-model");
    expect(await resolveDefaultModel(repoB, "cursor", "shipper-plan")).toBe("project-model");
  });

  it("returns undefined when neither project nor global is set", async () => {
    const repo = await mkdtemp(join(tmpdir(), "shipper-model-missing-"));
    expect(await resolveDefaultModel(repo, "claude", "shipper-build")).toBeUndefined();
  });
});

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

  it("writes all five skills with all files under the claude global directory", async () => {
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

describe("buildSpikePrompt", () => {
  let homeDir: string;
  let previousHome: string | undefined;

  beforeEach(async () => {
    previousHome = process.env["HOME"];
    homeDir = await mkdtemp(join(tmpdir(), "shipper-prompt-home-"));
    process.env["HOME"] = homeDir;
  });

  afterEach(async () => {
    if (previousHome === undefined) {
      delete process.env["HOME"];
    } else {
      process.env["HOME"] = previousHome;
    }
    if (homeDir) await rm(homeDir, { recursive: true, force: true });
  });

  it("references the shipper-spike SKILL.md path and includes the description", () => {
    const description = "Add dark mode toggle";
    const prompt = buildSpikePrompt(description, "cursor");
    expect(prompt).toContain(globalSkillPath("cursor", "shipper-spike"));
    expect(prompt).not.toContain("target repository");
    expect(prompt).toContain(description);
    expect(prompt).toContain("Run a Shipper Spike");
  });
});
