import { Command } from "commander";
import { readFile, realpath } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { createLlamaEmbedder } from "../embeddings/client.ts";
import { resolveRepoRoot } from "../search/repo-root.ts";
import { decisionState, type Decision } from "./cards.ts";
import { D3_MODELS, D3_UBATCH_TOKENS, type D3Quant } from "./constants.ts";
import { classifyQuery, stateCharBudget } from "./decisions.ts";
import { startD3Server } from "./d3-runtime.ts";
import { EVAL_CONFIGS, formatEval, loadEvalCases, runEval, unmatchedExpectations } from "./eval.ts";
import { extractSymbols, type SymbolKind } from "./extract.ts";
import { buildCodeIndex, selectSymbols, type D3Config } from "./indexer.ts";
import {
  LABEL_RERANK_POOL,
  formatCodeHits,
  orderByCapability,
  rerankByLabels,
  searchCode,
  type SearchMode,
  type Variant,
} from "./search.ts";
import { readCodeIndex, type CodeIndex } from "./store.ts";
import { buildQueryQuestions, buildQuestions, buildTaxonomy, loadTaxonomy } from "./taxonomy.ts";

// The shared embedding daemon re-invokes `process.argv[1] embed`, which must be Shipper's CLI.
process.argv[1] = resolve(import.meta.dir, "../index.ts");

function positiveInt(name: string) {
  return (value: string) => {
    const n = Number.parseInt(value, 10);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`${name} must be a positive integer, got ${value}`);
    }
    return n;
  };
}

function list(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function status(line: string): void {
  process.stderr.write(`${line}\n`);
}

function quantFromModelId(modelId: string | null): D3Quant {
  const match = (Object.keys(D3_MODELS) as D3Quant[]).find((quant) => D3_MODELS[quant].id === modelId);
  return match ?? "q8";
}

function formatQueryDecision(decision: Decision): string {
  const caps = decision.capabilities.map((cap) => cap.key).join(", ") || "(none)";
  return `${decision.role.key} / ${caps} / ${decision.effects.key}`;
}

/** Classify each query with the same d3 server that labeled the index. */
async function classifyQueries(index: CodeIndex, queries: string[]): Promise<Decision[]> {
  const taxonomy = buildTaxonomy();
  if (index.taxonomyHash !== taxonomy.hash) {
    status("Warning: index taxonomy differs from the default, so query labels may not match symbol labels");
  }
  const server = await startD3Server({
    quant: quantFromModelId(index.d3ModelId),
    parallel: 4,
    ubatchTokens: D3_UBATCH_TOKENS,
    onStatus: status,
  });
  try {
    const questions = buildQueryQuestions(taxonomy);
    const decisions: Decision[] = [];
    for (const query of queries) {
      const decision = await classifyQuery({ baseUrl: server.baseUrl, query, questions });
      decisions.push(decision);
      status(`  ${formatQueryDecision(decision)}  ${query}`);
    }
    return decisions;
  } finally {
    await server.stop();
  }
}

async function repoRootFrom(cmd: Command): Promise<string> {
  const { dir } = cmd.optsWithGlobals() as { dir?: string };
  return resolveRepoRoot({ explicitDir: dir, cwd: process.cwd() });
}

async function loadIndexOrExit(repoRoot: string): Promise<CodeIndex> {
  const index = await readCodeIndex(await realpath(repoRoot));
  if (!index) {
    throw new Error(`No code index for ${repoRoot}. Run \`bun run code-index index\` first.`);
  }
  return index;
}

function d3Config(opts: { d3: string; d3Model?: string; quant: string; parallel: number }): D3Config {
  if (opts.d3 === "off") {
    return { mode: "off" };
  }
  if (opts.d3 === "managed") {
    if (opts.quant !== "q8" && opts.quant !== "q4") {
      throw new Error(`--quant must be q8 or q4, got ${opts.quant}`);
    }
    return { mode: "managed", quant: opts.quant as D3Quant, parallel: opts.parallel };
  }
  if (/^https?:\/\//.test(opts.d3)) {
    return { mode: "url", url: opts.d3, model: opts.d3Model, parallel: opts.parallel };
  }
  throw new Error(`--d3 must be managed, off, or an http(s) URL, got ${opts.d3}`);
}

async function run(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (err: unknown) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

const program = new Command();
program
  .name("code-index")
  .description("Experimental: index code symbols with deterministic extraction + the d3 decision model")
  .option("--dir <path>", "repository to index (defaults to the current directory)");

program
  .command("index")
  .description("extract symbols, label them with d3, and embed them")
  .option("--d3 <mode>", "managed (private llama-server), off, or a /v1/systemone server URL", "managed")
  .option("--d3-model <name>", "model name to send to a d3 server URL (for example `d3` on Ollama)")
  .option("--quant <q8|q4>", "d3-mini GGUF quantization for --d3 managed", "q8")
  .option("--parallel <n>", "concurrent d3 requests (and llama-server slots)", positiveInt("--parallel"), 4)
  .option("--taxonomy <file>", 'JSON file with { "capabilities": { key: description } }')
  .option("--paths <prefixes>", "comma-separated repo-relative directories to index")
  .option("--include-tests", "index test files too")
  .option("--all", "index every extracted symbol, not just exported or substantial ones")
  .option("--limit <n>", "index at most n symbols (quick trial runs)", positiveInt("--limit"))
  .option("--force", "ignore cached decisions and vectors")
  .action(
    async (
      opts: {
        d3: string;
        d3Model?: string;
        quant: string;
        parallel: number;
        taxonomy?: string;
        paths?: string;
        includeTests?: boolean;
        all?: boolean;
        limit?: number;
        force?: boolean;
      },
      cmd: Command,
    ) =>
      run(async () => {
        const repoRoot = await repoRootFrom(cmd);
        const { stats, path } = await buildCodeIndex({
          repoRoot,
          embedder: createLlamaEmbedder(),
          taxonomy: await loadTaxonomy(opts.taxonomy),
          d3: d3Config(opts),
          includeTests: opts.includeTests,
          paths: opts.paths ? list(opts.paths) : undefined,
          all: opts.all,
          limit: opts.limit,
          force: opts.force,
          onStatus: status,
        });
        const modes = Object.entries(stats.modes)
          .filter(([, n]) => n > 0)
          .map(([mode, n]) => `${mode} ${n}`)
          .join(", ");
        console.log(
          [
            `Indexed ${stats.symbols} symbols (${stats.extracted} extracted) from ${stats.files} files in ${(stats.ms / 1000).toFixed(1)}s`,
            `d3: ${stats.d3Asked} labeled, ${stats.d3Reused} cached, ${stats.d3Failed} failed` +
              (stats.d3Asked > 0
                ? ` · ${(stats.d3WallMs / 1000).toFixed(1)}s wall, ${stats.d3AvgMs} ms per symbol per request`
                : ""),
            modes ? `d3 input: ${modes}` : null,
            `embeddings: ${stats.embedded} computed, ${stats.embedReused} cached`,
            path,
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }),
  );

program
  .command("search")
  .description("search indexed code symbols")
  .argument("<query...>", "natural-language query")
  .option("--k <n>", "number of results", positiveInt("--k"), 10)
  .option("--mode <mode>", "hybrid, vector, or keyword", "hybrid")
  .option("--variant <variant>", "labeled (with d3 labels) or plain", "labeled")
  .option("--kind <kinds>", "comma-separated kinds: function,component,hook,class,method,interface,type,enum,const")
  .option("--role <roles>", "comma-separated d3 roles, e.g. utility,service")
  .option("--exported", "only exported symbols")
  .option("--rerank <mode>", "re-rank a plain shortlist with d3 labels: capability or boost")
  .option("--json", "print JSON")
  .action(
    async (
      queryParts: string[],
      opts: {
        k: number;
        mode: string;
        variant: string;
        kind?: string;
        role?: string;
        exported?: boolean;
        rerank?: string;
        json?: boolean;
      },
      cmd: Command,
    ) =>
      run(async () => {
        const query = queryParts.join(" ").trim();
        if (!["hybrid", "vector", "keyword"].includes(opts.mode)) {
          throw new Error(`--mode must be hybrid, vector, or keyword, got ${opts.mode}`);
        }
        if (opts.variant !== "labeled" && opts.variant !== "plain") {
          throw new Error(`--variant must be labeled or plain, got ${opts.variant}`);
        }
        if (opts.rerank && opts.rerank !== "capability" && opts.rerank !== "boost") {
          throw new Error(`--rerank must be capability or boost, got ${opts.rerank}`);
        }
        const index = await loadIndexOrExit(await repoRootFrom(cmd));
        const mode = opts.mode as SearchMode;
        const vector = mode === "keyword" ? null : await createLlamaEmbedder().embedQuery(query);
        const hits = searchCode(index, query, vector, {
          k: opts.rerank ? Math.max(opts.k, LABEL_RERANK_POOL) : opts.k,
          mode,
          variant: opts.rerank ? "plain" : (opts.variant as Variant),
          kinds: opts.kind ? (list(opts.kind) as SymbolKind[]) : undefined,
          roles: opts.role ? list(opts.role) : undefined,
          exportedOnly: opts.exported,
        });
        let ranked = hits;
        if (opts.rerank) {
          if (!index.symbols.some((sym) => sym.decision)) {
            throw new Error("This index has no d3 labels. Run `bun run code-index index` first.");
          }
          const [decision] = await classifyQueries(index, [query]);
          if (!decision) {
            throw new Error("d3 returned no decision for the query");
          }
          status(`query labels: ${formatQueryDecision(decision)}`);
          const reranked = opts.rerank === "boost" ? rerankByLabels(hits, decision) : orderByCapability(hits, decision);
          ranked = reranked.slice(0, opts.k);
        }
        console.log(opts.json ? JSON.stringify(ranked, null, 2) : formatCodeHits(ranked));
      }),
  );

program
  .command("eval")
  .description("score search configurations against a JSON file of { query, expect } cases")
  .argument("<file>", 'JSON array: [{ "query": "...", "expect": ["src/file.ts#symbol"] }]')
  .action(async (file: string, _opts: unknown, cmd: Command) =>
    run(async () => {
      const index = await loadIndexOrExit(await repoRootFrom(cmd));
      const cases = await loadEvalCases(resolve(file));
      const missing = unmatchedExpectations(index, cases);
      if (missing.length > 0) {
        status(`Warning: ${missing.length} expectation(s) match no indexed symbol: ${missing.join(", ")}`);
      }
      const embedder = createLlamaEmbedder();
      const withVectors = [];
      for (const c of cases) {
        withVectors.push({ ...c, vector: await embedder.embedQuery(c.query) });
      }
      const labeled = index.symbols.filter((sym) => sym.decision).length;
      status(`${cases.length} queries over ${index.symbols.length} symbols (${labeled} with d3 labels)`);
      const decisions = labeled > 0 ? await classifyQueries(index, cases.map((c) => c.query)) : null;
      const configs = decisions ? EVAL_CONFIGS : EVAL_CONFIGS.filter((config) => !config.rerank);
      const scored = withVectors.map((c, i) => ({ ...c, decision: decisions?.[i] ?? null }));
      console.log(formatEval(runEval(index, scored, configs)));
    }),
  );

program
  .command("inspect")
  .description("show extracted symbols and the d3 input for one file (no models needed)")
  .argument("<file>", "source file")
  .option("--state", "print each symbol's full d3 state")
  .option("--taxonomy <file>", "taxonomy JSON (affects the state budget)")
  .action(async (file: string, opts: { state?: boolean; taxonomy?: string }, cmd: Command) =>
    run(async () => {
      const repoRoot = await repoRootFrom(cmd);
      const absPath = resolve(file);
      const relPath = relative(repoRoot, absPath);
      const symbols = extractSymbols(relPath, await readFile(absPath, "utf8"));
      const selected = new Set(selectSymbols(symbols).map((sym) => sym.id));
      const budget = stateCharBudget(buildQuestions(await loadTaxonomy(opts.taxonomy)), D3_UBATCH_TOKENS);
      console.log(`${relPath}: ${symbols.length} symbols, state budget ${budget} chars (${D3_UBATCH_TOKENS}-token ubatch)`);
      for (const sym of symbols) {
        const state = decisionState(sym, budget);
        console.log(
          `\n${selected.has(sym.id) ? "+" : "-"} ${sym.qualifiedName} (${sym.kind}${sym.exported ? ", exported" : ""}) lines ${sym.startLine}-${sym.endLine} · state ${state.text.length} chars, ${state.mode}`,
        );
        if (sym.uses.length > 0) {
          console.log(`  uses: ${sym.uses.join(", ")}`);
        }
        if (opts.state) {
          console.log(state.text.replace(/^/gm, "  | "));
        }
      }
    }),
  );

program
  .command("stats")
  .description("summarize the code index: kinds, d3 roles, and capability coverage")
  .action(async (_opts: unknown, cmd: Command) =>
    run(async () => {
      const index = await loadIndexOrExit(await repoRootFrom(cmd));
      const count = (values: string[]) => {
        const counts = new Map<string, number>();
        for (const v of values) {
          counts.set(v, (counts.get(v) ?? 0) + 1);
        }
        return [...counts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([k, n]) => `  ${String(n).padStart(5)}  ${k}`)
          .join("\n");
      };
      const labeled = index.symbols.filter((sym) => sym.decision);
      console.log(`${index.symbols.length} symbols · ${labeled.length} labeled by ${index.d3ModelId ?? "no d3"} · updated ${index.updatedAt}`);
      console.log(`\nKinds:\n${count(index.symbols.map((s) => s.kind))}`);
      if (labeled.length > 0) {
        console.log(`\nRoles:\n${count(labeled.map((s) => s.decision!.role.key))}`);
        console.log(`\nTop capability:\n${count(labeled.map((s) => s.decision!.capabilities[0]?.key ?? "(other)"))}`);
        console.log(`\nd3 input size:\n${count(labeled.map((s) => s.mode ?? "?"))}`);
      }
      console.log(`\n${join(index.repoPath)}`);
    }),
  );

await program.parseAsync(process.argv);
