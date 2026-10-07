import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SKILL_NAMES } from "../shared/config-schema.ts";
import { globalSkillsRoot, installSkillsGlobally, SKILLS } from "./skills.ts";
import { getSkillStatus } from "./skill-status.ts";

describe("getSkillStatus", () => {
  let homeDir: string;
  let previousHome: string | undefined;
  let previousXdg: string | undefined;

  beforeEach(async () => {
    previousHome = process.env["HOME"];
    previousXdg = process.env["XDG_CONFIG_HOME"];
    homeDir = await mkdtemp(join(tmpdir(), "shipper-skill-status-"));
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
    await rm(homeDir, { recursive: true, force: true });
  });

  it("marks skills missing, outdated, or current against the bundled files", async () => {
    const root = globalSkillsRoot("cursor");
    expect(root.startsWith(homeDir)).toBe(true);
    await installSkillsGlobally(["cursor"]);

    await rm(join(root, "shipper-plan", "SKILL.md"));
    const git = SKILLS["shipper-build"].find((file) => file.file === "GIT.md");
    expect(git).toBeDefined();
    await writeFile(join(root, "shipper-build", "GIT.md"), "stale", "utf8");
    await rm(join(root, "shipper-ship", "CONFIG.md"));

    const [cursor] = await getSkillStatus(["cursor"]);
    expect(cursor?.root).toBe(root);
    const byName = new Map(cursor?.skills.map((skill) => [skill.name, skill.state]));
    expect(byName.get("shipper-plan")).toBe("missing");
    expect(byName.get("shipper-build")).toBe("outdated");
    expect(byName.get("shipper-ship")).toBe("outdated");
    expect(byName.get("shipper-loop")).toBe("current");
    expect([...byName.keys()]).toEqual([...SKILL_NAMES]);
  });
});
