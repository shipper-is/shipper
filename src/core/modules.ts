import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  GITHUB_REPO,
  MODULES_BRANCH,
  SITE_URL,
  moduleRawContentUrl,
  modulesContentsApiUrl,
} from "../constants.ts";

export type ModuleMeta = {
  id: string;
  name: string;
  description: string;
  category: string;
  version: number;
  replaces: string[];
};

export type InstallModuleResult = {
  id: string;
  files: string[];
  root: string;
};

type FetchFn = typeof fetch;

type GitHubContentEntry = {
  name: string;
  type: "file" | "dir" | "symlink" | "submodule";
};

const KEBAB_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function asMetaString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asMetaNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

export function parseModuleFrontmatter(markdown: string): ModuleMeta | null {
  const lines = markdown.split(/\r?\n/);
  if (lines[0] !== "---") {
    return null;
  }

  let closingIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      closingIndex = i;
      break;
    }
  }
  if (closingIndex === -1) {
    return null;
  }

  const block = lines.slice(1, closingIndex).join("\n");
  try {
    const parsed = parseYaml(block);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (record.type !== "module") {
      return null;
    }

    const id = asMetaString(record.id);
    const name = asMetaString(record.name);
    const description = asMetaString(record.description);
    const category = asMetaString(record.category);
    const version = asMetaNumber(record.version);

    if (!id || !name || !description || !category || version === null) {
      return null;
    }

    return {
      id,
      name,
      description,
      category,
      version,
      replaces: asStringList(record.replaces),
    };
  } catch {
    return null;
  }
}

export function parseModuleReference(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  if (KEBAB_ID_RE.test(trimmed)) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);

    const siteMatch = url.pathname.match(/^\/modules\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/);
    if (
      (url.hostname === "shipper.is" || url.hostname === "www.shipper.is") &&
      siteMatch?.[1]
    ) {
      return siteMatch[1];
    }

    const githubTreeMatch = url.pathname.match(
      /^\/[^/]+\/[^/]+\/(?:tree|blob)\/[^/]+\/modules\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/.*)?$/,
    );
    if (
      url.hostname === "github.com" &&
      url.pathname.startsWith(`/${GITHUB_REPO}/`) &&
      githubTreeMatch?.[1]
    ) {
      return githubTreeMatch[1];
    }
  } catch {
    return null;
  }

  return null;
}

function rateLimitMessage(status: number): string {
  return `GitHub API rate limit exceeded (HTTP ${status}). Try again later or authenticate with a token.`;
}

async function fetchJson<T>(url: string, fetchFn: FetchFn): Promise<T> {
  const response = await fetchFn(url, {
    headers: { Accept: "application/vnd.github+json" },
  });

  if (response.status === 403 || response.status === 429) {
    throw new Error(rateLimitMessage(response.status));
  }
  if (!response.ok) {
    throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

async function fetchText(url: string, fetchFn: FetchFn): Promise<string> {
  const response = await fetchFn(url);

  if (response.status === 403 || response.status === 429) {
    throw new Error(rateLimitMessage(response.status));
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function writeFileIfChanged(absolutePath: string, content: string): Promise<void> {
  await mkdir(dirname(absolutePath), { recursive: true });

  try {
    const existing = await readFile(absolutePath, "utf8");
    if (existing === content) {
      return;
    }
  } catch {
    // file missing — write it
  }

  await writeFile(absolutePath, content, "utf8");
}

export async function listRemoteModules(fetchFn: FetchFn = fetch): Promise<ModuleMeta[]> {
  const entries = await fetchJson<GitHubContentEntry[]>(modulesContentsApiUrl(), fetchFn);
  const modules: ModuleMeta[] = [];

  for (const entry of entries) {
    if (entry.type !== "dir") {
      continue;
    }

    try {
      const markdown = await fetchText(moduleRawContentUrl(entry.name, "MODULE.md"), fetchFn);
      const meta = parseModuleFrontmatter(markdown);
      if (meta) {
        modules.push(meta);
      }
    } catch {
      // skip entries with missing or unreadable MODULE.md
    }
  }

  return modules;
}

export async function installModule(
  id: string,
  targetDir: string,
  fetchFn: FetchFn = fetch,
): Promise<InstallModuleResult> {
  let entries: GitHubContentEntry[];
  try {
    entries = await fetchJson<GitHubContentEntry[]>(modulesContentsApiUrl(id), fetchFn);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("404")) {
      throw new Error(`Unknown module: ${id}`, { cause: err });
    }
    throw err;
  }

  const mdFiles = entries.filter((entry) => entry.type === "file" && entry.name.endsWith(".md"));
  if (mdFiles.length === 0) {
    throw new Error(`Unknown module: ${id}`);
  }

  const root = join(targetDir, ".shipper", "modules", id);
  const installedFiles: string[] = [];

  for (const file of mdFiles) {
    const content = await fetchText(moduleRawContentUrl(id, file.name), fetchFn);
    const absolutePath = join(root, file.name);
    await writeFileIfChanged(absolutePath, content);
    installedFiles.push(file.name);
  }

  const modulePath = join(root, "MODULE.md");
  let moduleMarkdown: string;
  try {
    moduleMarkdown = await readFile(modulePath, "utf8");
  } catch {
    throw new Error(`Module ${id} is missing a valid MODULE.md after install`);
  }

  const meta = parseModuleFrontmatter(moduleMarkdown);
  if (!meta) {
    throw new Error(`Module ${id} is missing a valid MODULE.md after install`);
  }

  return { id, files: installedFiles.sort(), root };
}

export function modulePlanHint(id: string): string {
  return `Run /shipper-plan ${id} in your coding agent to plan the build.`;
}

export { MODULES_BRANCH, SITE_URL };
