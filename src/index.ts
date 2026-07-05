import { Command } from "commander";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ensureShipperDirs } from "./core/plan-store.ts";
import { startServer } from "./server/http.ts";
import { getVersion } from "./version.ts";

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
    .parse(argv);

  const opts = program.opts<{
    dir: string;
    demo?: boolean;
    port?: number;
    open?: boolean;
    version?: boolean;
  }>();

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

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
