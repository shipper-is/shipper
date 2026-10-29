import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { access, mkdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { execa } from "execa";
import { downloadVerified, ensureLlamaBinary, formatProgress } from "../embeddings/assets.ts";
import { pickFreePort } from "../embeddings/daemon.ts";
import { cacheDir, currentEmbedPlatform } from "../embeddings/paths.ts";
import { D3_LLAMA_CPP_ASSETS, D3_LLAMA_CPP_BUILD, D3_MODELS, type D3Quant } from "./constants.ts";

export type D3Server = {
  baseUrl: string;
  modelId: string;
  logPath: string;
  stop(): Promise<void>;
};

type Status = (line: string) => void;

export function codeIndexDir(): string {
  return join(cacheDir(), "code-index");
}

export function d3ModelPath(quant: D3Quant): string {
  return join(cacheDir(), "models", D3_MODELS[quant].file);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function progressReporter(label: string, onStatus: Status | undefined) {
  let lastPct = -1;
  return (received: number, total: number | null) => {
    const pct = total ? Math.floor((received / total) * 100) : -1;
    if (pct !== lastPct && (pct % 5 === 0 || pct === -1)) {
      lastPct = pct;
      onStatus?.(formatProgress(label, received, total));
    }
  };
}

async function ensureD3Model(quant: D3Quant, onStatus?: Status): Promise<string> {
  const asset = D3_MODELS[quant];
  const dest = d3ModelPath(quant);
  if (await pathExists(dest)) {
    if ((await stat(dest)).size === asset.sizeBytes) {
      return dest;
    }
    await rm(dest, { force: true });
  }
  onStatus?.(`Downloading ${asset.file} (${(asset.sizeBytes / 1e9).toFixed(1)} GB, one time)`);
  await downloadVerified({
    url: asset.url,
    dest,
    sha256: asset.sha256,
    onProgress: progressReporter(asset.file, onStatus),
  });
  return dest;
}

async function waitForHealth(port: number, child: ChildProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`llama-server exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok && ((await response.json()) as { status?: string }).status === "ok") {
        return;
      }
    } catch {
      // still loading
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`d3 server did not become healthy within ${timeoutMs / 1000}s`);
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  const exited = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
  if (!exited) {
    child.kill("SIGKILL");
  }
}

/**
 * Download (once) and launch a private llama-server for the d3 decision model. It lives only for
 * the indexing run; call `stop()` when done.
 */
export async function startD3Server(opts: {
  quant: D3Quant;
  parallel: number;
  ubatchTokens: number;
  onStatus?: Status;
}): Promise<D3Server> {
  const { quant, parallel, ubatchTokens, onStatus } = opts;
  const platform = currentEmbedPlatform();
  const serverBinary = await ensureLlamaBinary({
    platform,
    fetchFn: fetch,
    onProgress: progressReporter(`llama.cpp ${D3_LLAMA_CPP_BUILD}`, onStatus),
    runCommand: execa,
    build: D3_LLAMA_CPP_BUILD,
    assets: D3_LLAMA_CPP_ASSETS,
  });
  const model = await ensureD3Model(quant, onStatus);
  const port = await pickFreePort();

  await mkdir(codeIndexDir(), { recursive: true });
  const logPath = join(codeIndexDir(), "d3-server.log");
  const log: WriteStream = createWriteStream(logPath, { flags: "w" });

  const env = { ...process.env };
  if (process.platform === "linux") {
    const libDir = dirname(serverBinary);
    env["LD_LIBRARY_PATH"] = env["LD_LIBRARY_PATH"] ? `${libDir}:${env["LD_LIBRARY_PATH"]}` : libDir;
  }

  onStatus?.(`Starting d3 (${D3_MODELS[quant].id}) on llama.cpp ${D3_LLAMA_CPP_BUILD}`);
  const child = spawn(
    serverBinary,
    [
      "-m",
      model,
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--parallel",
      String(parallel),
      "--ctx-size",
      String(ubatchTokens * parallel),
      "--batch-size",
      String(ubatchTokens),
      "--ubatch-size",
      String(ubatchTokens),
      "--no-webui",
    ],
    { env, cwd: codeIndexDir(), stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);

  const killOnExit = () => {
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
  };
  process.once("exit", killOnExit);

  try {
    await waitForHealth(port, child, 180_000);
  } catch (err) {
    await stopChild(child);
    process.removeListener("exit", killOnExit);
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${message}. See ${logPath}`, { cause: err });
  }

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    modelId: D3_MODELS[quant].id,
    logPath,
    async stop() {
      await stopChild(child);
      process.removeListener("exit", killOnExit);
      log.end();
    },
  };
}
