import { splitIdentifier, type Decision } from "./cards.ts";
import type { SymbolKind } from "./extract.ts";
import type { CodeIndex, StoredSymbol } from "./store.ts";

export type SearchMode = "hybrid" | "vector" | "keyword";
export type Variant = "plain" | "labeled";

export type CodeSearchOpts = {
  k?: number;
  mode?: SearchMode;
  variant?: Variant;
  kinds?: SymbolKind[];
  roles?: string[];
  exportedOnly?: boolean;
};

export type CodeHit = {
  symbol: StoredSymbol;
  score: number;
  vectorScore: number;
  keywordScore: number;
  /** Set when a hit was re-ranked by agreement with the query's d3 labels. */
  labelAgreement?: number;
};

/** How many plain-card hits label re-ranking looks at. Deep misses still have close vector scores. */
export const LABEL_RERANK_POOL = 100;
/** Max extra weight a perfect label match can add. 0.35 keeps a clearly better hit in front. */
export const LABEL_BOOST = 0.35;

const STOPWORDS = new Set(
  "a an and are as at be by do does for from has have how i in is it its of on or our that the this to we what where which with".split(
    " ",
  ),
);
const RRF_K = 60;
const PRIOR_WEIGHT = 0.15;
const BM25_K1 = 1.2;
const BM25_B = 0.75;

export function tokenize(text: string): string[] {
  return splitIdentifier(text)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word))
    .map((word) => (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word));
}

function lexicalText(sym: StoredSymbol, variant: Variant): string {
  const parts = [sym.qualifiedName, sym.relPath, sym.signature, sym.doc, sym.uses.join(" ")];
  if (variant === "labeled" && sym.decision) {
    parts.push(sym.decision.role.key, ...sym.decision.capabilities.map((c) => c.key));
  }
  return parts.join(" ");
}

function bm25Scores(symbols: StoredSymbol[], queryTokens: string[], variant: Variant): number[] {
  const docs = symbols.map((sym) => tokenize(lexicalText(sym, variant)));
  const avgLen = docs.reduce((sum, d) => sum + d.length, 0) / Math.max(1, docs.length);
  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const term of new Set(doc)) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  const uniqueQuery = [...new Set(queryTokens)];
  return docs.map((doc) => {
    const tf = new Map<string, number>();
    for (const term of doc) {
      tf.set(term, (tf.get(term) ?? 0) + 1);
    }
    let score = 0;
    for (const term of uniqueQuery) {
      const freq = tf.get(term);
      if (!freq) {
        continue;
      }
      const n = df.get(term) ?? 0;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      score += (idf * freq * (BM25_K1 + 1)) / (freq + BM25_K1 * (1 - BM25_B + (BM25_B * doc.length) / avgLen));
    }
    return score;
  });
}

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i]! * b[i]!;
  }
  return sum;
}

/** 0..1 prior from deterministic usage, plus d3's reuse rating when the labeled variant is used. */
function prior(sym: StoredSymbol, variant: Variant): number {
  const usage = Math.min(1, Math.log1p(sym.refCount) / Math.log1p(20));
  const exported = sym.exported ? 1 : 0;
  if (variant === "labeled" && sym.decision) {
    return 0.4 * usage + 0.2 * exported + 0.4 * sym.decision.reuse;
  }
  return 0.6 * usage + 0.4 * exported;
}

function ranks(scores: number[]): number[] {
  const order = scores.map((score, i) => ({ score, i })).sort((a, b) => b.score - a.score);
  const out = new Array<number>(scores.length);
  order.forEach((entry, rank) => {
    out[entry.i] = rank + 1;
  });
  return out;
}

export function searchCode(
  index: CodeIndex,
  query: string,
  queryVector: Float32Array | null,
  opts: CodeSearchOpts = {},
): CodeHit[] {
  const mode = opts.mode ?? "hybrid";
  const variant = opts.variant ?? "labeled";
  const k = Math.max(1, opts.k ?? 10);
  if (mode !== "keyword" && !queryVector) {
    throw new Error(`${mode} search needs a query vector`);
  }

  const candidates: number[] = [];
  index.symbols.forEach((sym, i) => {
    if (opts.kinds?.length && !opts.kinds.includes(sym.kind)) {
      return;
    }
    if (opts.roles?.length && !(sym.decision && opts.roles.includes(sym.decision.role.key))) {
      return;
    }
    if (opts.exportedOnly && !sym.exported) {
      return;
    }
    candidates.push(i);
  });
  if (candidates.length === 0) {
    return [];
  }

  const symbols = candidates.map((i) => index.symbols[i]!);
  const vectors = variant === "labeled" ? index.labeled : index.plain;
  const vectorScores = queryVector
    ? candidates.map((i) => dot(queryVector, vectors.subarray(i * index.dims, (i + 1) * index.dims)))
    : candidates.map(() => 0);
  const keywordScores = bm25Scores(symbols, tokenize(query), variant);

  let scores: number[];
  if (mode === "vector") {
    scores = vectorScores;
  } else if (mode === "keyword") {
    scores = keywordScores;
  } else {
    const vectorRanks = ranks(vectorScores);
    const keywordRanks = ranks(keywordScores);
    scores = symbols.map((sym, j) => {
      const keywordPart = keywordScores[j]! > 0 ? 1 / (RRF_K + keywordRanks[j]!) : 0;
      const rrf = 1 / (RRF_K + vectorRanks[j]!) + keywordPart;
      return rrf * (1 + PRIOR_WEIGHT * prior(sym, variant));
    });
  }

  return symbols
    .map((symbol, j) => ({
      symbol,
      score: scores[j]!,
      vectorScore: vectorScores[j]!,
      keywordScore: keywordScores[j]!,
    }))
    .filter((hit) => mode !== "keyword" || hit.keywordScore > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/** 0..1 overlap of role, side effects, and capabilities, weighted by both sides' confidence. */
export function labelAgreement(query: Decision, symbol: Decision): number {
  const role = query.role.key === symbol.role.key ? query.role.p * symbol.role.p : 0;
  const effects = query.effects.key === symbol.effects.key ? query.effects.p * symbol.effects.p : 0;
  let capability = 0;
  for (const wanted of query.capabilities) {
    const found = symbol.capabilities.find((cap) => cap.key === wanted.key);
    if (found) {
      capability += wanted.p * found.p;
    }
  }
  return (role + effects + Math.min(1, capability)) / 3;
}

/** Multiply retrieval score by a small factor when labels agree. Order is unchanged when they do not. */
export function rerankByLabels(hits: CodeHit[], query: Decision, weight = LABEL_BOOST): CodeHit[] {
  return hits
    .map((hit) => {
      const agreement = hit.symbol.decision ? labelAgreement(query, hit.symbol.decision) : 0;
      return { ...hit, labelAgreement: agreement, score: hit.score * (1 + weight * agreement) };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Keep retrieval order, but move symbols that share a query capability ahead of those that do not.
 * An empty query capability list leaves the list as it is.
 */
export function orderByCapability(hits: CodeHit[], query: Decision): CodeHit[] {
  const wanted = new Set(query.capabilities.map((cap) => cap.key));
  if (wanted.size === 0) {
    return hits;
  }
  const matches: CodeHit[] = [];
  const rest: CodeHit[] = [];
  for (const hit of hits) {
    const caps = hit.symbol.decision?.capabilities.map((cap) => cap.key) ?? [];
    if (caps.some((key) => wanted.has(key))) {
      matches.push(hit);
    } else {
      rest.push(hit);
    }
  }
  return [...matches, ...rest];
}

export function formatCodeHits(hits: CodeHit[]): string {
  if (hits.length === 0) {
    return "No results.";
  }
  return hits
    .map((hit, i) => {
      const sym = hit.symbol;
      const labels = hit.labelAgreement === undefined ? "" : `, labels ${hit.labelAgreement.toFixed(2)}`;
      const lines = [
        `${i + 1}. ${sym.qualifiedName} — ${sym.relPath}:${sym.startLine}-${sym.endLine} (${sym.kind}${sym.exported ? ", exported" : ""}) score ${hit.score.toFixed(4)} [vector ${hit.vectorScore.toFixed(3)}, keyword ${hit.keywordScore.toFixed(2)}${labels}]`,
        `   ${sym.signature}`,
      ];
      const facts: string[] = [];
      if (sym.decision) {
        const d = sym.decision;
        facts.push(`role ${d.role.key}`);
        if (d.capabilities.length > 0) {
          facts.push(`capabilities ${d.capabilities.map((c) => `${c.key} ${c.p.toFixed(2)}`).join(", ")}`);
        }
        facts.push(`effects ${d.effects.key}`, `reuse ${d.reuse.toFixed(2)}`, `convention ${d.convention.toFixed(2)}`);
      }
      if (sym.refCount > 0) {
        facts.push(`used in ${sym.refCount} files`);
      }
      if (facts.length > 0) {
        lines.push(`   ${facts.join(" · ")}`);
      }
      if (sym.doc) {
        lines.push(`   ${sym.doc.replace(/\s+/g, " ").slice(0, 200)}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");
}
