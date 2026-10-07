import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { EMBEDDING_MODEL, LLAMA_CPP_BUILD, type EmbedPlatform } from "../constants.ts";

/** User cache root. Recomputed every call so tests can override HOME / XDG_CACHE_HOME. */
export function cacheDir(): string {
  const xdg = process.env["XDG_CACHE_HOME"];
  if (xdg) {
    return join(xdg, "shipper");
  }
  return join(homedir(), ".cache", "shipper");
}

export function llamaInstallDir(platform: EmbedPlatform): string {
  return join(cacheDir(), "llama", `${LLAMA_CPP_BUILD}-${platform}`);
}

export function llamaServerBinary(platform: EmbedPlatform): string {
  return join(llamaInstallDir(platform), `llama-${LLAMA_CPP_BUILD}`, "llama-server");
}

export function modelPath(): string {
  return join(cacheDir(), "models", EMBEDDING_MODEL.file);
}

export function embedStateDir(): string {
  return join(cacheDir(), "embed");
}

export function serverStatePath(): string {
  return join(embedStateDir(), "server.json");
}

export function serverLockPath(): string {
  return join(embedStateDir(), "server.lock");
}

export function lastUsedPath(): string {
  return join(embedStateDir(), "last-used");
}

export function daemonLogPath(): string {
  return join(embedStateDir(), "daemon.log");
}

export function indexDir(): string {
  return join(cacheDir(), "index");
}

export function indexPathForRepo(realRepoPath: string): string {
  const hash = createHash("sha256").update(realRepoPath).digest("hex").slice(0, 16);
  return join(indexDir(), `${hash}.idx`);
}

export function currentEmbedPlatform(
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
): EmbedPlatform {
  const key = `${platform}-${arch}`;
  switch (key) {
    case "darwin-arm64":
    case "darwin-x64":
    case "linux-x64":
    case "linux-arm64":
      return key;
    default:
      throw new Error(`Semantic search is not supported on ${platform}-${arch}`);
  }
}
