import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_EMBED_IDLE_MINUTES } from "../constants.ts";
import { getEmbedIdleMinutes, setEmbedIdleMinutes } from "./config.ts";

describe("embed idle minutes", () => {
  let previousHome: string | undefined;
  let previousXdg: string | undefined;
  let homeDir: string;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "shipper-embed-idle-"));
    previousHome = process.env["HOME"];
    previousXdg = process.env["XDG_CONFIG_HOME"];
    process.env["HOME"] = homeDir;
    delete process.env["XDG_CONFIG_HOME"];
  });

  afterEach(async () => {
    if (previousHome === undefined) {
      delete process.env["HOME"];
    } else {
      process.env["HOME"] = previousHome;
    }
    if (previousXdg === undefined) {
      delete process.env["XDG_CONFIG_HOME"];
    } else {
      process.env["XDG_CONFIG_HOME"] = previousXdg;
    }
    await rm(homeDir, { recursive: true, force: true });
  });

  it("defaults to DEFAULT_EMBED_IDLE_MINUTES", async () => {
    expect(await getEmbedIdleMinutes()).toBe(DEFAULT_EMBED_IDLE_MINUTES);
  });

  it("persists a configured value", async () => {
    await setEmbedIdleMinutes(7);
    expect(await getEmbedIdleMinutes()).toBe(7);
  });

  it("rejects non-positive idle minutes", async () => {
    await expect(setEmbedIdleMinutes(0)).rejects.toThrow(/positive integer/);
    await expect(setEmbedIdleMinutes(-1)).rejects.toThrow(/positive integer/);
  });
});
