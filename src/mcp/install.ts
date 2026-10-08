import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { execa } from "execa";
import type { AgentKind } from "../agents/types.ts";
import { selfCommand, type SelfCommand } from "../embeddings/self-command.ts";

const CLAUDE_TIMEOUT_MS = 15_000;

export type McpInstallStatus = "registered" | "updated" | "removed" | "skipped" | "manual";

export type McpInstallResult = {
  agent: AgentKind;
  status: McpInstallStatus;
  detail: string;
};

type RunCommandResult = { exitCode: number | null; stdout: string; stderr: string };

type RunCommand = (
  file: string,
  args?: readonly string[],
  options?: { reject?: boolean; timeout?: number },
) => Promise<RunCommandResult>;

export type McpInstallDeps = {
  runCommand?: RunCommand;
  self?: SelfCommand;
  homeDir?: string;
};

function defaultRunCommand(
  file: string,
  args?: readonly string[],
  options?: { reject?: boolean; timeout?: number },
): Promise<RunCommandResult> {
  return execa(file, args ?? [], {
    reject: options?.reject ?? true,
    timeout: options?.timeout,
  }) as Promise<RunCommandResult>;
}

function resolveDeps(deps?: McpInstallDeps): Required<McpInstallDeps> {
  return {
    runCommand: deps?.runCommand ?? defaultRunCommand,
    self: deps?.self ?? selfCommand(),
    homeDir: deps?.homeDir ?? homedir(),
  };
}

function opencodeConfigDir(homeDir: string): string {
  const xdg = process.env["XDG_CONFIG_HOME"];
  if (xdg) {
    return join(xdg, "opencode");
  }
  return join(homeDir, ".config", "opencode");
}

function cursorMcpPath(homeDir: string): string {
  return join(homeDir, ".cursor", "mcp.json");
}

function cursorSnippet(self: SelfCommand): string {
  return JSON.stringify(
    {
      mcpServers: {
        shipper: {
          command: self.command,
          args: [...self.args, "mcp", "--dir", "${workspaceFolder}"],
        },
      },
    },
    null,
    2,
  );
}

function opencodeSnippet(self: SelfCommand): string {
  return JSON.stringify(
    {
      mcp: {
        shipper: {
          type: "local",
          command: [self.command, ...self.args, "mcp"],
          enabled: true,
        },
      },
    },
    null,
    2,
  );
}

function claudeAddCommand(self: SelfCommand): string {
  const parts = [
    "claude",
    "mcp",
    "add",
    "--scope",
    "user",
    "shipper",
    "--",
    self.command,
    ...self.args,
    "mcp",
  ];
  return parts.map((p) => (/\s/.test(p) ? JSON.stringify(p) : p)).join(" ");
}

function devDetail(self: SelfCommand): string | undefined {
  if (self.args.length === 0) {
    return undefined;
  }
  return "registered the dev entrypoint (bun run ...); reinstall after installing the release binary";
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

async function readOptionalFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function parseObjectJson(
  raw: string,
): { ok: true; value: Record<string, unknown> } | { ok: false } {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false };
  }
}

async function installCursor(self: SelfCommand, homeDir: string): Promise<McpInstallResult> {
  const path = cursorMcpPath(homeDir);
  const raw = await readOptionalFile(path);

  let config: Record<string, unknown>;
  if (raw === null) {
    config = {};
  } else {
    const parsed = parseObjectJson(raw);
    if (!parsed.ok) {
      return {
        agent: "cursor",
        status: "manual",
        detail: `Could not parse ${path}. Add this entry manually:\n${cursorSnippet(self)}`,
      };
    }
    config = parsed.value;
  }

  const servers =
    config["mcpServers"] !== undefined &&
    typeof config["mcpServers"] === "object" &&
    config["mcpServers"] !== null &&
    !Array.isArray(config["mcpServers"])
      ? { ...(config["mcpServers"] as Record<string, unknown>) }
      : {};

  const existed = "shipper" in servers;
  servers["shipper"] = {
    command: self.command,
    args: [...self.args, "mcp", "--dir", "${workspaceFolder}"],
  };
  config["mcpServers"] = servers;

  await writeJsonAtomic(path, config);

  const note = devDetail(self);
  return {
    agent: "cursor",
    status: existed ? "updated" : "registered",
    detail: note ?? (existed ? `updated ${path}` : `wrote ${path}`),
  };
}

async function uninstallCursor(homeDir: string): Promise<McpInstallResult> {
  const path = cursorMcpPath(homeDir);
  const raw = await readOptionalFile(path);
  if (raw === null) {
    return { agent: "cursor", status: "skipped", detail: "shipper was not registered" };
  }

  const parsed = parseObjectJson(raw);
  if (!parsed.ok) {
    return {
      agent: "cursor",
      status: "manual",
      detail: `Could not parse ${path}. Remove the shipper entry manually.`,
    };
  }
  const config = parsed.value;

  const serversRaw = config["mcpServers"];
  if (
    serversRaw === undefined ||
    typeof serversRaw !== "object" ||
    serversRaw === null ||
    Array.isArray(serversRaw) ||
    !("shipper" in (serversRaw as Record<string, unknown>))
  ) {
    return { agent: "cursor", status: "skipped", detail: "shipper was not registered" };
  }

  const servers = { ...(serversRaw as Record<string, unknown>) };
  delete servers["shipper"];
  config["mcpServers"] = servers;
  await writeJsonAtomic(path, config);
  return { agent: "cursor", status: "removed", detail: `removed shipper from ${path}` };
}

async function installOpencode(self: SelfCommand, homeDir: string): Promise<McpInstallResult> {
  const dir = opencodeConfigDir(homeDir);
  const jsonPath = join(dir, "opencode.json");
  const jsoncPath = join(dir, "opencode.jsonc");

  if (await pathExists(jsoncPath)) {
    return {
      agent: "opencode",
      status: "manual",
      detail: `Found ${jsoncPath} (JSONC). Add this entry manually:\n${opencodeSnippet(self)}`,
    };
  }

  const raw = await readOptionalFile(jsonPath);

  let config: Record<string, unknown>;
  if (raw === null) {
    config = { $schema: "https://opencode.ai/config.json" };
  } else {
    const parsed = parseObjectJson(raw);
    if (!parsed.ok) {
      return {
        agent: "opencode",
        status: "manual",
        detail: `Could not parse ${jsonPath}. Add this entry manually:\n${opencodeSnippet(self)}`,
      };
    }
    config = parsed.value;
  }

  const mcp =
    config["mcp"] !== undefined &&
    typeof config["mcp"] === "object" &&
    config["mcp"] !== null &&
    !Array.isArray(config["mcp"])
      ? { ...(config["mcp"] as Record<string, unknown>) }
      : {};

  const existed = "shipper" in mcp;
  mcp["shipper"] = {
    type: "local",
    command: [self.command, ...self.args, "mcp"],
    enabled: true,
  };
  config["mcp"] = mcp;

  await writeJsonAtomic(jsonPath, config);

  const note = devDetail(self);
  return {
    agent: "opencode",
    status: existed ? "updated" : "registered",
    detail: note ?? (existed ? `updated ${jsonPath}` : `wrote ${jsonPath}`),
  };
}

async function uninstallOpencode(homeDir: string): Promise<McpInstallResult> {
  const dir = opencodeConfigDir(homeDir);
  const jsonPath = join(dir, "opencode.json");
  const jsoncPath = join(dir, "opencode.jsonc");

  if (await pathExists(jsoncPath)) {
    return {
      agent: "opencode",
      status: "manual",
      detail: `Found ${jsoncPath} (JSONC). Remove the shipper MCP entry manually.`,
    };
  }

  const raw = await readOptionalFile(jsonPath);
  if (raw === null) {
    return { agent: "opencode", status: "skipped", detail: "shipper was not registered" };
  }

  const parsed = parseObjectJson(raw);
  if (!parsed.ok) {
    return {
      agent: "opencode",
      status: "manual",
      detail: `Could not parse ${jsonPath}. Remove the shipper entry manually.`,
    };
  }
  const config = parsed.value;

  const mcpRaw = config["mcp"];
  if (
    mcpRaw === undefined ||
    typeof mcpRaw !== "object" ||
    mcpRaw === null ||
    Array.isArray(mcpRaw) ||
    !("shipper" in (mcpRaw as Record<string, unknown>))
  ) {
    return { agent: "opencode", status: "skipped", detail: "shipper was not registered" };
  }

  const mcp = { ...(mcpRaw as Record<string, unknown>) };
  delete mcp["shipper"];
  config["mcp"] = mcp;
  await writeJsonAtomic(jsonPath, config);
  return { agent: "opencode", status: "removed", detail: `removed shipper from ${jsonPath}` };
}

async function installClaude(
  self: SelfCommand,
  runCommand: RunCommand,
): Promise<McpInstallResult> {
  await runCommand("claude", ["mcp", "remove", "shipper", "--scope", "user"], {
    reject: false,
    timeout: CLAUDE_TIMEOUT_MS,
  });

  const addArgs = [
    "mcp",
    "add",
    "--scope",
    "user",
    "shipper",
    "--",
    self.command,
    ...self.args,
    "mcp",
  ];
  const result = await runCommand("claude", addArgs, {
    reject: false,
    timeout: CLAUDE_TIMEOUT_MS,
  });

  if (result.exitCode !== 0) {
    const stderr = result.stderr.trim();
    return {
      agent: "claude",
      status: "manual",
      detail: `claude mcp add failed${stderr ? `: ${stderr}` : ""}. Run:\n${claudeAddCommand(self)}`,
    };
  }

  const note = devDetail(self);
  return {
    agent: "claude",
    status: "registered",
    detail: note ?? "registered via claude mcp add --scope user",
  };
}

async function uninstallClaude(runCommand: RunCommand): Promise<McpInstallResult> {
  const result = await runCommand("claude", ["mcp", "remove", "shipper", "--scope", "user"], {
    reject: false,
    timeout: CLAUDE_TIMEOUT_MS,
  });

  if (result.exitCode !== 0) {
    return {
      agent: "claude",
      status: "skipped",
      detail: "shipper was not registered (or claude mcp remove failed)",
    };
  }

  return {
    agent: "claude",
    status: "removed",
    detail: "removed via claude mcp remove --scope user",
  };
}

export async function installMcp(
  agents: AgentKind[],
  deps?: McpInstallDeps,
): Promise<McpInstallResult[]> {
  const resolved = resolveDeps(deps);
  const results: McpInstallResult[] = [];

  for (const agent of agents) {
    switch (agent) {
      case "claude":
        results.push(await installClaude(resolved.self, resolved.runCommand));
        break;
      case "cursor":
        results.push(await installCursor(resolved.self, resolved.homeDir));
        break;
      case "opencode":
        results.push(await installOpencode(resolved.self, resolved.homeDir));
        break;
    }
  }

  return results;
}

export type McpRegistrationState = "registered" | "outdated" | "missing" | "manual" | "unknown";

export type McpStatus = {
  agent: AgentKind;
  state: McpRegistrationState;
  detail: string;
};

const MCP_STATUS_TIMEOUT_MS = 5_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameList(actual: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((part, index) => part === expected[index])
  );
}

function cursorExpectedArgs(self: SelfCommand): string[] {
  return [...self.args, "mcp", "--dir", "${workspaceFolder}"];
}

function opencodeExpectedCommand(self: SelfCommand): string[] {
  return [self.command, ...self.args, "mcp"];
}

async function cursorMcpStatus(self: SelfCommand, homeDir: string): Promise<McpStatus> {
  const path = cursorMcpPath(homeDir);
  const raw = await readOptionalFile(path);
  if (raw === null) {
    return { agent: "cursor", state: "missing", detail: "shipper is not registered" };
  }
  const parsed = parseObjectJson(raw);
  if (!parsed.ok) {
    return {
      agent: "cursor",
      state: "manual",
      detail: `Could not parse ${path}. Fix the shipper entry manually.`,
    };
  }
  const servers = parsed.value["mcpServers"];
  if (!isRecord(servers) || !("shipper" in servers)) {
    return { agent: "cursor", state: "missing", detail: "shipper is not registered" };
  }
  const entry = servers["shipper"];
  if (
    isRecord(entry) &&
    entry["command"] === self.command &&
    sameList(entry["args"], cursorExpectedArgs(self))
  ) {
    return { agent: "cursor", state: "registered", detail: "matches the current shipper command" };
  }
  return {
    agent: "cursor",
    state: "outdated",
    detail: "does not match the current shipper command",
  };
}

async function opencodeMcpStatus(self: SelfCommand, homeDir: string): Promise<McpStatus> {
  const dir = opencodeConfigDir(homeDir);
  const jsonPath = join(dir, "opencode.json");
  const jsoncPath = join(dir, "opencode.jsonc");
  if (await pathExists(jsoncPath)) {
    return {
      agent: "opencode",
      state: "manual",
      detail: `Found ${jsoncPath} (JSONC). Update the shipper entry manually.`,
    };
  }

  const raw = await readOptionalFile(jsonPath);
  if (raw === null) {
    return { agent: "opencode", state: "missing", detail: "shipper is not registered" };
  }
  const parsed = parseObjectJson(raw);
  if (!parsed.ok) {
    return {
      agent: "opencode",
      state: "manual",
      detail: `Could not parse ${jsonPath}. Fix the shipper entry manually.`,
    };
  }
  const mcp = parsed.value["mcp"];
  if (!isRecord(mcp) || !("shipper" in mcp)) {
    return { agent: "opencode", state: "missing", detail: "shipper is not registered" };
  }
  const entry = mcp["shipper"];
  const expected = opencodeExpectedCommand(self);
  if (
    isRecord(entry) &&
    entry["type"] === "local" &&
    entry["enabled"] === true &&
    sameList(entry["command"], expected)
  ) {
    return {
      agent: "opencode",
      state: "registered",
      detail: "matches the current shipper command",
    };
  }
  return {
    agent: "opencode",
    state: "outdated",
    detail: "does not match the current shipper command",
  };
}

function claudeCommandState(
  stdout: string,
  self: SelfCommand,
): "registered" | "outdated" | "uncompared" {
  const expected = [self.command, ...self.args, "mcp"];
  const commandMatch = stdout.match(/^\s*Command:\s*(.+)$/im);
  const argsMatch = stdout.match(/^\s*Args:\s*(.*)$/im);
  if (commandMatch && argsMatch) {
    const argsText = argsMatch[1]?.trim() ?? "";
    const args = argsText === "" ? [] : argsText.split(/\s+/);
    const command = commandMatch[1]?.trim() ?? "";
    const actual = [command, ...args];
    const same =
      actual.length === expected.length && actual.every((part, index) => part === expected[index]);
    return same ? "registered" : "outdated";
  }
  if (stdout.includes(expected.join(" "))) {
    return "registered";
  }
  return "uncompared";
}

async function claudeMcpStatus(self: SelfCommand, runCommand: RunCommand): Promise<McpStatus> {
  try {
    const result = await runCommand("claude", ["mcp", "get", "shipper"], {
      reject: false,
      timeout: MCP_STATUS_TIMEOUT_MS,
    });
    if (result.exitCode === null) {
      return {
        agent: "claude",
        state: "unknown",
        detail: "could not check claude mcp status",
      };
    }
    if (result.exitCode !== 0) {
      return { agent: "claude", state: "missing", detail: "shipper is not registered" };
    }
    const compared = claudeCommandState(result.stdout, self);
    if (compared === "outdated") {
      return {
        agent: "claude",
        state: "outdated",
        detail: "does not match the current shipper command",
      };
    }
    return {
      agent: "claude",
      state: "registered",
      detail:
        compared === "registered"
          ? "matches the current shipper command"
          : "registered (command line was not compared)",
    };
  } catch {
    return { agent: "claude", state: "unknown", detail: "could not check claude mcp status" };
  }
}

export async function getMcpStatus(
  agents: AgentKind[],
  deps?: McpInstallDeps,
): Promise<McpStatus[]> {
  const resolved = resolveDeps(deps);
  const results: McpStatus[] = [];
  for (const agent of agents) {
    switch (agent) {
      case "cursor":
        results.push(await cursorMcpStatus(resolved.self, resolved.homeDir));
        break;
      case "opencode":
        results.push(await opencodeMcpStatus(resolved.self, resolved.homeDir));
        break;
      case "claude":
        results.push(await claudeMcpStatus(resolved.self, resolved.runCommand));
        break;
      default: {
        const exhaustive: never = agent;
        throw new Error(`Unknown agent: ${String(exhaustive)}`);
      }
    }
  }
  return results;
}

export async function uninstallMcp(
  agents: AgentKind[],
  deps?: McpInstallDeps,
): Promise<McpInstallResult[]> {
  const resolved = resolveDeps(deps);
  const results: McpInstallResult[] = [];

  for (const agent of agents) {
    switch (agent) {
      case "claude":
        results.push(await uninstallClaude(resolved.runCommand));
        break;
      case "cursor":
        results.push(await uninstallCursor(resolved.homeDir));
        break;
      case "opencode":
        results.push(await uninstallOpencode(resolved.homeDir));
        break;
    }
  }

  return results;
}
