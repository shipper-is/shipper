import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentKind } from "../agents/types.ts";
import { SKILL_NAMES, type SkillName } from "../shared/config-schema.ts";
import { globalSkillsRoot, SKILLS } from "./skills.ts";

export type SkillInstallState = "current" | "outdated" | "missing";

export type SkillStatusEntry = {
  name: SkillName;
  state: SkillInstallState;
};

export type AgentSkillStatus = {
  agent: AgentKind;
  root: string;
  skills: SkillStatusEntry[];
};

async function readUtf8(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function skillState(root: string, name: SkillName): Promise<SkillInstallState> {
  const dir = join(root, name);
  const skillMd = await readUtf8(join(dir, "SKILL.md"));
  if (skillMd === null) {
    return "missing";
  }

  for (const file of SKILLS[name]) {
    const content = file.file === "SKILL.md" ? skillMd : await readUtf8(join(dir, file.file));
    if (content === null || content !== file.content) {
      return "outdated";
    }
  }
  return "current";
}

export async function getSkillStatus(agents: AgentKind[]): Promise<AgentSkillStatus[]> {
  return Promise.all(
    agents.map(async (agent) => {
      const root = globalSkillsRoot(agent);
      const skills = await Promise.all(
        SKILL_NAMES.map(async (name) => ({
          name,
          state: await skillState(root, name),
        })),
      );
      return { agent, root, skills };
    }),
  );
}
