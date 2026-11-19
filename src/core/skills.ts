import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import planSkill from "../../skills/shipper-plan/SKILL.md" with { type: "text" };
import planConfig from "../../skills/shipper-plan/CONFIG.md" with { type: "text" };
import buildSkill from "../../skills/shipper-build/SKILL.md" with { type: "text" };
import buildGit from "../../skills/shipper-build/GIT.md" with { type: "text" };
import buildPr from "../../skills/shipper-build/PR.md" with { type: "text" };
import buildConfig from "../../skills/shipper-build/CONFIG.md" with { type: "text" };
import loopSkill from "../../skills/shipper-loop/SKILL.md" with { type: "text" };
import loopConfig from "../../skills/shipper-loop/CONFIG.md" with { type: "text" };
import spikeSkill from "../../skills/shipper-spike/SKILL.md" with { type: "text" };
import spikePlan from "../../skills/shipper-spike/PLAN.md" with { type: "text" };
import spikeBuild from "../../skills/shipper-spike/BUILD.md" with { type: "text" };
import spikeGit from "../../skills/shipper-spike/GIT.md" with { type: "text" };
import spikeConfig from "../../skills/shipper-spike/CONFIG.md" with { type: "text" };
import shipSkill from "../../skills/shipper-ship/SKILL.md" with { type: "text" };
import shipGit from "../../skills/shipper-ship/GIT.md" with { type: "text" };
import shipConfig from "../../skills/shipper-ship/CONFIG.md" with { type: "text" };
import bugSkill from "../../skills/shipper-bug/SKILL.md" with { type: "text" };
import bugCatalog from "../../skills/shipper-bug/CATALOG.md" with { type: "text" };
import bugFix from "../../skills/shipper-bug/FIX.md" with { type: "text" };
import bugGit from "../../skills/shipper-bug/GIT.md" with { type: "text" };
import bugConfig from "../../skills/shipper-bug/CONFIG.md" with { type: "text" };
import reviewSkill from "../../skills/shipper-review/SKILL.md" with { type: "text" };
import reviewLanes from "../../skills/shipper-review/LANES.md" with { type: "text" };
import reviewConfigDoc from "../../skills/shipper-review/CONFIG.md" with { type: "text" };
// Bun embeds the source (`type: "text"`). tsc resolves these as modules, which have no default export.
// @ts-expect-error TS1192 -- text import, not the module's exports
import reviewRiskFloor from "../../skills/shipper-review/scripts/risk-floor.ts" with { type: "text" };
// @ts-expect-error TS1192 -- text import, not the module's exports
import reviewPolicy from "../../skills/shipper-review/scripts/policy.ts" with { type: "text" };
// @ts-expect-error TS1192 -- text import, not the module's exports
import reviewScriptConfig from "../../skills/shipper-review/scripts/config.ts" with { type: "text" };
// @ts-expect-error TS1192 -- text import, not the module's exports
import reviewPolicyConfig from "../../skills/shipper-review/scripts/review-config.ts" with { type: "text" };
import type { AgentKind } from "../agents/types.ts";
import {
  INSTALLED_SKILL_NAMES,
  SKILL_NAMES,
  type InstalledSkillName,
  type SkillName,
} from "../shared/config-schema.ts";

export { INSTALLED_SKILL_NAMES, SKILL_NAMES, type InstalledSkillName, type SkillName };

export type SkillFile = {
  file: string;
  content: string;
};

const SKILLS = {
  "shipper-plan": [
    { file: "SKILL.md", content: planSkill },
    { file: "CONFIG.md", content: planConfig },
  ],
  "shipper-build": [
    { file: "SKILL.md", content: buildSkill },
    { file: "GIT.md", content: buildGit },
    { file: "PR.md", content: buildPr },
    { file: "CONFIG.md", content: buildConfig },
  ],
  "shipper-loop": [
    { file: "SKILL.md", content: loopSkill },
    { file: "CONFIG.md", content: loopConfig },
  ],
  "shipper-spike": [
    { file: "SKILL.md", content: spikeSkill },
    { file: "PLAN.md", content: spikePlan },
    { file: "BUILD.md", content: spikeBuild },
    { file: "GIT.md", content: spikeGit },
    { file: "CONFIG.md", content: spikeConfig },
  ],
  "shipper-ship": [
    { file: "SKILL.md", content: shipSkill },
    { file: "GIT.md", content: shipGit },
    { file: "CONFIG.md", content: shipConfig },
  ],
  "shipper-bug": [
    { file: "SKILL.md", content: bugSkill },
    { file: "CATALOG.md", content: bugCatalog },
    { file: "FIX.md", content: bugFix },
    { file: "GIT.md", content: bugGit },
    { file: "CONFIG.md", content: bugConfig },
  ],
  "shipper-review": [
    { file: "SKILL.md", content: reviewSkill },
    { file: "LANES.md", content: reviewLanes },
    { file: "CONFIG.md", content: reviewConfigDoc },
    { file: "scripts/risk-floor.ts", content: reviewRiskFloor },
    { file: "scripts/policy.ts", content: reviewPolicy },
    { file: "scripts/config.ts", content: reviewScriptConfig },
    { file: "scripts/review-config.ts", content: reviewPolicyConfig },
  ],
} as const satisfies Record<InstalledSkillName, readonly SkillFile[]>;

export type InstallSummary = {
  agent: AgentKind;
  root: string;
};

function userHome(): string {
  // os.homedir() caches its first result. Read HOME first so tests and status
  // checks stay inside a temp directory when HOME is overridden.
  return process.env["HOME"] ?? homedir();
}

export function globalSkillsRoot(agent: AgentKind): string {
  switch (agent) {
    case "claude":
      return join(userHome(), ".claude", "skills");
    case "cursor":
      return join(userHome(), ".cursor", "skills");
    case "opencode": {
      const configHome = process.env["XDG_CONFIG_HOME"] ?? join(userHome(), ".config");
      return join(configHome, "opencode", "skills");
    }
  }
}

export function globalSkillPath(agent: AgentKind, name: InstalledSkillName): string {
  return join(globalSkillsRoot(agent), name, "SKILL.md");
}

function repoSkillDirForAgent(agent: AgentKind, name: InstalledSkillName): string {
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
    for (const name of INSTALLED_SKILL_NAMES) {
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
  for (const name of INSTALLED_SKILL_NAMES) {
    for (const agent of agents) {
      const path = join(targetRepo, repoSkillDirForAgent(agent, name));
      await rm(path, { recursive: true, force: true });
    }
  }
}

export { SKILLS };
