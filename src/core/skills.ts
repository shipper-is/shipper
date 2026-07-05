import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import planSkill from "../../skills/shipper-plan/SKILL.md" with { type: "text" };
import buildSkill from "../../skills/shipper-build/SKILL.md" with { type: "text" };
import shipSkill from "../../skills/shipper-ship/SKILL.md" with { type: "text" };
import type { AgentKind } from "../agents/types.ts";

const SKILLS = {
  "shipper-plan": planSkill,
  "shipper-build": buildSkill,
  "shipper-ship": shipSkill,
} as const;

export type SkillName = keyof typeof SKILLS;

export const SKILL_NAMES = Object.keys(SKILLS) as SkillName[];

function skillPathForAgent(agent: AgentKind, name: SkillName): string {
  switch (agent) {
    case "claude":
      return join(".claude", "skills", name, "SKILL.md");
    case "cursor":
      return join(".cursor", "skills", name, "SKILL.md");
    case "opencode":
      return join(".opencode", "skill", name, "SKILL.md");
  }
}

async function writeSkillIfChanged(
  targetRepo: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const fullPath = join(targetRepo, relativePath);
  await mkdir(dirname(fullPath), { recursive: true });

  try {
    const existing = await readFile(fullPath, "utf8");
    if (existing === content) {
      return;
    }
  } catch {
    // file missing — write it
  }

  await writeFile(fullPath, content, "utf8");
}

export async function installSkills(targetRepo: string, agent: AgentKind): Promise<void> {
  for (const name of Object.keys(SKILLS) as SkillName[]) {
    const relativePath = skillPathForAgent(agent, name);
    await writeSkillIfChanged(targetRepo, relativePath, SKILLS[name]);
  }
}

export { SKILLS, skillPathForAgent };
