import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { execa } from "execa";
import { EMBEDDING_MODEL, LLAMA_CPP_ASSETS, LLAMA_CPP_BUILD } from "../constants.ts";
import {
  downloadVerified,
  ensureAssets,
  extractTarball,
  formatProgress,
} from "./assets.ts";
import { llamaServerBinary, modelPath } from "./paths.ts";

type RunCommand = typeof execa;

function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function fakeTarExtract(): RunCommand {
  return (async (_bin: string, args: readonly string[]) => {
    const cIndex = args.indexOf("-C");
    const extractRoot = args[cIndex + 1]!;
    const serverDir = join(extractRoot, `llama-${LLAMA_CPP_BUILD}`);
    await mkdir(serverDir, { recursive: true });
    await writeFile(join(serverDir, "llama-server"), "#!/bin/sh\necho ok\n");
    return { exitCode: 0, stdout: "", stderr: "" };
  }) as unknown as RunCommand;
}

describe("formatProgress", () => {
  it("formats percent and megabyte counts", () => {
    expect(formatProgress("embedding model", 35.3 * 1024 * 1024, 84.1 * 1024 * 1024)).toBe(
      "Downloading embedding model 42% (35.3 / 84.1 MB)",
    );
  });

  it("omits percent when total is unknown", () => {
    expect(formatProgress("llama.cpp", 12 * 1024 * 1024, null)).toBe(
      "Downloading llama.cpp (12.0 MB)",
    );
  });
});

describe("downloadVerified", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "shipper-download-"));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("writes the file and removes the .partial on success", async () => {
    const body = new Uint8Array([1, 2, 3, 4, 5]);
    const dest = join(tmp, "out.bin");
    const digest = sha256Hex(body);
    const progress: Array<[number, number | null]> = [];

    await downloadVerified({
      url: "https://example.test/out.bin",
      dest,
      sha256: digest,
      fetchFn: async () =>
        new Response(body, {
          status: 200,
          headers: { "content-length": String(body.length) },
        }),
      onProgress: (received, total) => {
        progress.push([received, total]);
      },
    });

    expect(await readFile(dest)).toEqual(Buffer.from(body));
    await expect(access(`${dest}.partial`)).rejects.toThrow();
    expect(progress.at(-1)).toEqual([body.length, body.length]);
  });

  it("throws on checksum mismatch and leaves no file", async () => {
    const body = new Uint8Array([9, 8, 7]);
    const dest = join(tmp, "bad.bin");

    await expect(
      downloadVerified({
        url: "https://example.test/bad.bin",
        dest,
        sha256: "0".repeat(64),
        fetchFn: async () => new Response(body, { status: 200 }),
      }),
    ).rejects.toThrow("Checksum mismatch for https://example.test/bad.bin");

    await expect(access(dest)).rejects.toThrow();
    await expect(access(`${dest}.partial`)).rejects.toThrow();
  });

  it("throws on non-2xx responses", async () => {
    await expect(
      downloadVerified({
        url: "https://example.test/missing",
        dest: join(tmp, "x.bin"),
        sha256: "0".repeat(64),
        fetchFn: async () => new Response("nope", { status: 404, statusText: "Not Found" }),
      }),
    ).rejects.toThrow("Download failed: 404 Not Found for https://example.test/missing");
  });
});

describe("extractTarball", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "shipper-extract-"));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("extracts via runCommand into targetDir and chmods llama-server", async () => {
    const archive = join(tmp, "fake.tar.gz");
    await writeFile(archive, "fake");
    const targetDir = join(tmp, "install");

    await extractTarball(archive, targetDir, fakeTarExtract());

    const server = join(targetDir, `llama-${LLAMA_CPP_BUILD}`, "llama-server");
    const info = await stat(server);
    expect(info.isFile()).toBe(true);
    expect(info.mode & 0o111).toBeTruthy();
  });
});

describe("ensureAssets", () => {
  let previousHome: string | undefined;
  let previousXdgCache: string | undefined;
  let homeDir: string;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "shipper-ensure-assets-"));
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

  it("skips the network when files already exist", async () => {
    const platform = "darwin-arm64" as const;
    const server = llamaServerBinary(platform);
    const model = modelPath();
    await mkdir(dirname(server), { recursive: true });
    await writeFile(server, "binary");
    await mkdir(dirname(model), { recursive: true });
    await writeFile(model, Buffer.alloc(EMBEDDING_MODEL.sizeBytes));

    const result = await ensureAssets({
      platform,
      fetchFn: async () => {
        throw new Error("network should not be called");
      },
      runCommand: (async () => {
        throw new Error("tar should not be called");
      }) as unknown as RunCommand,
    });

    expect(result.serverBinary).toBe(server);
    expect(result.modelPath).toBe(model);
  });

  it("extracts an existing archive and deletes it after success", async () => {
    const platform = "linux-x64" as const;
    const asset = LLAMA_CPP_ASSETS[platform];
    const archivePath = join(homeDir, ".cache", "shipper", "llama", asset.asset);
    await mkdir(dirname(archivePath), { recursive: true });
    await writeFile(archivePath, "archive-bytes");

    await mkdir(dirname(modelPath()), { recursive: true });
    await writeFile(modelPath(), Buffer.alloc(EMBEDDING_MODEL.sizeBytes));

    let tarCalls = 0;
    const runCommand = (async (_bin: string, args: readonly string[]) => {
      tarCalls += 1;
      const cIndex = args.indexOf("-C");
      const extractRoot = args[cIndex + 1]!;
      const serverDir = join(extractRoot, `llama-${LLAMA_CPP_BUILD}`);
      await mkdir(serverDir, { recursive: true });
      await writeFile(join(serverDir, "llama-server"), "server");
      return { exitCode: 0, stdout: "", stderr: "" };
    }) as unknown as RunCommand;

    const result = await ensureAssets({
      platform,
      fetchFn: async () => {
        throw new Error("network should not be called when archive and model exist");
      },
      runCommand,
    });

    expect(tarCalls).toBe(1);
    expect(result.serverBinary).toBe(llamaServerBinary(platform));
    await expect(access(result.serverBinary)).resolves.toBeUndefined();
    await expect(access(archivePath)).rejects.toThrow();
  });

  it("re-downloads the model when the size differs", async () => {
    const platform = "darwin-arm64" as const;
    const server = llamaServerBinary(platform);
    await mkdir(dirname(server), { recursive: true });
    await writeFile(server, "binary");

    const model = modelPath();
    await mkdir(dirname(model), { recursive: true });
    await writeFile(model, Buffer.alloc(12));

    await expect(
      ensureAssets({
        platform,
        fetchFn: async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
        runCommand: (async () => {
          throw new Error("tar should not be called");
        }) as unknown as RunCommand,
      }),
    ).rejects.toThrow(`Checksum mismatch for ${EMBEDDING_MODEL.url}`);

    await expect(access(model)).rejects.toThrow();
    await expect(access(`${model}.partial`)).rejects.toThrow();
  });
});
