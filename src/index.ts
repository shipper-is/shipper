import { Command } from "commander";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "ink";
import React from "react";
import { App } from "./app.tsx";
import { ensureShipperDirs } from "./core/plan-store.ts";
import { getVersion } from "./version.ts";

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = new Command();

  program
    .name("shipper")
    .description("Shipper — plan and build with coding agents")
    .option("--dir <path>", "target repository directory", process.cwd())
    .option("--demo", "run with scripted demo events for feed/modal verification")
    .option("--version", "print version and exit")
    .parse(argv);

  const opts = program.opts<{
    dir: string;
    demo?: boolean;
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

  const { waitUntilExit } = render(
    React.createElement(App, { repoPath, demoMode: Boolean(opts.demo) }),
    { alternateScreen: true },
  );
  await waitUntilExit();
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
