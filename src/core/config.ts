import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { AgentKind } from "../agents/types.ts";
import type { SkillName } from "./skills.ts";

const agentKindSchema = z.enum(["claude", "cursor", "opencode"]);

const skillModelsSchema = z.object({
  "shipper-plan": z.string().optional(),
  "shipper-build": z.string().optional(),
});

const agentModelsSchema = z.object({
  claude: skillModelsSchema.optional(),
  cursor: skillModelsSchema.optional(),
  opencode: skillModelsSchema.optional(),
});

const projectConfigSchema = z.object({
  agent: agentKindSchema.optional(),
  lastPlan: z.string().optional(),
  models: agentModelsSchema.optional(),
});

const configSchema = z.object({
  projects: z.record(z.string(), projectConfigSchema).default({}),
  defaults: z
    .object({
      agent: agentKindSchema.optional(),
      lastUpdateCheckAt: z.number().optional(),
      latestKnownVersion: z.string().optional(),
      models: agentModelsSchema.optional(),
    })
    .optional(),
});

export type ProjectConfig = z.infer<typeof projectConfigSchema>;
export type ShipperConfig = z.infer<typeof configSchema>;
export type AgentModels = z.infer<typeof agentModelsSchema>;

function configDir(): string {
  const xdg = process.env["XDG_CONFIG_HOME"];
  if (xdg) {
    return join(xdg, "shipper");
  }
  return join(homedir(), ".config", "shipper");
}

function configPath(): string {
  return join(configDir(), "config.json");
}

async function readConfig(): Promise<ShipperConfig> {
  try {
    const raw = await readFile(configPath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return configSchema.parse(parsed);
  } catch {
    return { projects: {} };
  }
}

async function writeConfig(config: ShipperConfig): Promise<void> {
  const dir = configDir();
  await mkdir(dir, { recursive: true });
  const path = configPath();
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(config, null, 2) + "\n", "utf8");
  await rename(tmp, path);
}

export async function getProjectConfig(repoPath: string): Promise<ProjectConfig> {
  const config = await readConfig();
  return config.projects[repoPath] ?? {};
}

export async function setProjectConfig(
  repoPath: string,
  patch: Partial<ProjectConfig>,
): Promise<ProjectConfig> {
  const config = await readConfig();
  const current = config.projects[repoPath] ?? {};
  const next = { ...current, ...patch };
  config.projects[repoPath] = next;
  await writeConfig(config);
  return next;
}

export async function getDefaultAgent(): Promise<AgentKind | undefined> {
  const config = await readConfig();
  return config.defaults?.agent;
}

export async function setDefaultAgent(agent: AgentKind): Promise<void> {
  const config = await readConfig();
  config.defaults = { ...config.defaults, agent };
  await writeConfig(config);
}

export async function resolveDefaultModel(
  repoPath: string,
  agent: AgentKind,
  skill: SkillName,
): Promise<string | undefined> {
  const config = await readConfig();
  return (
    config.projects[repoPath]?.models?.[agent]?.[skill] ??
    config.defaults?.models?.[agent]?.[skill]
  );
}

export async function saveModelChoice(
  repoPath: string,
  agent: AgentKind,
  skill: SkillName,
  model: string,
): Promise<void> {
  const config = await readConfig();
  const currentProject = config.projects[repoPath] ?? {};
  const projectModels = currentProject.models ?? {};
  const projectAgentModels = projectModels[agent] ?? {};

  config.projects[repoPath] = {
    ...currentProject,
    models: {
      ...projectModels,
      [agent]: {
        ...projectAgentModels,
        [skill]: model,
      },
    },
  };

  const defaults = config.defaults ?? {};
  const defaultModels = defaults.models ?? {};
  const defaultAgentModels = defaultModels[agent] ?? {};

  if (!defaultAgentModels[skill]) {
    config.defaults = {
      ...defaults,
      models: {
        ...defaultModels,
        [agent]: {
          ...defaultAgentModels,
          [skill]: model,
        },
      },
    };
  }

  await writeConfig(config);
}

export type UpdateCheckState = {
  lastCheckAt?: number;
  latestKnown?: string;
};

export async function getUpdateCheckState(): Promise<UpdateCheckState> {
  const config = await readConfig();
  return {
    lastCheckAt: config.defaults?.lastUpdateCheckAt,
    latestKnown: config.defaults?.latestKnownVersion,
  };
}

export async function setUpdateCheckState(patch: UpdateCheckState): Promise<void> {
  const config = await readConfig();
  config.defaults = {
    ...config.defaults,
    lastUpdateCheckAt: patch.lastCheckAt ?? config.defaults?.lastUpdateCheckAt,
    latestKnownVersion: patch.latestKnown ?? config.defaults?.latestKnownVersion,
  };
  await writeConfig(config);
}

export { configDir, configPath, configSchema };
