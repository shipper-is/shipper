import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

export type ModuleMeta = {
  id: string;
  name: string;
  description: string;
  category: string;
  version: number;
  replaces: string[];
};

export type ModuleEntry = ModuleMeta & {
  body: string;
  referenceFiles: string[];
};

// Repo root modules/ — one level above web/. Vercel must include source files
// outside the web/ root directory so this path resolves at build time.
const MODULES_DIR = join(process.cwd(), "..", "modules");

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

function parseModuleFrontmatter(markdown: string): ModuleMeta | null {
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

function stripFrontmatter(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  if (lines[0] !== "---") {
    return markdown;
  }

  let closingIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      closingIndex = i;
      break;
    }
  }
  if (closingIndex === -1) {
    return markdown;
  }

  return lines.slice(closingIndex + 1).join("\n").trimStart();
}

async function readModuleFromDir(dirName: string): Promise<ModuleEntry | null> {
  const moduleDir = join(MODULES_DIR, dirName);
  let markdown: string;
  try {
    markdown = await readFile(join(moduleDir, "MODULE.md"), "utf8");
  } catch {
    return null;
  }

  const meta = parseModuleFrontmatter(markdown);
  if (!meta || meta.id !== dirName) {
    return null;
  }

  let dirEntries: string[];
  try {
    dirEntries = await readdir(moduleDir);
  } catch {
    return null;
  }

  const referenceFiles = dirEntries
    .filter((name) => name.endsWith(".md") && name !== "MODULE.md")
    .sort();

  return {
    ...meta,
    body: stripFrontmatter(markdown),
    referenceFiles,
  };
}

export async function getAllModules(): Promise<ModuleEntry[]> {
  let entries: string[];
  try {
    entries = await readdir(MODULES_DIR, { withFileTypes: true }).then((items) =>
      items.filter((item) => item.isDirectory()).map((item) => item.name),
    );
  } catch {
    return [];
  }

  const modules: ModuleEntry[] = [];
  for (const dirName of entries) {
    const module = await readModuleFromDir(dirName);
    if (module) {
      modules.push(module);
    }
  }

  return modules.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getModule(id: string): Promise<ModuleEntry | null> {
  return readModuleFromDir(id);
}
