import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { modulesContentsApiUrl, moduleRawContentUrl } from "../constants.ts";
import {
  installModule,
  listRemoteModules,
  parseModuleFrontmatter,
  parseModuleReference,
} from "./modules.ts";

const VALID_MODULE_MD = `---
type: module
id: customer-support
name: Customer Support
description: In-app support widget and team inbox.
category: support
version: 1
replaces:
  - Intercom
  - Zendesk
---

# Customer Support
`;

describe("parseModuleReference", () => {
  it("accepts bare kebab-case ids", () => {
    expect(parseModuleReference("customer-support")).toBe("customer-support");
    expect(parseModuleReference("  customer-support  ")).toBe("customer-support");
  });

  it("accepts shipper.is module URLs", () => {
    expect(parseModuleReference("https://shipper.is/modules/customer-support")).toBe(
      "customer-support",
    );
    expect(parseModuleReference("https://shipper.is/modules/customer-support/")).toBe(
      "customer-support",
    );
    expect(parseModuleReference("https://www.shipper.is/modules/customer-support")).toBe(
      "customer-support",
    );
  });

  it("accepts GitHub module folder URLs", () => {
    expect(
      parseModuleReference(
        "https://github.com/shipper-is/shipper/tree/main/modules/customer-support",
      ),
    ).toBe("customer-support");
    expect(
      parseModuleReference(
        "https://github.com/shipper-is/shipper/blob/main/modules/customer-support/MODULE.md",
      ),
    ).toBe("customer-support");
  });

  it("rejects invalid input", () => {
    expect(parseModuleReference("")).toBeNull();
    expect(parseModuleReference("Customer Support")).toBeNull();
    expect(parseModuleReference("https://example.com/modules/foo")).toBeNull();
    expect(parseModuleReference("not-a-url/modules/foo")).toBeNull();
  });
});

describe("parseModuleFrontmatter", () => {
  it("parses valid module frontmatter", () => {
    const meta = parseModuleFrontmatter(VALID_MODULE_MD);
    expect(meta).toEqual({
      id: "customer-support",
      name: "Customer Support",
      description: "In-app support widget and team inbox.",
      category: "support",
      version: 1,
      replaces: ["Intercom", "Zendesk"],
    });
  });

  it("returns null when frontmatter is missing", () => {
    expect(parseModuleFrontmatter("# No frontmatter")).toBeNull();
  });

  it("returns null when type is not module", () => {
    const markdown = VALID_MODULE_MD.replace("type: module", "type: plan");
    expect(parseModuleFrontmatter(markdown)).toBeNull();
  });

  it("returns null for malformed YAML", () => {
    expect(parseModuleFrontmatter("---\n: [invalid\n---\n")).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    const markdown = `---
type: module
id: customer-support
---
`;
    expect(parseModuleFrontmatter(markdown)).toBeNull();
  });
});

describe("installModule", () => {
  let repoDir: string;

  afterEach(async () => {
    if (repoDir) {
      await rm(repoDir, { recursive: true, force: true });
    }
  });

  function stubFetchForModule(
    id: string,
    files: Record<string, string>,
    options?: { listStatus?: number; fileListStatus?: number },
  ): typeof fetch {
    const listStatus = options?.listStatus ?? 200;
    const fileListStatus = options?.fileListStatus ?? 200;

    return (async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === modulesContentsApiUrl(id)) {
        return new Response(
          JSON.stringify(
            Object.keys(files).map((name) => ({ name, type: "file" as const })),
          ),
          { status: fileListStatus },
        );
      }

      if (url === modulesContentsApiUrl()) {
        return new Response(JSON.stringify([{ name: id, type: "dir" }]), { status: listStatus });
      }

      for (const [name, content] of Object.entries(files)) {
        if (url === moduleRawContentUrl(id, name)) {
          return new Response(content, { status: 200 });
        }
      }

      return new Response("not found", { status: 404 });
    }) as typeof fetch;
  }

  it("installs markdown files into .shipper/modules/<id>/", async () => {
    repoDir = await mkdtemp(join(tmpdir(), "shipper-modules-install-"));
    const fetchFn = stubFetchForModule("customer-support", {
      "MODULE.md": VALID_MODULE_MD,
      "DATA-MODEL.md": "# Data model\n",
    });

    const result = await installModule("customer-support", repoDir, fetchFn);

    expect(result.id).toBe("customer-support");
    expect(result.files).toEqual(["DATA-MODEL.md", "MODULE.md"]);
    expect(result.root).toBe(join(repoDir, ".shipper", "modules", "customer-support"));

    const moduleMd = await readFile(join(result.root, "MODULE.md"), "utf8");
    expect(moduleMd).toBe(VALID_MODULE_MD);
    const dataModel = await readFile(join(result.root, "DATA-MODEL.md"), "utf8");
    expect(dataModel).toBe("# Data model\n");
  });

  it("is a no-op for unchanged content on re-run", async () => {
    repoDir = await mkdtemp(join(tmpdir(), "shipper-modules-rerun-"));
    const root = join(repoDir, ".shipper", "modules", "customer-support");
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "MODULE.md"), VALID_MODULE_MD, "utf8");

    let rawFetches = 0;
    const baseFetch = stubFetchForModule("customer-support", {
      "MODULE.md": VALID_MODULE_MD,
    });
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://raw.githubusercontent.com/")) {
        rawFetches += 1;
      }
      return baseFetch(input);
    }) as typeof fetch;

    await installModule("customer-support", repoDir, fetchFn);
    const mtimeBefore = (await import("node:fs/promises")).stat(join(root, "MODULE.md")).then(
      (s) => s.mtimeMs,
    );

    await new Promise((resolve) => setTimeout(resolve, 5));
    await installModule("customer-support", repoDir, fetchFn);
    const mtimeAfter = (await import("node:fs/promises")).stat(join(root, "MODULE.md")).then(
      (s) => s.mtimeMs,
    );

    expect(rawFetches).toBeGreaterThan(0);
    expect(await mtimeBefore).toBe(await mtimeAfter);
  });

  it("throws for unknown modules (404)", async () => {
    repoDir = await mkdtemp(join(tmpdir(), "shipper-modules-404-"));
    const fetchFn = stubFetchForModule("missing-module", {}, { fileListStatus: 404 });

    await expect(installModule("missing-module", repoDir, fetchFn)).rejects.toThrow(
      "Unknown module: missing-module",
    );
  });

  it("throws a descriptive error on rate limiting (403)", async () => {
    repoDir = await mkdtemp(join(tmpdir(), "shipper-modules-403-"));
    const fetchFn = stubFetchForModule("customer-support", {}, { fileListStatus: 403 });

    await expect(installModule("customer-support", repoDir, fetchFn)).rejects.toThrow(
      "GitHub API rate limit exceeded",
    );
  });

  it("throws when MODULE.md is invalid after install", async () => {
    repoDir = await mkdtemp(join(tmpdir(), "shipper-modules-invalid-"));
    const fetchFn = stubFetchForModule("customer-support", {
      "MODULE.md": "# Not a module\n",
    });

    await expect(installModule("customer-support", repoDir, fetchFn)).rejects.toThrow(
      "missing a valid MODULE.md",
    );
  });
});

describe("listRemoteModules", () => {
  it("returns parsed modules and skips invalid entries", async () => {
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === modulesContentsApiUrl()) {
        return new Response(
          JSON.stringify([
            { name: "customer-support", type: "dir" },
            { name: "broken-module", type: "dir" },
            { name: "README.md", type: "file" },
          ]),
          { status: 200 },
        );
      }

      if (url === moduleRawContentUrl("customer-support", "MODULE.md")) {
        return new Response(VALID_MODULE_MD, { status: 200 });
      }

      if (url === moduleRawContentUrl("broken-module", "MODULE.md")) {
        return new Response("# no frontmatter", { status: 200 });
      }

      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const modules = await listRemoteModules(fetchFn);
    expect(modules).toHaveLength(1);
    expect(modules[0]?.id).toBe("customer-support");
  });

  it("throws on GitHub rate limits", async () => {
    const fetchFn = (async () => new Response("rate limited", { status: 403 })) as unknown as typeof fetch;
    await expect(listRemoteModules(fetchFn)).rejects.toThrow("GitHub API rate limit exceeded");
  });
});
