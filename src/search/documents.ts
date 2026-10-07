import { createHash } from "node:crypto";
import { lstat, readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { loadConfig } from "../core/config.ts";
import { parseFrontmatter } from "../core/frontmatter.ts";
import type { EffectiveConfig } from "../shared/config-schema.ts";

export type DocType = "plan" | "spike" | "bug" | "review" | "doc";
export type DocStatus = "open" | "done" | null;

export type ShipperDoc = {
  relPath: string;
  absPath: string;
  type: DocType;
  status: DocStatus;
  mtimeMs: number;
  size: number;
};

const MAX_DOC_BYTES = 1_000_000;

const TITLE_RE = /^# (.+)$/;

const FRONTMATTER_KEYS = [
  "branch",
  "base_branch",
  "pr_url",
  "pr_number",
  "severity",
  "started_at",
  "completed_at",
  "fixed_at",
  "reported_at",
  "reviewed_at",
  "merge_risk",
  "production_risk",
] as const;

async function isSymlink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch {
    return false;
  }
}

function toForwardSlashes(path: string): string {
  return path.replaceAll("\\", "/");
}

async function collectMdFiles(
  absDir: string,
  relDir: string,
): Promise<Array<{ absPath: string; relPath: string; filename: string }>> {
  let entries: string[];
  try {
    entries = await readdir(absDir);
  } catch {
    return [];
  }

  const out: Array<{ absPath: string; relPath: string; filename: string }> = [];
  for (const filename of entries.filter((f) => f.endsWith(".md")).sort()) {
    const absPath = join(absDir, filename);
    if (await isSymlink(absPath)) {
      continue;
    }
    out.push({
      absPath,
      relPath: toForwardSlashes(`${relDir}/${filename}`),
      filename,
    });
  }
  return out;
}

function absFromRepo(repoRoot: string, rel: string): string {
  return join(repoRoot, ...rel.split("/").filter((part) => part.length > 0));
}

export async function discoverDocs(
  repoRoot: string,
  opts?: { onFound?: (count: number) => void; config?: EffectiveConfig },
): Promise<ShipperDoc[]> {
  const effective = opts?.config ?? (await loadConfig(repoRoot)).effective;
  const docs: ShipperDoc[] = [];
  const seen = new Set<string>();

  const add = (doc: ShipperDoc): void => {
    docs.push(doc);
    opts?.onFound?.(docs.length);
  };

  const consider = async (
    file: { absPath: string; relPath: string },
    type: DocType,
    status: DocStatus,
    readTypeFromFrontmatter = false,
  ): Promise<void> => {
    if (seen.has(file.relPath)) return;
    try {
      const st = await stat(file.absPath);
      if (st.size > MAX_DOC_BYTES) return;
      let resolvedType = type;
      if (readTypeFromFrontmatter) {
        const markdown = await readFile(file.absPath, "utf8");
        resolvedType = parseFrontmatter(markdown).type === "spike" ? "spike" : "plan";
      }
      seen.add(file.relPath);
      add({
        relPath: file.relPath,
        absPath: file.absPath,
        type: resolvedType,
        status,
        mtimeMs: st.mtimeMs,
        size: st.size,
      });
    } catch {
      // skip unreadable
    }
  };

  const typedFolders: Array<{ type: DocType; relRoot: string }> = [
    { type: "plan", relRoot: effective.paths.plans },
    { type: "spike", relRoot: effective.paths.spikes },
    { type: "bug", relRoot: effective.paths.bugs },
  ];

  for (const { type, relRoot } of typedFolders) {
    for (const status of ["open", "done"] as const) {
      const relDir = `${relRoot}/${status}`;
      for (const file of await collectMdFiles(absFromRepo(repoRoot, relDir), relDir)) {
        await consider(file, type, status);
      }
    }
  }

  const reviewsRel = effective.paths.reviews;
  for (const file of await collectMdFiles(absFromRepo(repoRoot, reviewsRel), reviewsRel)) {
    await consider(file, "review", null);
  }

  for (const status of ["open", "done"] as const) {
    const relDir = `.shipper/${status}`;
    for (const file of await collectMdFiles(join(repoRoot, ".shipper", status), relDir)) {
      await consider(file, "plan", status, true);
    }
  }

  // Extra dirs are not recursive in v1: only markdown files directly inside each directory.
  for (const extra of effective.search.extraDirs) {
    for (const file of await collectMdFiles(absFromRepo(repoRoot, extra), extra)) {
      await consider(file, "doc", null);
    }
  }

  docs.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return docs;
}

function extractTitle(markdown: string, filename: string): string {
  const lines = markdown.split(/\r?\n/);
  let i = 0;
  if (lines[0] === "---") {
    for (i = 1; i < lines.length; i++) {
      if (lines[i] === "---") {
        i += 1;
        break;
      }
    }
  }
  for (; i < lines.length; i++) {
    const match = TITLE_RE.exec(lines[i]!);
    if (match) {
      return match[1]!.trim();
    }
  }
  return basename(filename, ".md");
}

function scalarFrontmatter(markdown: string): Record<string, string | number> {
  const lines = markdown.split(/\r?\n/);
  if (lines[0] !== "---") {
    return {};
  }
  let closingIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      closingIndex = i;
      break;
    }
  }
  if (closingIndex === -1) {
    return {};
  }
  const block = lines.slice(1, closingIndex).join("\n");
  let parsed: unknown;
  try {
    parsed = parseYaml(block);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  const record = parsed as Record<string, unknown>;
  const out: Record<string, string | number> = {};
  for (const key of FRONTMATTER_KEYS) {
    const value = record[key];
    if (typeof value === "string") {
      out[key] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
    }
  }
  return out;
}

export function readDocMetadata(
  markdown: string,
  doc: Pick<ShipperDoc, "relPath">,
): { title: string; frontmatter: Record<string, string | number> } {
  return {
    title: extractTitle(markdown, doc.relPath),
    frontmatter: scalarFrontmatter(markdown),
  };
}

export function contentHash(markdown: string): string {
  return createHash("sha256").update(markdown).digest("hex");
}
