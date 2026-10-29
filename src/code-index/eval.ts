import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Decision } from "./cards.ts";
import {
  LABEL_RERANK_POOL,
  orderByCapability,
  rerankByLabels,
  searchCode,
  type SearchMode,
  type Variant,
} from "./search.ts";
import type { CodeIndex, StoredSymbol } from "./store.ts";

const evalFileSchema = z.array(
  z.object({
    query: z.string().min(1),
    /** `path` (any symbol in the file) or `path#Name` / `path#Class.method`. */
    expect: z.array(z.string().min(1)).min(1),
  }),
);

export type EvalCase = z.infer<typeof evalFileSchema>[number];

export async function loadEvalCases(path: string): Promise<EvalCase[]> {
  return evalFileSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

export function matchesExpectation(sym: StoredSymbol, expectation: string): boolean {
  const hash = expectation.indexOf("#");
  const path = hash === -1 ? expectation : expectation.slice(0, hash);
  const name = hash === -1 ? null : expectation.slice(hash + 1);
  if (sym.relPath !== path) {
    return false;
  }
  return name === null || sym.qualifiedName === name || sym.name === name;
}

/** Expectations that no indexed symbol satisfies — usually a typo or a symbol filtered out of the index. */
export function unmatchedExpectations(index: CodeIndex, cases: EvalCase[]): string[] {
  const missing = new Set<string>();
  for (const c of cases) {
    for (const expectation of c.expect) {
      if (!index.symbols.some((sym) => matchesExpectation(sym, expectation))) {
        missing.add(expectation);
      }
    }
  }
  return [...missing];
}

export type Rerank = "boost" | "capability-first";

export type EvalConfig = { label: string; mode: SearchMode; variant: Variant; rerank?: Rerank };

export const EVAL_CONFIGS: EvalConfig[] = [
  { label: "keyword only", mode: "keyword", variant: "plain" },
  { label: "vector, plain cards", mode: "vector", variant: "plain" },
  { label: "vector, d3-labeled cards", mode: "vector", variant: "labeled" },
  { label: "hybrid, plain cards", mode: "hybrid", variant: "plain" },
  { label: "hybrid, d3-labeled cards", mode: "hybrid", variant: "labeled" },
  { label: "vector plain + label boost", mode: "vector", variant: "plain", rerank: "boost" },
  { label: "vector plain + capability first", mode: "vector", variant: "plain", rerank: "capability-first" },
  { label: "hybrid plain + label boost", mode: "hybrid", variant: "plain", rerank: "boost" },
  { label: "hybrid plain + capability first", mode: "hybrid", variant: "plain", rerank: "capability-first" },
];

export type EvalRow = {
  label: string;
  hitAt1: number;
  hitAt5: number;
  hitAt10: number;
  mrr: number;
  /** Query → 1-based rank of the first expected symbol, or null when not in the top 10. */
  ranks: Array<{ query: string; rank: number | null }>;
};

const K = 10;

export function runEval(
  index: CodeIndex,
  cases: Array<EvalCase & { vector: Float32Array; decision?: Decision | null }>,
  configs: EvalConfig[] = EVAL_CONFIGS,
): EvalRow[] {
  return configs.map((config) => {
    const ranks = cases.map((c) => {
      const hits = searchCode(index, c.query, c.vector, {
        k: config.rerank ? LABEL_RERANK_POOL : K,
        mode: config.mode,
        variant: config.variant,
      });
      const reranked =
        config.rerank && c.decision
          ? config.rerank === "boost"
            ? rerankByLabels(hits, c.decision)
            : orderByCapability(hits, c.decision)
          : hits;
      const top = reranked.slice(0, K);
      const position = top.findIndex((hit) => c.expect.some((e) => matchesExpectation(hit.symbol, e)));
      return { query: c.query, rank: position === -1 ? null : position + 1 };
    });
    const n = Math.max(1, cases.length);
    const within = (limit: number) => ranks.filter((r) => r.rank !== null && r.rank <= limit).length / n;
    return {
      label: config.label,
      hitAt1: within(1),
      hitAt5: within(5),
      hitAt10: within(10),
      mrr: ranks.reduce((sum, r) => sum + (r.rank ? 1 / r.rank : 0), 0) / n,
      ranks,
    };
  });
}

function pct(value: number): string {
  return `${(value * 100).toFixed(0)}%`.padStart(5);
}

export function formatEval(rows: EvalRow[]): string {
  const width = Math.max(...rows.map((r) => r.label.length));
  const header = `${"configuration".padEnd(width)}  hit@1  hit@5 hit@10   MRR`;
  const lines = rows.map(
    (r) => `${r.label.padEnd(width)}  ${pct(r.hitAt1)}  ${pct(r.hitAt5)}  ${pct(r.hitAt10)}  ${r.mrr.toFixed(2)}`,
  );
  const queries = rows[0]?.ranks.map((r) => r.query) ?? [];
  const detail = queries.map((query, qi) => {
    const cells = rows.map((row) => {
      const rank = row.ranks[qi]?.rank;
      return (rank === null || rank === undefined ? "–" : String(rank)).padStart(3);
    });
    return `${cells.join(" ")}  ${query}`;
  });
  return [
    header,
    ...lines,
    "",
    `Rank of first expected symbol per query (columns in the order above; – = not in top ${K}):`,
    ...detail,
  ].join("\n");
}
