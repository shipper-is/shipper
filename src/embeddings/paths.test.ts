import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LLAMA_CPP_BUILD } from "../constants.ts";
import {
  cacheDir,
  currentEmbedPlatform,
  daemonLogPath,
  embedStateDir,
  indexDir,
  indexPathForRepo,
  lastUsedPath,
  llamaInstallDir,
  llamaServerBinary,
  modelPath,
  serverLockPath,
  serverStatePath,
} from "./paths.ts";

describe("embeddings paths", () => {
  let previousHome: string | undefined;
  let previousXdgCache: string | undefined;
  let homeDir: string;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "shipper-embed-paths-"));
    previousHome = process.env["HOME"];
    previousXdgCache = process.env["XDG_CACHE_HOME"];
    process.env["HOME"] = homeDir;
    delete process.env["XDG_CACHE_HOME"];
  });

  afterEach(async () => {
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
    await rm(homeDir, { recursive: true, force: true });
  });

  it("falls back to ~/.cache/shipper under an overridden HOME", () => {
    expect(cacheDir()).toBe(join(homeDir, ".cache", "shipper"));
    expect(modelPath()).toBe(
      join(homeDir, ".cache", "shipper", "models", "nomic-embed-text-v1.5.Q4_K_M.gguf"),
    );
    expect(embedStateDir()).toBe(join(homeDir, ".cache", "shipper", "embed"));
    expect(serverStatePath()).toBe(join(homeDir, ".cache", "shipper", "embed", "server.json"));
    expect(serverLockPath()).toBe(join(homeDir, ".cache", "shipper", "embed", "server.lock"));
    expect(lastUsedPath()).toBe(join(homeDir, ".cache", "shipper", "embed", "last-used"));
    expect(daemonLogPath()).toBe(join(homeDir, ".cache", "shipper", "embed", "daemon.log"));
    expect(indexDir()).toBe(join(homeDir, ".cache", "shipper", "index"));
  });

  it("respects XDG_CACHE_HOME", () => {
    const xdg = join(homeDir, "xdg-cache");
    process.env["XDG_CACHE_HOME"] = xdg;
    expect(cacheDir()).toBe(join(xdg, "shipper"));
    expect(llamaInstallDir("darwin-arm64")).toBe(
      join(xdg, "shipper", "llama", `${LLAMA_CPP_BUILD}-darwin-arm64`),
    );
    expect(llamaServerBinary("darwin-arm64")).toBe(
      join(
        xdg,
        "shipper",
        "llama",
        `${LLAMA_CPP_BUILD}-darwin-arm64`,
        `llama-${LLAMA_CPP_BUILD}`,
        "llama-server",
      ),
    );
  });

  it("indexPathForRepo is stable for the same path and differs across paths", () => {
    const a = indexPathForRepo("/repos/alpha");
    const b = indexPathForRepo("/repos/alpha");
    const c = indexPathForRepo("/repos/beta");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/\.idx$/);
    expect(a).toContain(join(cacheDir(), "index"));
  });

  it("currentEmbedPlatform maps supported combos and rejects others", () => {
    expect(currentEmbedPlatform("darwin", "arm64")).toBe("darwin-arm64");
    expect(currentEmbedPlatform("darwin", "x64")).toBe("darwin-x64");
    expect(currentEmbedPlatform("linux", "x64")).toBe("linux-x64");
    expect(currentEmbedPlatform("linux", "arm64")).toBe("linux-arm64");
    expect(() => currentEmbedPlatform("win32", "x64")).toThrow(
      "Semantic search is not supported on win32-x64",
    );
    expect(() => currentEmbedPlatform("linux", "ia32")).toThrow(
      "Semantic search is not supported on linux-ia32",
    );
  });
});
