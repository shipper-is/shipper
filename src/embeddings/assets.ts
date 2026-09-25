import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, chmod, mkdir, mkdtemp, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execa } from "execa";
import {
  EMBEDDING_MODEL,
  LLAMA_CPP_ASSETS,
  LLAMA_CPP_BUILD,
  llamaCppAssetUrl,
  type EmbedPlatform,
} from "../constants.ts";
import {
  cacheDir,
  currentEmbedPlatform,
  llamaInstallDir,
  llamaServerBinary,
  modelPath as cachedModelPath,
} from "./paths.ts";

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type RunCommand = typeof execa;

export type ProgressCallback = (receivedBytes: number, totalBytes: number | null) => void;

let ensureAssetsInflight: Promise<{ serverBinary: string; modelPath: string }> | null = null;

export function formatProgress(label: string, received: number, total: number | null): string {
  const receivedMb = (received / (1024 * 1024)).toFixed(1);
  if (total === null || total <= 0) {
    return `Downloading ${label} (${receivedMb} MB)`;
  }
  const pct = Math.min(100, Math.round((received / total) * 100));
  const totalMb = (total / (1024 * 1024)).toFixed(1);
  return `Downloading ${label} ${pct}% (${receivedMb} / ${totalMb} MB)`;
}

export async function downloadVerified(opts: {
  url: string;
  dest: string;
  sha256: string;
  fetchFn?: FetchFn;
  onProgress?: ProgressCallback;
}): Promise<void> {
  const { url, dest, sha256, fetchFn = fetch, onProgress } = opts;
  const partial = `${dest}.partial`;

  await mkdir(dirname(dest), { recursive: true });

  const response = await fetchFn(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText} for ${url}`);
  }
  if (!response.body) {
    throw new Error(`Download failed: empty body for ${url}`);
  }

  const totalHeader = response.headers.get("content-length");
  const parsedTotal = totalHeader ? Number(totalHeader) : NaN;
  const totalBytes = Number.isFinite(parsedTotal) ? parsedTotal : null;
  const hash = createHash("sha256");
  let received = 0;

  const nodeStream = Readable.fromWeb(response.body as unknown as import("node:stream/web").ReadableStream);
  const hasher = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hash.update(chunk);
      received += chunk.length;
      onProgress?.(received, totalBytes);
      cb(null, chunk);
    },
  });
  const fileStream = createWriteStream(partial);

  try {
    await pipeline(nodeStream, hasher, fileStream);
  } catch (err) {
    await rm(partial, { force: true }).catch(() => undefined);
    throw err;
  }

  const digest = hash.digest("hex");
  if (digest !== sha256) {
    await rm(partial, { force: true });
    throw new Error(`Checksum mismatch for ${url}`);
  }

  await rename(partial, dest);
}

export async function extractTarball(
  archive: string,
  targetDir: string,
  runCommand: RunCommand = execa,
): Promise<void> {
  await mkdir(dirname(targetDir), { recursive: true });
  const tmp = await mkdtemp(`${targetDir}.extract-`);

  try {
    const result = await runCommand("tar", ["-xzf", archive, "-C", tmp], {
      reject: false,
      timeout: 120_000,
    });
    if (result.exitCode !== 0) {
      const detail = `${result.stderr || result.stdout || ""}`.trim();
      throw new Error(
        `Failed to extract ${archive}${detail ? `: ${detail}` : ` (exit ${result.exitCode})`}`,
      );
    }

    const serverRel = join(`llama-${LLAMA_CPP_BUILD}`, "llama-server");
    const serverAbs = join(tmp, serverRel);
    try {
      await access(serverAbs);
    } catch {
      throw new Error(`Extracted archive is missing ${serverRel}`);
    }

    await chmod(serverAbs, 0o755);
    await rm(targetDir, { force: true, recursive: true });
    await rename(tmp, targetDir);
    await chmod(join(targetDir, serverRel), 0o755);
  } catch (err) {
    await rm(tmp, { force: true, recursive: true }).catch(() => undefined);
    throw err;
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

async function ensureLlamaBinary(opts: {
  platform: EmbedPlatform;
  fetchFn: FetchFn;
  onProgress?: ProgressCallback;
  runCommand: RunCommand;
}): Promise<string> {
  const { platform, fetchFn, onProgress, runCommand } = opts;
  const serverBinary = llamaServerBinary(platform);
  if (await pathExists(serverBinary)) {
    return serverBinary;
  }

  const { asset, sha256 } = LLAMA_CPP_ASSETS[platform];
  const url = llamaCppAssetUrl(asset);
  const archiveDir = join(cacheDir(), "llama");
  await mkdir(archiveDir, { recursive: true });
  const archivePath = join(archiveDir, asset);

  if (!(await pathExists(archivePath))) {
    await downloadVerified({
      url,
      dest: archivePath,
      sha256,
      fetchFn,
      onProgress,
    });
  }

  const installDir = llamaInstallDir(platform);
  await extractTarball(archivePath, installDir, runCommand);
  await rm(archivePath, { force: true });

  if (!(await pathExists(serverBinary))) {
    throw new Error(`llama-server missing after extraction at ${serverBinary}`);
  }
  return serverBinary;
}

async function ensureModel(opts: {
  fetchFn: FetchFn;
  onProgress?: ProgressCallback;
}): Promise<string> {
  const { fetchFn, onProgress } = opts;
  const dest = cachedModelPath();

  if (await pathExists(dest)) {
    const info = await stat(dest);
    if (info.size === EMBEDDING_MODEL.sizeBytes) {
      return dest;
    }
    await rm(dest, { force: true });
  }

  await downloadVerified({
    url: EMBEDDING_MODEL.url,
    dest,
    sha256: EMBEDDING_MODEL.sha256,
    fetchFn,
    onProgress,
  });

  return dest;
}

async function ensureAssetsOnce(opts: {
  fetchFn: FetchFn;
  onProgress?: ProgressCallback;
  platform: EmbedPlatform;
  runCommand: RunCommand;
}): Promise<{ serverBinary: string; modelPath: string }> {
  const serverBinary = await ensureLlamaBinary(opts);
  const modelPath = await ensureModel(opts);
  return { serverBinary, modelPath };
}

export async function ensureAssets(opts?: {
  fetchFn?: FetchFn;
  onProgress?: ProgressCallback;
  platform?: EmbedPlatform;
  runCommand?: RunCommand;
}): Promise<{ serverBinary: string; modelPath: string }> {
  const fetchFn = opts?.fetchFn ?? fetch;
  const onProgress = opts?.onProgress;
  const platform = opts?.platform ?? currentEmbedPlatform();
  const runCommand = opts?.runCommand ?? execa;

  if (ensureAssetsInflight) {
    return ensureAssetsInflight;
  }

  ensureAssetsInflight = ensureAssetsOnce({ fetchFn, onProgress, platform, runCommand }).finally(
    () => {
      ensureAssetsInflight = null;
    },
  );

  return ensureAssetsInflight;
}
