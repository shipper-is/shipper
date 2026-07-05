import { execa } from "execa";
import type { AgentKind, DetectedAgent } from "./types.ts";

const PROBE_TIMEOUT_MS = 3_000;

let cached: DetectedAgent[] | null = null;

async function probe(
  binary: string,
  args: string[],
  validate?: (output: string) => boolean,
): Promise<{ binary: string; version: string } | null> {
  try {
    const result = await execa(binary, args, {
      timeout: PROBE_TIMEOUT_MS,
      reject: false,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) {
      return null;
    }
    const output = `${result.stdout}\n${result.stderr}`.trim();
    if (!output) {
      return null;
    }
    if (validate && !validate(output)) {
      return null;
    }
    return { binary, version: output.split("\n")[0]!.trim() };
  } catch {
    return null;
  }
}

async function probeCursorAgent(): Promise<{ binary: string; version: string } | null> {
  const cursorAgent = await probe("cursor-agent", ["--version"]);
  if (cursorAgent) {
    return cursorAgent;
  }

  return probe("agent", ["--version"], (output) => /cursor/i.test(output));
}

export async function detectAgents(): Promise<DetectedAgent[]> {
  if (cached) {
    return cached;
  }

  const detected: DetectedAgent[] = [];

  const probes: Array<Promise<{ kind: AgentKind; result: { binary: string; version: string } | null }>> =
    [
      probe("claude", ["--version"]).then((result) => ({ kind: "claude" as const, result })),
      probeCursorAgent().then((result) => ({ kind: "cursor" as const, result })),
      probe("opencode", ["--version"]).then((result) => ({ kind: "opencode" as const, result })),
    ];

  const results = await Promise.all(probes);
  for (const { kind, result } of results) {
    if (result) {
      detected.push({ kind, binary: result.binary, version: result.version });
    }
  }

  cached = detected;
  return detected;
}

export function clearAgentDetectionCache(): void {
  cached = null;
}
