import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMBEDDING_MODEL, LLAMA_CPP_BUILD } from "../constants.ts";
import {
  clearEmbedServerCache,
  ensureEmbedServer,
  isPidAlive,
  writeServerLockForTests,
} from "./server-manager.ts";
import {
  currentEmbedPlatform,
  llamaServerBinary,
  modelPath,
  serverStatePath,
} from "./paths.ts";

const DEAD_PID = 2 ** 22 + 12345;

async function seedFakeAssets(): Promise<void> {
  const binary = llamaServerBinary(currentEmbedPlatform());
  await mkdir(dirname(binary), { recursive: true });
  await writeFile(binary, "#!/bin/sh\necho fake\n");
  const model = modelPath();
  await mkdir(dirname(model), { recursive: true });
  const fh = await open(model, "w");
  await fh.truncate(EMBEDDING_MODEL.sizeBytes);
  await fh.close();
}

async function writeState(partial: {
  supervisorPid: number;
  llamaPid: number;
  port: number;
  modelId?: string;
  llamaBuild?: string;
}): Promise<void> {
  await mkdir(dirname(serverStatePath()), { recursive: true });
  await writeFile(
    serverStatePath(),
    JSON.stringify(
      {
        supervisorPid: partial.supervisorPid,
        llamaPid: partial.llamaPid,
        port: partial.port,
        modelId: partial.modelId ?? EMBEDDING_MODEL.id,
        llamaBuild: partial.llamaBuild ?? LLAMA_CPP_BUILD,
        startedAt: new Date().toISOString(),
        idleMinutes: 15,
      },
      null,
      2,
    ) + "\n",
  );
}

function startHealthServer(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr === null || typeof addr === "string") {
        reject(new Error("no port"));
        return;
      }
      resolve({ server, port: addr.port });
    });
    server.on("error", reject);
  });
}

describe("isPidAlive", () => {
  it("reports the current process as alive and a huge pid as dead", () => {
    expect(isPidAlive(process.pid)).toBe(true);
    expect(isPidAlive(DEAD_PID)).toBe(false);
  });
});

describe("ensureEmbedServer", () => {
  let previousHome: string | undefined;
  let previousXdgCache: string | undefined;
  let previousXdgConfig: string | undefined;
  let homeDir: string;
  let health: { server: Server; port: number } | null = null;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "shipper-embed-mgr-"));
    previousHome = process.env["HOME"];
    previousXdgCache = process.env["XDG_CACHE_HOME"];
    previousXdgConfig = process.env["XDG_CONFIG_HOME"];
    process.env["HOME"] = homeDir;
    process.env["XDG_CACHE_HOME"] = join(homeDir, "cache");
    delete process.env["XDG_CONFIG_HOME"];
    clearEmbedServerCache();
    await seedFakeAssets();
  });

  afterEach(async () => {
    clearEmbedServerCache();
    if (health) {
      await new Promise<void>((resolve) => health!.server.close(() => resolve()));
      health = null;
    }
    if (previousHome === undefined) {
      delete process.env["HOME"];
    } else {
      process.env["HOME"] = previousHome;
    }
    if (previousXdgCache === undefined) {
      delete process.env["XDG_CACHE_HOME"];
    } else {
      process.env["XDG_CACHE_HOME"] = previousXdgCache;
    }
    if (previousXdgConfig === undefined) {
      delete process.env["XDG_CONFIG_HOME"];
    } else {
      process.env["XDG_CONFIG_HOME"] = previousXdgConfig;
    }
    await rm(homeDir, { recursive: true, force: true });
  });

  it("reuses a healthy server without spawning", async () => {
    health = await startHealthServer();
    await writeState({
      supervisorPid: process.pid,
      llamaPid: process.pid,
      port: health.port,
    });

    let spawned = 0;
    const result = await ensureEmbedServer({
      spawnDaemon: async () => {
        spawned += 1;
      },
      fetchFn: fetch,
      idleMinutes: 15,
    });

    expect(result.baseUrl).toBe(`http://127.0.0.1:${health.port}`);
    expect(spawned).toBe(0);
  });

  it("spawns when server.json has a dead pid", async () => {
    health = await startHealthServer();
    await writeState({
      supervisorPid: DEAD_PID,
      llamaPid: DEAD_PID,
      port: health.port,
    });

    let spawned = 0;
    const result = await ensureEmbedServer({
      spawnDaemon: async () => {
        spawned += 1;
        await writeState({
          supervisorPid: process.pid,
          llamaPid: process.pid,
          port: health!.port,
        });
      },
      idleMinutes: 15,
    });

    expect(spawned).toBe(1);
    expect(result.baseUrl).toBe(`http://127.0.0.1:${health.port}`);
  });

  it("spawns when model id mismatches", async () => {
    health = await startHealthServer();
    await writeState({
      supervisorPid: process.pid,
      llamaPid: process.pid,
      port: health.port,
      modelId: "other-model",
    });

    let spawned = 0;
    const result = await ensureEmbedServer({
      spawnDaemon: async () => {
        spawned += 1;
        await writeState({
          supervisorPid: process.pid,
          llamaPid: process.pid,
          port: health!.port,
        });
      },
      idleMinutes: 15,
    });

    expect(spawned).toBe(1);
    expect(result.baseUrl).toBe(`http://127.0.0.1:${health.port}`);
  });

  it("recovers a stale lock with a dead pid", async () => {
    health = await startHealthServer();
    await writeServerLockForTests(DEAD_PID);

    let spawned = 0;
    const result = await ensureEmbedServer({
      spawnDaemon: async () => {
        spawned += 1;
        await writeState({
          supervisorPid: process.pid,
          llamaPid: process.pid,
          port: health!.port,
        });
      },
      idleMinutes: 15,
    });

    expect(spawned).toBe(1);
    expect(result.baseUrl).toBe(`http://127.0.0.1:${health.port}`);
  });

  it("spawns only once for concurrent callers", async () => {
    health = await startHealthServer();
    let spawned = 0;

    const spawnDaemon = async () => {
      spawned += 1;
      await new Promise((r) => setTimeout(r, 50));
      await writeState({
        supervisorPid: process.pid,
        llamaPid: process.pid,
        port: health!.port,
      });
    };

    const [a, b] = await Promise.all([
      ensureEmbedServer({ spawnDaemon, idleMinutes: 15 }),
      ensureEmbedServer({ spawnDaemon, idleMinutes: 15 }),
    ]);

    expect(spawned).toBe(1);
    expect(a.baseUrl).toBe(b.baseUrl);
    expect(a.baseUrl).toBe(`http://127.0.0.1:${health.port}`);
  });
});
