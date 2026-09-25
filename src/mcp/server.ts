import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { Embedder } from "../embeddings/client.ts";
import { createLlamaEmbedder } from "../embeddings/client.ts";
import { formatProgress } from "../embeddings/assets.ts";
import { ensureEmbedServer } from "../embeddings/server-manager.ts";
import type { DocType } from "../search/documents.ts";
import { syncIndex, syncIndexIfStale, type SyncStats } from "../search/indexer.ts";
import { resolveRepoRoot } from "../search/repo-root.ts";
import {
  findSimilar,
  formatHits,
  searchIndex,
  type SearchFilters,
} from "../search/search.ts";
import { getVersion } from "../version.ts";

const DEFAULT_WARM_UP_TIMEOUT_MS = 45_000;

const DOC_TYPE_ENUM = z.enum(["plan", "spike", "bug", "review"]);
const STATUS_ENUM = z.enum(["open", "done", "any"]);

const INSTRUCTIONS =
  "Semantic search over this repository's Shipper plans, spikes, bugs, and reviews in .shipper/. Use shipper_search before grepping .shipper/.";

export type ResolveRootFn = (opts: {
  explicitDir?: string;
  rootUris?: string[];
  cwd: string;
}) => Promise<string>;

export type CreateShipperMcpServerOpts = {
  embedder: Embedder;
  resolveRoot?: ResolveRootFn;
  log?: (message: string) => void;
  explicitDir?: string;
  cwd?: string;
  ensureServer?: () => Promise<{ baseUrl: string }>;
  warmUpTimeoutMs?: number;
};

type TextResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function textResult(text: string, structuredContent?: Record<string, unknown>): TextResult {
  return structuredContent
    ? { content: [{ type: "text", text }], structuredContent }
    : { content: [{ type: "text", text }] };
}

function errorResult(message: string): TextResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

function formatStats(stats: SyncStats): string {
  return `Indexed ${stats.files} files (${stats.chunks} chunks): embedded ${stats.embedded}, reused ${stats.reused}, removed ${stats.removed} in ${stats.ms} ms`;
}

function formatDocList(
  files: Record<
    string,
    { type: DocType; status: string | null; title: string }
  >,
  filters?: SearchFilters,
): string {
  const lines: string[] = [];
  const entries = Object.entries(files).sort(([a], [b]) => a.localeCompare(b));
  for (const [relPath, file] of entries) {
    if (filters?.types && filters.types.length > 0 && !filters.types.includes(file.type)) {
      continue;
    }
    const statusFilter = filters?.status;
    if (statusFilter && statusFilter !== "any") {
      if (file.status === null || file.status !== statusFilter) {
        continue;
      }
    }
    const typeStatus =
      file.type === "review" ? "review" : `${file.type}, ${file.status ?? "unknown"}`;
    lines.push(`[${typeStatus}] ${file.title} — ${relPath}`);
  }
  return lines.length > 0 ? lines.join("\n") : "No documents indexed.";
}

async function resolveSafeShipperPath(repoRoot: string, requested: string): Promise<string> {
  const shipperRoot = await realpath(join(repoRoot, ".shipper"));
  const candidate = isAbsolute(requested) ? requested : resolve(repoRoot, requested);
  let real: string;
  try {
    real = await realpath(candidate);
  } catch {
    throw new Error(`File not found: ${requested}`);
  }
  const rel = relative(shipperRoot, real);
  if (rel.startsWith("..") || isAbsolute(rel) || rel.includes(`..${sep}`)) {
    throw new Error(`Path must stay inside .shipper/: ${requested}`);
  }
  if (!real.endsWith(".md")) {
    throw new Error(`Path must be a .md file under .shipper/: ${requested}`);
  }
  return real;
}

function sliceLines(content: string, startLine?: number, endLine?: number): string {
  if (startLine === undefined && endLine === undefined) {
    return content;
  }
  const lines = content.split(/\r?\n/);
  const start = Math.max(1, startLine ?? 1);
  const end = Math.min(lines.length, endLine ?? lines.length);
  if (start > end) {
    return "";
  }
  return lines.slice(start - 1, end).join("\n");
}

export function createShipperMcpServer(opts: CreateShipperMcpServerOpts): McpServer {
  const log = opts.log ?? ((msg: string) => console.error(msg));
  const resolveRoot = opts.resolveRoot ?? resolveRepoRoot;
  const cwd = opts.cwd ?? process.cwd();
  const ensureServer =
    opts.ensureServer ?? (() => ensureEmbedServer({ onProgress: trackProgress }));
  const warmUpTimeoutMs = opts.warmUpTimeoutMs ?? DEFAULT_WARM_UP_TIMEOUT_MS;
  const embedder = opts.embedder;

  let progressLabel = "embedding model";
  let progressPct: number | null = null;
  let lastReportedPct = -1;

  function trackProgress(received: number, total: number | null): void {
    if (total !== null && total > 0) {
      const pct = Math.min(100, Math.round((received / total) * 100));
      if (pct - lastReportedPct >= 5 || pct === 100) {
        lastReportedPct = pct;
        progressPct = pct;
        log(formatProgress(progressLabel, received, total));
      }
    } else {
      log(formatProgress(progressLabel, received, total));
    }
  }

  let cachedRoot: string | null = null;
  let warmUpPromise: Promise<void> | null = null;
  const warmUpState: { error: Error | null } = { error: null };

  const server = new McpServer(
    { name: "shipper", version: getVersion() },
    { instructions: INSTRUCTIONS },
  );

  async function resolveRootOnce(): Promise<string> {
    if (cachedRoot) {
      return cachedRoot;
    }
    let rootUris: string[] | undefined;
    try {
      if (server.server.getClientCapabilities()?.roots) {
        const listed = await server.server.listRoots();
        rootUris = listed.roots.map((r) => r.uri);
      }
    } catch (err: unknown) {
      log(
        `Warning: could not list MCP roots (${err instanceof Error ? err.message : String(err)})`,
      );
    }
    const root = await resolveRoot({
      explicitDir: opts.explicitDir,
      rootUris,
      cwd,
    });
    cachedRoot = root;
    log(`Shipper MCP repo root: ${root}`);
    return root;
  }

  async function runWarmUp(): Promise<void> {
    try {
      progressLabel = "embedding assets";
      await ensureServer();
      const repoRoot = await resolveRootOnce();
      await syncIndex({
        repoRoot,
        embedder,
        onProgress: (message) => log(message),
      });
    } catch (err: unknown) {
      warmUpState.error = err instanceof Error ? err : new Error(String(err));
      log(`Shipper MCP warm-up failed: ${warmUpState.error.message}`);
      throw warmUpState.error;
    }
  }

  function startWarmUp(): void {
    if (!warmUpPromise) {
      warmUpPromise = runWarmUp();
    }
  }

  async function awaitReady(): Promise<TextResult | null> {
    startWarmUp();
    if (!warmUpPromise) {
      return null;
    }
    const raced = await Promise.race([
      warmUpPromise.then(() => "ready" as const).catch(() => "failed" as const),
      new Promise<"timeout">((r) => setTimeout(() => r("timeout"), warmUpTimeoutMs)),
    ]);
    if (raced === "timeout") {
      const pct =
        progressPct !== null ? ` (downloading embedding model, ${progressPct}%)` : "";
      return textResult(
        `Shipper search is warming up${pct}. Try again in a moment, or run \`shipper embed start\` in a terminal.`,
      );
    }
    if (raced === "failed") {
      return errorResult(
        `Shipper search warm-up failed: ${warmUpState.error?.message ?? "unknown error"}`,
      );
    }
    return null;
  }

  server.server.oninitialized = () => {
    startWarmUp();
  };

  const filtersShape = {
    types: z.array(DOC_TYPE_ENUM).optional(),
    status: STATUS_ENUM.optional(),
    limit: z.number().int().min(1).max(25).optional(),
  };

  function toFilters(args: {
    types?: Array<"plan" | "spike" | "bug" | "review">;
    status?: "open" | "done" | "any";
    limit?: number;
  }): SearchFilters {
    const filters: SearchFilters = {};
    if (args.types) filters.types = args.types as DocType[];
    if (args.status) filters.status = args.status;
    if (args.limit !== undefined) filters.limit = args.limit;
    return filters;
  }

  server.registerTool(
    "shipper_search",
    {
      title: "Search Shipper docs",
      description:
        "Semantic search across this repo's Shipper plans, spikes, bugs, and reviews (open and done). Returns the most relevant files with matching sections and line ranges. Prefer this over grep for questions like 'have we planned/fixed something like X before?'",
      inputSchema: {
        query: z.string().min(1),
        ...filtersShape,
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const notReady = await awaitReady();
        if (notReady) return notReady;
        const repoRoot = await resolveRootOnce();
        const { index } = await syncIndexIfStale({ repoRoot, embedder });
        const queryVector = await embedder.embedQuery(args.query);
        const hits = searchIndex(index, queryVector, toFilters(args));
        return textResult(formatHits(hits), { hits });
      } catch (err: unknown) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "shipper_similar",
    {
      title: "Find similar Shipper docs",
      description:
        "Find Shipper documents similar to an existing file (for example, a likely duplicate or regression bug).",
      inputSchema: {
        path: z.string().min(1),
        ...filtersShape,
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const notReady = await awaitReady();
        if (notReady) return notReady;
        const repoRoot = await resolveRootOnce();
        const { index } = await syncIndexIfStale({ repoRoot, embedder });
        const relPath = normalize(args.path).replace(/\\/g, "/");
        const hits = findSimilar(index, relPath, toFilters(args));
        return textResult(formatHits(hits), { hits });
      } catch (err: unknown) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "shipper_get_doc",
    {
      title: "Get Shipper document",
      description:
        "Read a Shipper artifact under .shipper/ (optionally a line range). Path must resolve inside .shipper/ and end in .md.",
      inputSchema: {
        path: z.string().min(1),
        startLine: z.number().int().min(1).optional(),
        endLine: z.number().int().min(1).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const notReady = await awaitReady();
        if (notReady) return notReady;
        const repoRoot = await resolveRootOnce();
        const absPath = await resolveSafeShipperPath(repoRoot, args.path);
        const raw = await readFile(absPath, "utf8");
        const body = sliceLines(raw, args.startLine, args.endLine);
        const rel = relative(repoRoot, absPath).replace(/\\/g, "/");
        const header =
          args.startLine !== undefined || args.endLine !== undefined
            ? `${rel}:${args.startLine ?? 1}-${args.endLine ?? raw.split(/\r?\n/).length}`
            : rel;
        const text = `${header}\n\n${body}`;
        return textResult(text, { path: rel, startLine: args.startLine, endLine: args.endLine });
      } catch (err: unknown) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "shipper_list_docs",
    {
      title: "List indexed Shipper docs",
      description: "List Shipper plans, spikes, bugs, and reviews currently in the search index.",
      inputSchema: {
        types: z.array(DOC_TYPE_ENUM).optional(),
        status: STATUS_ENUM.optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const notReady = await awaitReady();
        if (notReady) return notReady;
        const repoRoot = await resolveRootOnce();
        const { index } = await syncIndexIfStale({ repoRoot, embedder });
        const text = formatDocList(index.header.files, toFilters(args));
        return textResult(text, { files: index.header.files });
      } catch (err: unknown) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "shipper_reindex",
    {
      title: "Reindex Shipper docs",
      description:
        "Build or refresh the semantic search index for this repository. Use force to rebuild from scratch.",
      inputSchema: {
        force: z.boolean().optional(),
      },
    },
    async (args) => {
      try {
        const notReady = await awaitReady();
        if (notReady) return notReady;
        const repoRoot = await resolveRootOnce();
        const { stats } = await syncIndex({
          repoRoot,
          embedder,
          force: Boolean(args.force),
        });
        const text = formatStats(stats);
        return textResult(text, { stats });
      } catch (err: unknown) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  return server;
}

export type RunMcpStdioOpts = {
  explicitDir?: string;
  cwd?: string;
  embedder?: Embedder;
  log?: (message: string) => void;
};

export async function runMcpStdio(opts: RunMcpStdioOpts = {}): Promise<void> {
  const embedder = opts.embedder ?? createLlamaEmbedder();
  const server = createShipperMcpServer({
    embedder,
    explicitDir: opts.explicitDir,
    cwd: opts.cwd,
    log: opts.log,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Warm-up starts on initialized; stay alive until stdin closes.
}
