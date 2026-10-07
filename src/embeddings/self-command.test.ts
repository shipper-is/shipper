import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { selfCommand } from "./self-command.ts";

describe("selfCommand", () => {
  it("returns the compiled binary with no args", () => {
    expect(selfCommand({ execPath: "/usr/local/bin/shipper", argv1: "/ignored" })).toEqual({
      command: "/usr/local/bin/shipper",
      args: [],
    });
  });

  it("returns bun run <entrypoint> in dev", () => {
    const entry = "/Users/me/shipper/src/index.ts";
    expect(selfCommand({ execPath: "/opt/homebrew/bin/bun", argv1: entry })).toEqual({
      command: "/opt/homebrew/bin/bun",
      args: ["run", resolve(entry)],
    });
  });

  it("treats any basename starting with bun as the runtime", () => {
    const entry = "./src/index.ts";
    expect(selfCommand({ execPath: "/tmp/bun-debug", argv1: entry })).toEqual({
      command: "/tmp/bun-debug",
      args: ["run", resolve(entry)],
    });
  });
});
