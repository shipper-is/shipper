import { Command } from "commander";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { detectAgents } from "./agents/detect.ts";
import type { AgentKind } from "./agents/types.ts";
import { DEFAULT_EMBED_IDLE_MINUTES } from "./constants.ts";
import { getEmbedIdleMinutes, setEmbedIdleMinutes } from "./core/config.ts";
import {
  installModule,
  listRemoteModules,
  modulePlanHint,
  parseModuleReference,
} from "./core/modules.ts";
import { ensureShipperDirs } from "./core/plan-store.ts";
import { installSkillsGlobally, removeRepoSkills } from "./core/skills.ts";
import { formatProgress } from "./embeddings/assets.ts";
import { createLlamaEmbedder } from "./embeddings/client.ts";
import { runEmbedDaemon } from "./embeddings/daemon.ts";
import { indexPathForRepo } from "./embeddings/paths.ts";
import {
  ensureEmbedServer,
  getEmbedServerStatus,
  stopEmbedServer,
} from "./embeddings/server-manager.ts";
import type { DocType } from "./search/documents.ts";
import { syncIndex, syncIndexIfStale } from "./search/indexer.ts";
import { resolveRepoRoot } from "./search/repo-root.ts";
import { formatHits, searchIndex, type SearchFilters } from "./search/search.ts";
import { runMcpStdio } from "./mcp/server.ts";
import { startServer } from "./server/http.ts";
import { getVersion } from "./version.ts";

const DOC_TYPES = ["plan", "spike", "bug", "review"] as const satisfies readonly DocType[];

function isDocType(value: string): value is DocType {
  return (DOC_TYPES as readonly string[]).includes(value);
}

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

  const embedCmd = program.command("embed").description("manage the shared local embedding server");

  embedCmd
    .command("start")
    .description("download assets if needed and start the embedding server")
    .option("--idle-minutes <n>", "idle shutdown minutes (persisted)", (value) => {
      const n = Number.parseInt(value, 10);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`--idle-minutes must be a positive integer, got ${value}`);
      }
      return n;
    })
    .action(async (opts: { idleMinutes?: number }) => {
      try {
        if (opts.idleMinutes !== undefined) {
          await setEmbedIdleMinutes(opts.idleMinutes);
        }
        const idleMinutes = await getEmbedIdleMinutes();
        let lastPct = -1;
        let lastTotal: number | null = null;
        const { baseUrl } = await ensureEmbedServer({
          idleMinutes,
          onProgress: (received, total) => {
            if (total !== lastTotal) {
              lastTotal = total;
              lastPct = -1;
              if (lastTotal !== null) {
                process.stderr.write("\n");
              }
            }
            if (total === null || total <= 0) {
              process.stderr.write(`\r${formatProgress("assets", received, total)}`);
              return;
            }
            const pct = Math.min(100, Math.round((received / total) * 100));
            if (pct === 100 || pct - lastPct >= 5) {
              lastPct = pct;
              process.stderr.write(`\r${formatProgress("assets", received, total)}`);
            }
          },
        });
        if (lastPct >= 0) {
          process.stderr.write("\n");
        }
        const port = new URL(baseUrl).port;
        console.log(
          `Embedding server running at http://127.0.0.1:${port} (model nomic-embed-text-v1.5, idle shutdown after ${idleMinutes} min)`,
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(message);
        process.exit(1);
      }
    });

  embedCmd
    .command("stop")
    .description("stop the shared embedding server")
    .action(async () => {
      try {
        const { wasRunning } = await stopEmbedServer();
        console.log(wasRunning ? "Stopped embedding server." : "Embedding server is not running.");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(message);
        process.exit(1);
      }
    });

  embedCmd
    .command("status")
    .description("print embedding server status")
    .action(async () => {
      try {
        const status = await getEmbedServerStatus();
        console.log(`running: ${status.running}`);
        console.log(`port: ${status.port ?? "-"}`);
        console.log(`pid: ${status.pid ?? "-"}`);
        console.log(`modelId: ${status.modelId ?? "-"}`);
        console.log(`llamaBuild: ${status.llamaBuild ?? "-"}`);
        console.log(`startedAt: ${status.startedAt ?? "-"}`);
        console.log(`idleMinutes: ${status.idleMinutes}`);
        console.log(`lastUsedAt: ${status.lastUsedAt ?? "-"}`);
        console.log(`serverBinary: ${status.assets.serverBinary}`);
        console.log(`model: ${status.assets.model}`);
        console.log(`cacheDir: ${status.cacheDir}`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(message);
        process.exit(1);
      }
    });

  embedCmd
    .command("daemon", { hidden: true })
    .description("run the embedding server supervisor (internal)")
    .option("--idle-minutes <n>", "idle shutdown minutes", (value) => {
      const n = Number.parseInt(value, 10);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`--idle-minutes must be a positive integer, got ${value}`);
      }
      return n;
    })
    .action(async (opts: { idleMinutes?: number }) => {
      try {
        await runEmbedDaemon({
          idleMinutes: opts.idleMinutes ?? DEFAULT_EMBED_IDLE_MINUTES,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(message);
        process.exit(1);
      }
    });

  program
    .command("index")
    .description("build or refresh the semantic search index for a repository")
    .option("--force", "rebuild the index from scratch")
    .action(async (opts: { force?: boolean }, cmd) => {
      const globalOpts = cmd.optsWithGlobals() as { dir?: string };
      try {
        const repoRoot = await resolveRepoRoot({
          explicitDir: globalOpts.dir,
          cwd: process.cwd(),
        });
        const embedder = createLlamaEmbedder();
        const { index, stats } = await syncIndex({
          repoRoot,
          embedder,
          force: Boolean(opts.force),
        });
        console.log(
          `Indexed ${stats.files} files (${stats.chunks} chunks): embedded ${stats.embedded}, reused ${stats.reused}, removed ${stats.removed} in ${stats.ms} ms`,
        );
        console.log(indexPathForRepo(index.header.repoPath));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(message);
        process.exit(1);
      }
    });

  program
    .command("search")
    .description("semantically search Shipper plans, spikes, bugs, and reviews")
    .argument("<query...>", "natural-language search query")
    .option("--type <types>", "comma-separated doc types: plan,spike,bug,review")
    .option("--status <status>", "open, done, or any")
    .option("--limit <n>", "max results (1-25)", (value) => Number.parseInt(value, 10))
    .option("--json", "print results as JSON")
    .action(
      async (
        queryParts: string[],
        opts: { type?: string; status?: string; limit?: number; json?: boolean },
        cmd,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as { dir?: string };
        try {
          const query = queryParts.join(" ").trim();
          if (!query) {
            throw new Error("Search query must not be empty");
          }

          const filters: SearchFilters = {};
          if (opts.type) {
            const types = opts.type.split(",").map((t) => t.trim()).filter(Boolean);
            for (const t of types) {
              if (!isDocType(t)) {
                throw new Error(
                  `Unknown type: ${t}. Supported types: ${DOC_TYPES.join(", ")}`,
                );
              }
            }
            filters.types = types as DocType[];
          }
          if (opts.status !== undefined) {
            if (opts.status !== "open" && opts.status !== "done" && opts.status !== "any") {
              throw new Error(`--status must be open, done, or any (got ${opts.status})`);
            }
            filters.status = opts.status;
          }
          if (opts.limit !== undefined) {
            filters.limit = opts.limit;
          }

          const repoRoot = await resolveRepoRoot({
            explicitDir: globalOpts.dir,
            cwd: process.cwd(),
          });
          const embedder = createLlamaEmbedder();
          const { index } = await syncIndexIfStale({ repoRoot, embedder });
          const queryVector = await embedder.embedQuery(query);
          const hits = searchIndex(index, queryVector, filters);
          if (opts.json) {
            console.log(JSON.stringify(hits, null, 2));
          } else {
            console.log(formatHits(hits));
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(message);
          process.exit(1);
        }
      },
    );

  // Default action (no subcommand) runs the stdio MCP server. Phase 5 adds install/uninstall.
  const mcpCmd = program
    .command("mcp")
    .description("run the Shipper MCP server (stdio), or manage agent registration")
    .action(async (_opts, cmd) => {
      // stdout belongs to JSON-RPC; redirect casual logs to stderr (Gotcha 1).
      console.log = console.error;
      console.info = console.error;

      const dirFromCli = program.getOptionValueSource("dir") === "cli";
      const globalOpts = cmd.optsWithGlobals() as { dir?: string };
      const explicitDir = dirFromCli ? globalOpts.dir : undefined;

      try {
        await runMcpStdio({
          explicitDir,
          cwd: process.cwd(),
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(message);
        process.exit(1);
      }
    });

  // Reserved for Phase 5: mcpCmd.command("install"|"uninstall").
  void mcpCmd;

  await program.parseAsync(argv);
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
