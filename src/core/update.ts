import { execa } from "execa";
import { INSTALL_COMMAND } from "../constants.ts";
import { migrateGlobalConfig } from "./config.ts";
import { getUpdateStatus } from "./update-check.ts";

export type RunUpdateOptions = {
  check?: boolean;
  force?: boolean;
};

export type RunUpdateDeps = {
  getUpdateStatus: typeof getUpdateStatus;
  runInstallCommand: () => Promise<void>;
};

const defaultDeps: RunUpdateDeps = {
  getUpdateStatus,
  runInstallCommand: async () => {
    await execa("sh", ["-c", INSTALL_COMMAND], { stdio: "inherit" });
  },
};

/**
 * Check for a newer Shipper release and optionally run the curl install script.
 * Returns a process exit code (0 success, 1 when an update check failed offline).
 */
export async function runUpdate(
  opts: RunUpdateOptions,
  deps: RunUpdateDeps = defaultDeps,
): Promise<number> {
  await migrateGlobalConfig();
  const status = await deps.getUpdateStatus({ force: true });

  if (opts.check) {
    if (status.latest === null) {
      console.log(`Could not determine the latest release (running ${status.current}).`);
      console.log(`Upgrade manually: ${status.installCommand}`);
      return 0;
    }
    if (status.updateAvailable) {
      console.log(`Update available: ${status.current} → ${status.latest}`);
      console.log(`Run \`shipper update\` or: ${status.installCommand}`);
      return 0;
    }
    console.log(`Shipper ${status.current} is up to date (latest ${status.latest}).`);
    return 0;
  }

  if (!opts.force && !status.updateAvailable) {
    if (status.latest === null) {
      console.error("Could not reach GitHub to check for updates.");
      console.error(`Upgrade manually: ${status.installCommand}`);
      return 1;
    }
    console.log(`Shipper ${status.current} is already on the latest release (${status.latest}).`);
    console.log("Re-run with --force to reinstall anyway.");
    return 0;
  }

  if (status.updateAvailable && status.latest) {
    console.log(`Upgrading Shipper ${status.current} → ${status.latest}…`);
  } else {
    console.log(`Reinstalling Shipper ${status.current}…`);
  }
  await deps.runInstallCommand();
  return 0;
}
