import { createHash } from "node:crypto";
import { lstat, readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { parseFrontmatter } from "../core/plan-store.ts";

export type DocType = "plan" | "spike" | "bug" | "review";
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

export async function discoverDocs(
  repoRoot: string,
  opts?: { onFound?: (count: number) => void },
): Promise<ShipperDoc[]> {
  const shipperRoot = join(repoRoot, ".shipper");
  const docs: ShipperDoc[] = [];
  const seen = new Set<string>();

  const add = (doc: ShipperDoc): void => {
    docs.push(doc);
    opts?.onFound?.(docs.length);
  };

  const typedFolders: Array<{ type: DocType; root: string }> = [
    { type: "plan", root: "plans" },
    { type: "spike", root: "spikes" },
    { type: "bug", root: "bugs" },
  ];

  for (const { type, root } of typedFolders) {
    for (const status of ["open", "done"] as const) {
      const absDir = join(shipperRoot, root, status);
      const relDir = `.shipper/${root}/${status}`;
      for (const file of await collectMdFiles(absDir, relDir)) {
        try {
          const st = await stat(file.absPath);
          if (st.size > MAX_DOC_BYTES) {
            continue;
          }
          seen.add(file.relPath);
          add({
            relPath: file.relPath,
            absPath: file.absPath,
            type,
            status,
            mtimeMs: st.mtimeMs,
            size: st.size,
          });
        } catch {
          // skip unreadable
        }
      }
    }
  }

  for (const file of await collectMdFiles(join(shipperRoot, "reviews"), ".shipper/reviews")) {
    try {
      const st = await stat(file.absPath);
      if (st.size > MAX_DOC_BYTES) {
        continue;
      }
      seen.add(file.relPath);
      add({
        relPath: file.relPath,
        absPath: file.absPath,
        type: "review",
        status: null,
        mtimeMs: st.mtimeMs,
        size: st.size,
      });
    } catch {
      // skip unreadable
    }
  }

  for (const status of ["open", "done"] as const) {
    const absDir = join(shipperRoot, status);
    const relDir = `.shipper/${status}`;
    for (const file of await collectMdFiles(absDir, relDir)) {
      if (seen.has(file.relPath)) {
        continue;
      }
      try {
        const st = await stat(file.absPath);
        if (st.size > MAX_DOC_BYTES) {
          continue;
        }
        const markdown = await readFile(file.absPath, "utf8");
        const type: DocType = parseFrontmatter(markdown).type === "spike" ? "spike" : "plan";
        add({
          relPath: file.relPath,
          absPath: file.absPath,
          type,
          status,
          mtimeMs: st.mtimeMs,
          size: st.size,
        });
      } catch {
        // skip unreadable
      }
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
