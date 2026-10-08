import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getMcpStatus, installMcp, uninstallMcp } from "./install.ts";

describe("installMcp / uninstallMcp", () => {
  let previousHome: string | undefined;
  let previousXdg: string | undefined;
  let homeDir: string;

  const self = { command: "/usr/local/bin/shipper", args: [] as string[] };
  const selfDev = {
    command: "/opt/homebrew/bin/bun",
    args: ["run", "/repo/src/index.ts"],
  };

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "shipper-mcp-install-"));
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

  it("adds shipper to an existing Cursor mcp.json and keeps other servers", async () => {
    const cursorDir = join(homeDir, ".cursor");
    await mkdir(cursorDir, { recursive: true });
    const path = join(cursorDir, "mcp.json");
    await writeFile(
      path,
      JSON.stringify(
        {
          mcpServers: {
            other: { command: "other-bin", args: ["serve"] },
          },
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const [first] = await installMcp(["cursor"], { self, homeDir });
    expect(first?.status).toBe("registered");

    const parsed = JSON.parse(await readFile(path, "utf8")) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    expect(parsed.mcpServers["other"]).toEqual({ command: "other-bin", args: ["serve"] });
    expect(parsed.mcpServers["shipper"]).toEqual({
      command: "/usr/local/bin/shipper",
      args: ["mcp", "--dir", "${workspaceFolder}"],
    });

    const [second] = await installMcp(["cursor"], { self, homeDir });
    expect(second?.status).toBe("updated");
  });

  it("leaves invalid Cursor mcp.json byte-for-byte and returns manual", async () => {
    const cursorDir = join(homeDir, ".cursor");
    await mkdir(cursorDir, { recursive: true });
    const path = join(cursorDir, "mcp.json");
    const bad = "{ not json\n";
    await writeFile(path, bad, "utf8");

    const [result] = await installMcp(["cursor"], { self, homeDir });
    expect(result?.status).toBe("manual");
    expect(result?.detail).toContain("Add this entry manually");
    expect(await readFile(path, "utf8")).toBe(bad);
  });

  it("returns manual when opencode.jsonc is present", async () => {
    const dir = join(homeDir, ".config", "opencode");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "opencode.jsonc"), '{ // comment\n}\n', "utf8");

    const [result] = await installMcp(["opencode"], { self, homeDir });
    expect(result?.status).toBe("manual");
    expect(result?.detail).toContain("opencode.jsonc");
    expect(result?.detail).toContain("Add this entry manually");
  });

  it("creates opencode.json with schema and shipper entry", async () => {
    const [result] = await installMcp(["opencode"], { self, homeDir });
    expect(result?.status).toBe("registered");

    const path = join(homeDir, ".config", "opencode", "opencode.json");
    const parsed = JSON.parse(await readFile(path, "utf8")) as {
      $schema: string;
      mcp: { shipper: { type: string; command: string[]; enabled: boolean } };
    };
    expect(parsed.$schema).toBe("https://opencode.ai/config.json");
    expect(parsed.mcp.shipper).toEqual({
      type: "local",
      command: ["/usr/local/bin/shipper", "mcp"],
      enabled: true,
    });
  });

  it("passes the exact argv to claude mcp add via runCommand", async () => {
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    const runCommand = async (file: string, args: readonly string[] = []) => {
      calls.push({ file, args });
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    const [result] = await installMcp(["claude"], { self, homeDir, runCommand });
    expect(result?.status).toBe("registered");
    expect(calls).toEqual([
      { file: "claude", args: ["mcp", "remove", "shipper", "--scope", "user"] },
      {
        file: "claude",
        args: ["mcp", "add", "--scope", "user", "shipper", "--", "/usr/local/bin/shipper", "mcp"],
      },
    ]);
  });

  it("includes the dev entrypoint note when self.args is non-empty", async () => {
    const [result] = await installMcp(["cursor"], { self: selfDev, homeDir });
    expect(result?.status).toBe("registered");
    expect(result?.detail).toContain("dev entrypoint");
  });

  it("uninstall removes only the shipper entry", async () => {
    const cursorDir = join(homeDir, ".cursor");
    await mkdir(cursorDir, { recursive: true });
    const cursorPath = join(cursorDir, "mcp.json");
    await writeFile(
      cursorPath,
      JSON.stringify(
        {
          mcpServers: {
            other: { command: "other-bin", args: [] },
            shipper: { command: "shipper", args: ["mcp"] },
          },
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const opencodeDir = join(homeDir, ".config", "opencode");
    await mkdir(opencodeDir, { recursive: true });
    const opencodePath = join(opencodeDir, "opencode.json");
    await writeFile(
      opencodePath,
      JSON.stringify(
        {
          $schema: "https://opencode.ai/config.json",
          mcp: {
            other: { type: "local", command: ["other"], enabled: true },
            shipper: { type: "local", command: ["shipper", "mcp"], enabled: true },
          },
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const claudeCalls: Array<{ file: string; args: readonly string[] }> = [];
    const runCommand = async (file: string, args: readonly string[] = []) => {
      claudeCalls.push({ file, args });
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    const results = await uninstallMcp(["cursor", "opencode", "claude"], {
      homeDir,
      runCommand,
    });

    expect(results.map((r) => r.status)).toEqual(["removed", "removed", "removed"]);

    const cursor = JSON.parse(await readFile(cursorPath, "utf8")) as {
      mcpServers: Record<string, unknown>;
    };
    expect(cursor.mcpServers["other"]).toBeDefined();
    expect(cursor.mcpServers["shipper"]).toBeUndefined();

    const opencode = JSON.parse(await readFile(opencodePath, "utf8")) as {
      mcp: Record<string, unknown>;
    };
    expect(opencode.mcp["other"]).toBeDefined();
    expect(opencode.mcp["shipper"]).toBeUndefined();

    expect(claudeCalls).toEqual([
      { file: "claude", args: ["mcp", "remove", "shipper", "--scope", "user"] },
    ]);
  });

  it("returns manual when claude mcp add fails", async () => {
    const runCommand = async (_file: string, args: readonly string[] = []) => {
      if (args[1] === "add") {
        return { exitCode: 1, stdout: "", stderr: "not found" };
      }
      return { exitCode: 1, stdout: "", stderr: "" };
    };

    const [result] = await installMcp(["claude"], { self, homeDir, runCommand });
    expect(result?.status).toBe("manual");
    expect(result?.detail).toContain("claude mcp add --scope user shipper --");
  });
});

describe("getMcpStatus", () => {
  let previousHome: string | undefined;
  let previousXdg: string | undefined;
  let homeDir: string;
  const self = { command: "/usr/local/bin/shipper", args: [] as string[] };

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "shipper-mcp-status-"));
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

  it("reports cursor as missing, registered, outdated, or manual", async () => {
    const path = join(homeDir, ".cursor", "mcp.json");
    const deps = { self, homeDir };

    expect(await getMcpStatus(["cursor"], deps)).toEqual([
      { agent: "cursor", state: "missing", detail: "shipper is not registered" },
    ]);

    await mkdir(join(homeDir, ".cursor"), { recursive: true });
    await writeFile(
      path,
      JSON.stringify({
        mcpServers: {
          shipper: {
            command: self.command,
            args: ["mcp", "--dir", "${workspaceFolder}"],
          },
        },
      }),
      "utf8",
    );
    expect((await getMcpStatus(["cursor"], deps))[0]?.state).toBe("registered");

    await writeFile(
      path,
      JSON.stringify({
        mcpServers: { shipper: { command: "other", args: ["mcp"] } },
      }),
      "utf8",
    );
    expect((await getMcpStatus(["cursor"], deps))[0]?.state).toBe("outdated");

    await writeFile(path, "{", "utf8");
    const manual = (await getMcpStatus(["cursor"], deps))[0];
    expect(manual?.state).toBe("manual");
    expect(manual?.detail).toContain(path);
  });

  it("reports opencode manual when only jsonc exists, otherwise matches the command", async () => {
    const dir = join(homeDir, ".config", "opencode");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "opencode.jsonc"), "{}\n", "utf8");
    const manual = (await getMcpStatus(["opencode"], { self, homeDir }))[0];
    expect(manual?.state).toBe("manual");
    expect(manual?.detail).toContain("opencode.jsonc");

    await rm(join(dir, "opencode.jsonc"));
    await writeFile(
      join(dir, "opencode.json"),
      JSON.stringify({
        mcp: {
          shipper: {
            type: "local",
            command: [self.command, "mcp"],
            enabled: true,
          },
        },
      }),
      "utf8",
    );
    expect((await getMcpStatus(["opencode"], { self, homeDir }))[0]?.state).toBe("registered");

    await writeFile(
      join(dir, "opencode.json"),
      JSON.stringify({
        mcp: { shipper: { type: "local", command: ["other", "mcp"], enabled: true } },
      }),
      "utf8",
    );
    expect((await getMcpStatus(["opencode"], { self, homeDir }))[0]?.state).toBe("outdated");
  });

  it("classifies claude from mcp get, and treats failures as missing or unknown", async () => {
    const registered = await getMcpStatus(["claude"], {
      self,
      homeDir,
      runCommand: async () => ({
        exitCode: 0,
        stdout: "Command: /usr/local/bin/shipper\nArgs: mcp\n",
        stderr: "",
      }),
    });
    expect(registered[0]?.state).toBe("registered");

    const outdated = await getMcpStatus(["claude"], {
      self,
      homeDir,
      runCommand: async () => ({
        exitCode: 0,
        stdout: "Command: /other/bin/shipper\nArgs: mcp\n",
        stderr: "",
      }),
    });
    expect(outdated[0]?.state).toBe("outdated");

    const uncompared = await getMcpStatus(["claude"], {
      self,
      homeDir,
      runCommand: async () => ({ exitCode: 0, stdout: "shipper is connected\n", stderr: "" }),
    });
    expect(uncompared[0]?.state).toBe("registered");
    expect(uncompared[0]?.detail).toContain("not compared");

    const missing = await getMcpStatus(["claude"], {
      self,
      homeDir,
      runCommand: async () => ({ exitCode: 1, stdout: "", stderr: "not found" }),
    });
    expect(missing[0]?.state).toBe("missing");

    const unknown = await getMcpStatus(["claude"], {
      self,
      homeDir,
      runCommand: async () => {
        throw new Error("timed out");
      },
    });
    expect(unknown[0]?.state).toBe("unknown");
  });
});
