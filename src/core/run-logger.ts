import { appendFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent, AgentKind } from "../agents/types.ts";
import { configDir } from "./config.ts";

const MAX_LOG_FILES = 20;

export function logsDir(): string {
  return join(configDir(), "logs");
}

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export class RunLogger {
  readonly path: string;
  private closed = false;

  private constructor(path: string) {
    this.path = path;
  }

  static async create(agent: AgentKind): Promise<RunLogger> {
    const dir = logsDir();
    await mkdir(dir, { recursive: true });
    const filename = `${timestampSlug()}-${agent}.ndjson`;
    const path = join(dir, filename);
    await appendFile(
      path,
      JSON.stringify({ type: "session-start", agent, at: new Date().toISOString() }) + "\n",
      "utf8",
    );
    await pruneOldLogs(dir);
    return new RunLogger(path);
  }

  async logEvent(event: AgentEvent): Promise<void> {
    await this.write({ kind: "event", event });
  }

  async logRaw(direction: "in" | "out", payload: string): Promise<void> {
    await this.write({ type: "raw", direction, payload });
  }

  async logMeta(meta: Record<string, unknown>): Promise<void> {
    await this.write({ type: "meta", ...meta });
  }

  async close(outcome?: { ok: boolean; error?: string }): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.write({
      type: "session-end",
      at: new Date().toISOString(),
      ...outcome,
    });
  }

  private async write(record: Record<string, unknown>): Promise<void> {
    try {
      await appendFile(this.path, JSON.stringify(record) + "\n", "utf8");
    } catch {
      // Never crash the TUI because logging failed.
    }
  }
}

async function pruneOldLogs(dir: string): Promise<void> {
  try {
    const entries = await readdir(dir);
    const files = await Promise.all(
      entries
        .filter((name) => name.endsWith(".ndjson"))
        .map(async (name) => {
          const path = join(dir, name);
          const info = await stat(path);
          return { path, mtime: info.mtimeMs };
        }),
    );
    files.sort((a, b) => b.mtime - a.mtime);
    for (const file of files.slice(MAX_LOG_FILES)) {
      await unlink(file.path).catch(() => undefined);
    }
  } catch {
    // ignore prune failures
  }
}
