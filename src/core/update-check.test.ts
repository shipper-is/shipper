import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkForUpdate, getUpdateStatus } from "./update-check.ts";
import { getUpdateCheckState, setUpdateCheckState } from "./config.ts";

describe("getUpdateStatus", () => {
  let homeDir: string;
  let xdgDir: string;
  const envBackup = { ...process.env };

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "shipper-update-check-home-"));
    xdgDir = join(homeDir, ".config");
    process.env = {
      ...envBackup,
      HOME: homeDir,
      XDG_CONFIG_HOME: xdgDir,
    };
  });

  afterEach(async () => {
    process.env = envBackup;
    await rm(homeDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("uses cached latest within one day without refetching", async () => {
    await setUpdateCheckState({ lastCheckAt: Date.now(), latestKnown: "99.0.0" });
    const fetchLatest = vi.fn(async () => "100.0.0");

    const status = await getUpdateStatus({ fetchLatest });
    expect(fetchLatest).not.toHaveBeenCalled();
    expect(status.latest).toBe("99.0.0");
    expect(status.updateAvailable).toBe(true);
  });

  it("refetches when force is true", async () => {
    await setUpdateCheckState({ lastCheckAt: Date.now(), latestKnown: "99.0.0" });
    const fetchLatest = vi.fn(async () => "100.0.0");

    const status = await getUpdateStatus({ force: true, fetchLatest });
    expect(fetchLatest).toHaveBeenCalledOnce();
    expect(status.latest).toBe("100.0.0");
  });

  it("checkForUpdate returns null when running version is current", async () => {
    const current = (await import("../version.ts")).getVersion();
    await setUpdateCheckState({ lastCheckAt: Date.now(), latestKnown: current });
    const notice = await checkForUpdate();
    expect(notice).toBeNull();
  });
});
