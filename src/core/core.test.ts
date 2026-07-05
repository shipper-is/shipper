import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getProjectConfig,
  resolveDefaultModel,
  saveModelChoice,
  setProjectConfig,
} from "./config.ts";
import { buildSpikePrompt } from "./prompts.ts";
import { installSkills, SKILLS, skillPathForAgent } from "./skills.ts";

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

describe("installSkills", () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("writes embedded skills for each agent kind", async () => {
    dir = await mkdtemp(join(tmpdir(), "shipper-skills-"));

    await installSkills(dir, "claude");
    const claudePath = join(dir, skillPathForAgent("claude", "shipper-plan"));
    const content = await readFile(claudePath, "utf8");
    expect(content).toBe(SKILLS["shipper-plan"][0].content);
  });

  it("is idempotent when content matches", async () => {
    dir = await mkdtemp(join(tmpdir(), "shipper-skills-"));
    await installSkills(dir, "cursor");
    await installSkills(dir, "cursor");
    const path = join(dir, skillPathForAgent("cursor", "shipper-build"));
    expect(await readFile(path, "utf8")).toBe(SKILLS["shipper-build"][0].content);
  });

  it("writes all three shipper-spike files for cursor", async () => {
    dir = await mkdtemp(join(tmpdir(), "shipper-spike-skills-"));

    await installSkills(dir, "cursor");

    for (const { file, content } of SKILLS["shipper-spike"]) {
      const path = join(dir, ".cursor", "skills", "shipper-spike", file);
      expect(await readFile(path, "utf8")).toBe(content);
    }
  });
});

describe("buildSpikePrompt", () => {
  it("references the shipper-spike SKILL.md path and includes the description", () => {
    const description = "Add dark mode toggle";
    const prompt = buildSpikePrompt(description, "cursor");
    expect(prompt).toContain(skillPathForAgent("cursor", "shipper-spike"));
    expect(prompt).toContain(description);
    expect(prompt).toContain("Run a Shipper Spike");
  });
});
