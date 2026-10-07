import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname } from "node:path";
import {
  DEFAULT_EMBED_IDLE_MINUTES,
  EMBEDDING_MODEL,
  LLAMA_CPP_BUILD,
} from "../constants.ts";
import {
  currentEmbedPlatform,
  daemonLogPath,
  embedStateDir,
  lastUsedPath,
  llamaServerBinary,
  modelPath,
  serverStatePath,
} from "./paths.ts";

export type EmbedServerState = {
  supervisorPid: number;
  llamaPid: number;
  port: number;
  modelId: string;
  llamaBuild: string;
  startedAt: string;
  idleMinutes: number;
};

export function shouldShutDown(lastUsedMs: number, nowMs: number, idleMinutes: number): boolean {
  return nowMs - lastUsedMs > idleMinutes * 60_000;
}

async function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr === null || typeof addr === "string") {
        server.close();
        reject(new Error("Failed to allocate a free port"));
        return;
      }
      const port = addr.port;
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}

async function writeServerState(state: EmbedServerState): Promise<void> {
  const path = serverStatePath();
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(state, null, 2) + "\n", "utf8");
  await rename(tmp, path);
}

async function touchLastUsed(): Promise<void> {
  const path = lastUsedPath();
  await mkdir(dirname(path), { recursive: true });
  const now = new Date();
  try {
    await utimes(path, now, now);
  } catch {
    await writeFile(path, "", "utf8");
    await utimes(path, now, now);
  }
}

async function lastUsedMtimeMs(): Promise<number> {
  try {
    const info = await stat(lastUsedPath());
    return info.mtimeMs;
  } catch {
    return Date.now();
  }
}

function appendLog(stream: WriteStream, line: string): void {
  stream.write(`[${new Date().toISOString()}] ${line}\n`);
}

async function waitForHealth(port: number, child: ChildProcess, log: WriteStream): Promise<void> {
  const url = `http://127.0.0.1:${port}/health`;
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`llama-server exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        const body = (await response.json()) as { status?: string };
        if (body.status === "ok") {
          return;
        }
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  appendLog(log, `Health check timed out after 60s for ${url}`);
  throw new Error(`llama-server health check timed out on port ${port}`);
}

async function shutdownChild(child: ChildProcess, log: WriteStream): Promise<void> {
  if (child.exitCode !== null || child.killed) {
    return;
  }
  appendLog(log, `Sending SIGTERM to llama-server pid ${child.pid}`);
  try {
    child.kill("SIGTERM");
  } catch {
    return;
  }

  const exited = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });

  if (!exited && child.exitCode === null) {
    appendLog(log, `Sending SIGKILL to llama-server pid ${child.pid}`);
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  }
}

async function removeStateFile(): Promise<void> {
  await rm(serverStatePath(), { force: true });
}

export async function runEmbedDaemon(opts?: {
  idleMinutes?: number;
  now?: () => number;
}): Promise<void> {
  const idleMinutes = opts?.idleMinutes ?? DEFAULT_EMBED_IDLE_MINUTES;
  const now = opts?.now ?? Date.now;

  await mkdir(embedStateDir(), { recursive: true });
  const logPath = daemonLogPath();
  // Truncate previous log for this start.
  await writeFile(logPath, "", "utf8");
  const log = createWriteStream(logPath, { flags: "a" });

  const platform = currentEmbedPlatform();
  const serverBinary = llamaServerBinary(platform);
  const model = modelPath();
  const port = await pickFreePort();

  appendLog(log, `Starting llama-server on 127.0.0.1:${port}`);
  appendLog(log, `Binary: ${serverBinary}`);
  appendLog(log, `Model: ${model}`);
  appendLog(log, `Idle shutdown: ${idleMinutes} min`);

  const env = { ...process.env };
  if (process.platform === "linux") {
    const libDir = dirname(serverBinary);
    const existing = env["LD_LIBRARY_PATH"];
    env["LD_LIBRARY_PATH"] = existing ? `${libDir}:${existing}` : libDir;
  }

  const child = spawn(
    serverBinary,
    [
      "-m",
      model,
      "--embedding",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--ctx-size",
      "4096",
      "--parallel",
      "2",
      "--batch-size",
      "2048",
      "--ubatch-size",
      "2048",
      "--no-webui",
    ],
    {
      env,
      cwd: embedStateDir(),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  child.stdout?.on("data", (chunk: Buffer) => {
    log.write(chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    log.write(chunk);
  });

  let shuttingDown = false;

  const cleanupAndExit = async (code: number, reason: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    appendLog(log, reason);
    await shutdownChild(child, log);
    await removeStateFile();
    log.end();
    process.exit(code);
  };

  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }
    void cleanupAndExit(1, `llama-server exited unexpectedly (code=${code}, signal=${signal})`);
  });

  process.on("SIGTERM", () => {
    void cleanupAndExit(0, "Received SIGTERM");
  });
  process.on("SIGINT", () => {
    void cleanupAndExit(0, "Received SIGINT");
  });

  try {
    await waitForHealth(port, child, log);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    appendLog(log, `Startup failed: ${message}`);
    await shutdownChild(child, log);
    await removeStateFile();
    log.end();
    process.exit(1);
    return;
  }

  if (child.pid === undefined) {
    appendLog(log, "llama-server spawn returned no pid");
    await removeStateFile();
    log.end();
    process.exit(1);
    return;
  }

  const state: EmbedServerState = {
    supervisorPid: process.pid,
    llamaPid: child.pid,
    port,
    modelId: EMBEDDING_MODEL.id,
    llamaBuild: LLAMA_CPP_BUILD,
    startedAt: new Date().toISOString(),
    idleMinutes,
  };
  await writeServerState(state);
  await touchLastUsed();
  appendLog(log, `Ready on http://127.0.0.1:${port}`);

  const idleTimer = setInterval(() => {
    void (async () => {
      if (shuttingDown) {
        return;
      }
      const lastUsed = await lastUsedMtimeMs();
      if (shouldShutDown(lastUsed, now(), idleMinutes)) {
        clearInterval(idleTimer);
        await cleanupAndExit(0, `Idle for more than ${idleMinutes} minutes; shutting down`);
      }
    })();
  }, 30_000);
  idleTimer.unref?.();

  // Keep the process alive until shutdown.
  await new Promise<void>(() => {
    // never resolves; exit via signal / idle / child exit
  });
}
