import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import planSkill from "../../skills/shipper-plan/SKILL.md" with { type: "text" };
import buildSkill from "../../skills/shipper-build/SKILL.md" with { type: "text" };
import spikeSkill from "../../skills/shipper-spike/SKILL.md" with { type: "text" };
import spikePlan from "../../skills/shipper-spike/PLAN.md" with { type: "text" };
import spikeBuild from "../../skills/shipper-spike/BUILD.md" with { type: "text" };
import type { AgentKind } from "../agents/types.ts";

export type SkillFile = {
  file: string;
  content: string;
};

const SKILLS = {
  "shipper-plan": [{ file: "SKILL.md", content: planSkill }],
  "shipper-build": [{ file: "SKILL.md", content: buildSkill }],
  "shipper-spike": [
    { file: "SKILL.md", content: spikeSkill },
    { file: "PLAN.md", content: spikePlan },
    { file: "BUILD.md", content: spikeBuild },
  ],
} as const satisfies Record<string, readonly SkillFile[]>;

export type SkillName = keyof typeof SKILLS;

export const SKILL_NAMES = Object.keys(SKILLS) as SkillName[];

function skillDirForAgent(agent: AgentKind, name: SkillName): string {
  switch (agent) {
    case "claude":
      return join(".claude", "skills", name);
    case "cursor":
      return join(".cursor", "skills", name);
    case "opencode":
      return join(".opencode", "skill", name);
  }
}

function skillPathForAgent(agent: AgentKind, name: SkillName): string {
  return join(skillDirForAgent(agent, name), "SKILL.md");
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
    for (const { file, content } of SKILLS[name]) {
      const relativePath = join(skillDirForAgent(agent, name), file);
      await writeSkillIfChanged(targetRepo, relativePath, content);
    }
  }
}

export { SKILLS, skillPathForAgent };
