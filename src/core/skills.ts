import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import planSkill from "../../skills/shipper-plan/SKILL.md" with { type: "text" };
import buildSkill from "../../skills/shipper-build/SKILL.md" with { type: "text" };
import buildPr from "../../skills/shipper-build/PR.md" with { type: "text" };
import spikeSkill from "../../skills/shipper-spike/SKILL.md" with { type: "text" };
import spikePlan from "../../skills/shipper-spike/PLAN.md" with { type: "text" };
import spikeBuild from "../../skills/shipper-spike/BUILD.md" with { type: "text" };
import shipSkill from "../../skills/shipper-ship/SKILL.md" with { type: "text" };
import bugSkill from "../../skills/shipper-bug/SKILL.md" with { type: "text" };
import bugCatalog from "../../skills/shipper-bug/CATALOG.md" with { type: "text" };
import bugFix from "../../skills/shipper-bug/FIX.md" with { type: "text" };
import type { AgentKind } from "../agents/types.ts";

export type SkillFile = {
  file: string;
  content: string;
};

const SKILLS = {
  "shipper-plan": [{ file: "SKILL.md", content: planSkill }],
  "shipper-build": [
    { file: "SKILL.md", content: buildSkill },
    { file: "PR.md", content: buildPr },
  ],
  "shipper-spike": [
    { file: "SKILL.md", content: spikeSkill },
    { file: "PLAN.md", content: spikePlan },
    { file: "BUILD.md", content: spikeBuild },
  ],
  "shipper-ship": [{ file: "SKILL.md", content: shipSkill }],
  "shipper-bug": [
    { file: "SKILL.md", content: bugSkill },
    { file: "CATALOG.md", content: bugCatalog },
    { file: "FIX.md", content: bugFix },
  ],
} as const satisfies Record<string, readonly SkillFile[]>;

export type SkillName = keyof typeof SKILLS;

export type OrchestratedSkillName = "shipper-plan" | "shipper-build" | "shipper-spike";

export const SKILL_NAMES = Object.keys(SKILLS) as SkillName[];

export type InstallSummary = {
  agent: AgentKind;
  root: string;
};

export function globalSkillsRoot(agent: AgentKind): string {
  switch (agent) {
    case "claude":
      return join(homedir(), ".claude", "skills");
    case "cursor":
      return join(homedir(), ".cursor", "skills");
    case "opencode": {
      const configHome = process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config");
      return join(configHome, "opencode", "skills");
    }
  }
}

export function globalSkillPath(agent: AgentKind, name: SkillName): string {
  return join(globalSkillsRoot(agent), name, "SKILL.md");
}

function repoSkillDirForAgent(agent: AgentKind, name: SkillName): string {
  switch (agent) {
    case "claude":
      return join(".claude", "skills", name);
    case "cursor":
      return join(".cursor", "skills", name);
    case "opencode":
      return join(".opencode", "skill", name);
  }
}

async function writeSkillIfChanged(absolutePath: string, content: string): Promise<void> {
  await mkdir(dirname(absolutePath), { recursive: true });

  try {
    const existing = await readFile(absolutePath, "utf8");
    if (existing === content) {
      return;
    }
  } catch {
    // file missing — write it
  }

  await writeFile(absolutePath, content, "utf8");
}

export async function installSkillsGlobally(agents: AgentKind[]): Promise<InstallSummary[]> {
  const summaries: InstallSummary[] = [];

  for (const agent of agents) {
    const root = globalSkillsRoot(agent);
    for (const name of SKILL_NAMES) {
      for (const { file, content } of SKILLS[name]) {
        const absolutePath = join(root, name, file);
        await writeSkillIfChanged(absolutePath, content);
      }
    }
    summaries.push({ agent, root });
  }

  return summaries;
}

export async function removeRepoSkills(targetRepo: string): Promise<void> {
  const agents: AgentKind[] = ["claude", "cursor", "opencode"];
  for (const name of SKILL_NAMES) {
    for (const agent of agents) {
      const path = join(targetRepo, repoSkillDirForAgent(agent, name));
      await rm(path, { recursive: true, force: true });
    }
  }
}

export { SKILLS };
