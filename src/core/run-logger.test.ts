import { describe, expect, it } from "vitest";
import { RunLogger, logsDir } from "./run-logger.ts";

describe("RunLogger", () => {
  it("creates ndjson log files under config logs dir", async () => {
    const logger = await RunLogger.create("cursor");
    expect(logger.path).toContain(logsDir());
    expect(logger.path).toMatch(/cursor\.ndjson$/);
    await logger.logEvent({ type: "text", text: "hello" });
    await logger.close({ ok: true });
  });
});
