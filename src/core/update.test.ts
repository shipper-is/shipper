import { describe, expect, it, vi } from "vitest";
import { runUpdate } from "./update.ts";
import type { UpdateStatus } from "./update-check.ts";

function status(overrides: Partial<UpdateStatus>): UpdateStatus {
  return {
    current: "1.0.0",
    latest: "2.0.0",
    updateAvailable: true,
    installCommand: "curl -fsSL https://example.com/install.sh | sh",
    ...overrides,
  };
}

describe("runUpdate", () => {
  it("--check prints when an update is available", async () => {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((line: string) => {
      logs.push(line);
    });
    const code = await runUpdate(
      { check: true },
      {
        getUpdateStatus: async () => status({}),
        runInstallCommand: async () => {},
      },
    );
    logSpy.mockRestore();
    expect(code).toBe(0);
    expect(logs.some((line) => line.includes("Update available"))).toBe(true);
  });

  it("skips install when already on latest", async () => {
    const install = vi.fn(async () => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runUpdate(
      {},
      {
        getUpdateStatus: async () =>
          status({ latest: "1.0.0", updateAvailable: false }),
        runInstallCommand: install,
      },
    );
    logSpy.mockRestore();
    expect(code).toBe(0);
    expect(install).not.toHaveBeenCalled();
  });

  it("runs install when a newer release exists", async () => {
    const install = vi.fn(async () => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runUpdate(
      {},
      {
        getUpdateStatus: async () => status({}),
        runInstallCommand: install,
      },
    );
    logSpy.mockRestore();
    expect(code).toBe(0);
    expect(install).toHaveBeenCalledOnce();
  });

  it("--force reinstalls even when current", async () => {
    const install = vi.fn(async () => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runUpdate(
      { force: true },
      {
        getUpdateStatus: async () =>
          status({ latest: "1.0.0", updateAvailable: false }),
        runInstallCommand: install,
      },
    );
    logSpy.mockRestore();
    expect(code).toBe(0);
    expect(install).toHaveBeenCalledOnce();
  });
});
