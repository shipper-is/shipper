import { spawn } from "node:child_process";
import { access, mkdir, open as fsOpen, readFile, rm, stat, writeFile } from "node:fs/promises";
import { z } from "zod";
import {
  DEFAULT_EMBED_IDLE_MINUTES,
  EMBEDDING_MODEL,
  LLAMA_CPP_BUILD,
} from "../constants.ts";
import { getEmbedIdleMinutes } from "../core/config.ts";
import { ensureAssets, type ProgressCallback } from "./assets.ts";
import type { EmbedServerState } from "./daemon.ts";
import {
  cacheDir,
  currentEmbedPlatform,
  daemonLogPath,
  embedStateDir,
  lastUsedPath,
  llamaServerBinary,
  modelPath,
  serverLockPath,
  serverStatePath,
} from "./paths.ts";
import { selfCommand } from "./self-command.ts";

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const serverStateSchema = z.object({
  supervisorPid: z.number().int().positive(),
  llamaPid: z.number().int().positive(),
  port: z.number().int().positive(),
  modelId: z.string().min(1),
  llamaBuild: z.string().min(1),
  startedAt: z.string().min(1),
  idleMinutes: z.number().int().positive(),
});

const LOCK_STALE_MS = 120_000;
const READY_TIMEOUT_MS = 90_000;
const HEALTH_CACHE_MS = 10_000;

type CachedBaseUrl = { baseUrl: string; until: number };

let ensureInflight: Promise<{ baseUrl: string }> | null = null;
let cachedHealthy: CachedBaseUrl | null = null;

export function clearEmbedServerCache(): void {
  cachedHealthy = null;
  ensureInflight = null;
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EPERM") {
      return true;
    }
    return false;
  }
}

export async function readServerState(): Promise<EmbedServerState | null> {
  try {
    const raw = await readFile(serverStatePath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return serverStateSchema.parse(parsed);
  } catch {
    return null;
  }
}

export async function probeServer(
  state: EmbedServerState,
  fetchFn: FetchFn = fetch,
): Promise<boolean> {
  if (!isPidAlive(state.supervisorPid) || !isPidAlive(state.llamaPid)) {
    return false;
  }
  if (state.modelId !== EMBEDDING_MODEL.id || state.llamaBuild !== LLAMA_CPP_BUILD) {
    return false;
  }
  try {
    const response = await fetchFn(`http://127.0.0.1:${state.port}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!response.ok) {
      return false;
    }
    const body = (await response.json()) as { status?: string };
    return body.status === "ok";
  } catch {
    return false;
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

async function readLockPid(): Promise<number | null> {
  try {
    const raw = await readFile(serverLockPath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "pid" in parsed &&
      typeof (parsed as { pid: unknown }).pid === "number"
    ) {
      return (parsed as { pid: number }).pid;
    }
    const asNum = Number(raw.trim());
    return Number.isFinite(asNum) ? asNum : null;
  } catch {
    return null;
  }
}

async function isLockStale(): Promise<boolean> {
  try {
    const info = await stat(serverLockPath());
    if (Date.now() - info.mtimeMs > LOCK_STALE_MS) {
      return true;
    }
  } catch {
    return true;
  }
  const pid = await readLockPid();
  if (pid === null) {
    return true;
  }
  return !isPidAlive(pid);
}

async function tryAcquireLock(): Promise<boolean> {
  await mkdir(embedStateDir(), { recursive: true });
  try {
    const fh = await fsOpen(serverLockPath(), "wx");
    await fh.writeFile(JSON.stringify({ pid: process.pid }) + "\n", "utf8");
    await fh.close();
    return true;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      if (await isLockStale()) {
        await rm(serverLockPath(), { force: true });
        try {
          const fh = await fsOpen(serverLockPath(), "wx");
          await fh.writeFile(JSON.stringify({ pid: process.pid }) + "\n", "utf8");
          await fh.close();
          return true;
        } catch {
          return false;
        }
      }
      return false;
    }
    throw err;
  }
}

async function releaseLock(): Promise<void> {
  await rm(serverLockPath(), { force: true });
}

async function lastLinesOfDaemonLog(n: number): Promise<string> {
  try {
    const raw = await readFile(daemonLogPath(), "utf8");
    const lines = raw.split(/\r?\n/).filter((line) => line.length > 0);
    return lines.slice(-n).join("\n");
  } catch {
    return "";
  }
}

export type SpawnDaemon = (opts: { idleMinutes: number }) => Promise<void>;

async function defaultSpawnDaemon(opts: { idleMinutes: number }): Promise<void> {
  const self = selfCommand();
  const args = [...self.args, "embed", "daemon", "--idle-minutes", String(opts.idleMinutes)];
  await mkdir(cacheDir(), { recursive: true });
  await mkdir(embedStateDir(), { recursive: true });
  const logFh = await fsOpen(daemonLogPath(), "a");
  try {
    const child = spawn(self.command, args, {
      detached: true,
      stdio: ["ignore", logFh.fd, logFh.fd],
      cwd: cacheDir(),
      env: process.env,
    });
    child.unref();
  } finally {
    await logFh.close();
  }
}

async function waitUntilReady(fetchFn: FetchFn, timeoutMs: number): Promise<EmbedServerState> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await readServerState();
    if (state && (await probeServer(state, fetchFn))) {
      return state;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  const tail = await lastLinesOfDaemonLog(20);
  const detail = tail ? `\nLast daemon.log lines:\n${tail}` : "";
  throw new Error(`Embedding server failed to become ready within ${timeoutMs / 1000}s.${detail}`);
}

async function ensureEmbedServerOnce(opts: {
  fetchFn: FetchFn;
  onProgress?: ProgressCallback;
  spawnDaemon: SpawnDaemon;
  idleMinutes: number;
}): Promise<{ baseUrl: string }> {
  const { fetchFn, onProgress, spawnDaemon, idleMinutes } = opts;

  if (cachedHealthy && Date.now() < cachedHealthy.until) {
    return { baseUrl: cachedHealthy.baseUrl };
  }

  const existing = await readServerState();
  if (existing && (await probeServer(existing, fetchFn))) {
    const baseUrl = `http://127.0.0.1:${existing.port}`;
    cachedHealthy = { baseUrl, until: Date.now() + HEALTH_CACHE_MS };
    return { baseUrl };
  }

  const acquired = await tryAcquireLock();
  if (!acquired) {
    const state = await waitUntilReady(fetchFn, READY_TIMEOUT_MS);
    const baseUrl = `http://127.0.0.1:${state.port}`;
    cachedHealthy = { baseUrl, until: Date.now() + HEALTH_CACHE_MS };
    return { baseUrl };
  }

  try {
    const again = await readServerState();
    if (again && (await probeServer(again, fetchFn))) {
      const baseUrl = `http://127.0.0.1:${again.port}`;
      cachedHealthy = { baseUrl, until: Date.now() + HEALTH_CACHE_MS };
      return { baseUrl };
    }

    if (again) {
      await rm(serverStatePath(), { force: true });
    }

    await ensureAssets({ fetchFn, onProgress });
    await spawnDaemon({ idleMinutes });
    const state = await waitUntilReady(fetchFn, READY_TIMEOUT_MS);
    const baseUrl = `http://127.0.0.1:${state.port}`;
    cachedHealthy = { baseUrl, until: Date.now() + HEALTH_CACHE_MS };
    return { baseUrl };
  } finally {
    await releaseLock();
  }
}

export async function ensureEmbedServer(opts?: {
  fetchFn?: FetchFn;
  onProgress?: ProgressCallback;
  spawnDaemon?: SpawnDaemon;
  idleMinutes?: number;
}): Promise<{ baseUrl: string }> {
  const fetchFn = opts?.fetchFn ?? fetch;
  const onProgress = opts?.onProgress;
  const spawnDaemon = opts?.spawnDaemon ?? defaultSpawnDaemon;
  const idleMinutes = opts?.idleMinutes ?? (await getEmbedIdleMinutes());

  if (ensureInflight) {
    return ensureInflight;
  }

  ensureInflight = ensureEmbedServerOnce({
    fetchFn,
    onProgress,
    spawnDaemon,
    idleMinutes,
  }).finally(() => {
    ensureInflight = null;
  });

  return ensureInflight;
}

export async function stopEmbedServer(): Promise<{ wasRunning: boolean }> {
  cachedHealthy = null;
  const state = await readServerState();
  if (!state) {
    return { wasRunning: false };
  }

  if (isPidAlive(state.supervisorPid)) {
    try {
      process.kill(state.supervisorPid, "SIGTERM");
    } catch {
      // may already be gone
    }
  }

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const still = await readServerState();
    if (!still) {
      return { wasRunning: true };
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  await rm(serverStatePath(), { force: true });
  if (isPidAlive(state.llamaPid)) {
    try {
      process.kill(state.llamaPid, "SIGKILL");
    } catch {
      // ignore
    }
  }
  if (isPidAlive(state.supervisorPid)) {
    try {
      process.kill(state.supervisorPid, "SIGKILL");
    } catch {
      // ignore
    }
  }
  return { wasRunning: true };
}

export type EmbedServerStatus = {
  running: boolean;
  port: number | null;
  pid: number | null;
  modelId: string | null;
  llamaBuild: string | null;
  startedAt: string | null;
  idleMinutes: number;
  lastUsedAt: string | null;
  assets: { serverBinary: boolean; model: boolean };
  cacheDir: string;
};

export async function getEmbedServerStatus(fetchFn: FetchFn = fetch): Promise<EmbedServerStatus> {
  const platform = currentEmbedPlatform();
  const assets = {
    serverBinary: await pathExists(llamaServerBinary(platform)),
    model: await pathExists(modelPath()),
  };

  let lastUsedAt: string | null = null;
  try {
    const info = await stat(lastUsedPath());
    lastUsedAt = new Date(info.mtimeMs).toISOString();
  } catch {
    // no last-used file yet
  }

  const configuredIdle = await getEmbedIdleMinutes().catch(() => DEFAULT_EMBED_IDLE_MINUTES);
  const state = await readServerState();
  if (!state) {
    return {
      running: false,
      port: null,
      pid: null,
      modelId: null,
      llamaBuild: null,
      startedAt: null,
      idleMinutes: configuredIdle,
      lastUsedAt,
      assets,
      cacheDir: cacheDir(),
    };
  }

  const running = await probeServer(state, fetchFn);
  return {
    running,
    port: state.port,
    pid: state.supervisorPid,
    modelId: state.modelId,
    llamaBuild: state.llamaBuild,
    startedAt: state.startedAt,
    idleMinutes: state.idleMinutes,
    lastUsedAt,
    assets,
    cacheDir: cacheDir(),
  };
}

/** Test helper: write a lock file with a given pid. */
export async function writeServerLockForTests(pid: number): Promise<void> {
  await mkdir(embedStateDir(), { recursive: true });
  await writeFile(serverLockPath(), JSON.stringify({ pid }) + "\n", "utf8");
}
