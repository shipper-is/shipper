import { Command } from "commander";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { detectAgents } from "./agents/detect.ts";
import type { AgentKind } from "./agents/types.ts";
import {
  installModule,
  listRemoteModules,
  modulePlanHint,
  parseModuleReference,
} from "./core/modules.ts";
import { ensureShipperDirs } from "./core/plan-store.ts";
import { installSkillsGlobally, removeRepoSkills } from "./core/skills.ts";
import { startServer } from "./server/http.ts";
import { getVersion } from "./version.ts";

const AGENT_KINDS = ["claude", "cursor", "opencode"] as const satisfies readonly AgentKind[];

function isAgentKind(value: string): value is AgentKind {
  return (AGENT_KINDS as readonly string[]).includes(value);
}

type ServeOptions = {
  dir: string;
  demo?: boolean;
  port?: number;
  open?: boolean;
  version?: boolean;
};

async function installGlobalSkillsForServe(repoPath: string): Promise<void> {
  try {
    const detected = await detectAgents();
    if (detected.length === 0) {
      console.log(
        "No coding agents detected — global skills were not refreshed. Run `shipper skills` after installing an agent.",
      );
    } else {
      await installSkillsGlobally(detected.map((agent) => agent.kind));
      const names = detected.map((agent) => agent.kind).join(", ");
      console.log(`Skills installed globally for: ${names}`);
    }
    await removeRepoSkills(repoPath);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`Warning: could not install global skills (${message})`);
  }
}

async function runServe(opts: ServeOptions): Promise<void> {
  if (opts.version) {
    console.log(getVersion());
    return;
  }

  const repoPath = resolve(opts.dir);

  if (!existsSync(repoPath)) {
    console.error(`Directory does not exist: ${repoPath}`);
    process.exit(1);
  }

  await ensureShipperDirs(repoPath);
  await installGlobalSkillsForServe(repoPath);

  let stopping = false;
  let server: Awaited<ReturnType<typeof startServer>> | null = null;

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`\n${signal} received, shutting down…`);
    if (server) {
      await server.stop();
    }
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  server = await startServer(repoPath, {
    port: opts.port,
    openBrowser: opts.open !== false,
    demoMode: Boolean(opts.demo),
  });

  console.log(`Shipper running at ${server.url}`);
  console.log(`Repository: ${repoPath}`);
  if (opts.demo) {
    console.log("Demo mode — scripted chat and question flow in the browser.");
  }
  console.log("Press Ctrl+C to stop.");

  await new Promise<void>(() => {
    // keep process alive until signal
  });
}

async function runSkillsInstall(agentOverride?: string): Promise<void> {
  let agents: AgentKind[];

  if (agentOverride !== undefined) {
    if (!isAgentKind(agentOverride)) {
      console.error(`Unknown agent: ${agentOverride}`);
      console.error(`Supported agents: ${AGENT_KINDS.join(", ")}`);
      process.exit(1);
    }
    agents = [agentOverride];
  } else {
    const detected = await detectAgents();
    if (detected.length === 0) {
      console.error("No coding agents detected on this machine.");
      console.error(`Supported agents: ${AGENT_KINDS.join(", ")}`);
      console.error("Install an agent, or run: shipper skills --agent <kind>");
      process.exit(1);
    }
    agents = detected.map((agent) => agent.kind);
  }

  const summaries = await installSkillsGlobally(agents);
  for (const { agent, root } of summaries) {
    console.log(`${agent}: ${root}`);
  }
}

async function runModulesList(): Promise<void> {
  const modules = await listRemoteModules();
  if (modules.length === 0) {
    console.log("No modules found.");
    return;
  }
  for (const mod of modules) {
    console.log(`${mod.id} — ${mod.name}: ${mod.description}`);
  }
}

async function runModulesAdd(moduleRef: string, dir: string): Promise<void> {
  const id = parseModuleReference(moduleRef);
  if (!id) {
    throw new Error(
      `Invalid module reference: ${moduleRef}. Use a module id (e.g. customer-support), https://shipper.is/modules/<id>, or a GitHub modules URL.`,
    );
  }

  const targetDir = resolve(dir);
  if (!existsSync(targetDir)) {
    throw new Error(`Directory does not exist: ${targetDir}`);
  }

  const result = await installModule(id, targetDir);
  console.log(`Installed module ${result.id} to ${result.root}`);
  for (const file of result.files) {
    console.log(`  ${file}`);
  }
  console.log(modulePlanHint(result.id));
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = new Command();

  program
    .name("shipper")
    .description("Shipper — plan and build with coding agents")
    .option("--dir <path>", "target repository directory", process.cwd())
    .option("--demo", "run with scripted demo events in the browser UI")
    .option("--port <n>", "HTTP port override", (value) => Number.parseInt(value, 10))
    .option("--no-open", "do not open the browser automatically")
    .option("--version", "print version and exit")
    .action(async (opts: ServeOptions) => {
      await runServe(opts);
    });

  program
    .command("skills")
    .description("install Shipper skills globally for your coding agents")
    .option("--agent <kind>", "install for a specific agent (claude, cursor, opencode)")
    .action(async (opts: { agent?: string }) => {
      await runSkillsInstall(opts.agent);
    });

  const modulesCmd = program
    .command("modules")
    .description("discover and install Shipper modules");

  modulesCmd
    .command("list")
    .description("list available modules from the Shipper repository")
    .action(async () => {
      try {
        await runModulesList();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(message);
        process.exit(1);
      }
    });

  modulesCmd
    .command("add")
    .description("install a module into .shipper/modules/ in the target repository")
    .argument("<module>", "module id, shipper.is URL, or GitHub modules URL")
    .action(async (moduleRef: string, _opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals() as { dir?: string };
      try {
        await runModulesAdd(moduleRef, globalOpts.dir ?? process.cwd());
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(message);
        process.exit(1);
      }
    });

  await program.parseAsync(argv);
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
