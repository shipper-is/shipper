import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Decision } from "./cards.ts";
import { formatEval, matchesExpectation, runEval, unmatchedExpectations } from "./eval.ts";
import { labelAgreement, orderByCapability, rerankByLabels, searchCode, tokenize } from "./search.ts";
import { normalize, readCodeIndex, writeCodeIndex, type CodeIndex, type StoredSymbol } from "./store.ts";

function stored(name: string, relPath: string, overrides: Partial<StoredSymbol> = {}): StoredSymbol {
  return {
    id: `${relPath}#${name}`,
    relPath,
    name,
    qualifiedName: name,
    kind: "function",
    exported: true,
    startLine: 1,
    endLine: 5,
    signature: `export function ${name}()`,
    doc: "",
    uses: [],
    refCount: 0,
    preview: "",
    stateHash: null,
    mode: null,
    decision: null,
    plainHash: name,
    labeledHash: name,
    ...overrides,
  };
}

/** Three symbols on orthogonal axes so vector scores are easy to reason about. */
function fixture(): CodeIndex {
  const symbols = [
    stored("toMoneyString", "src/lib/format.ts", {
      refCount: 12,
      decision: {
        role: { key: "utility", p: 0.9 },
        capabilities: [{ key: "formatting", p: 0.9 }],
        effects: { key: "pure", p: 0.9 },
        reuse: 1,
        convention: 1,
      },
    }),
    stored("readConfig", "src/core/config.ts", { kind: "function" }),
    stored("Button", "src/ui/button.tsx", { kind: "component", exported: false }),
  ];
  const dims = 3;
  const plain = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const labeled = new Float32Array([0.9, 0.1, 0, 0, 1, 0, 0, 0, 1]);
  return {
    formatVersion: 1,
    version: 1,
    repoPath: "/repo",
    embedModelId: "test",
    dims,
    d3ModelId: "d3",
    taxonomyHash: "t",
    updatedAt: "now",
    symbols,
    plain,
    labeled: Float32Array.from(
      [0, 1, 2].flatMap((i) => [...normalize(labeled.subarray(i * dims, (i + 1) * dims))]),
    ),
  };
}

describe("tokenize", () => {
  it("splits identifiers, drops stopwords, and strips plurals", () => {
    expect(tokenize("Where do we format prices? toMoneyString")).toEqual(["format", "price", "money", "string"]);
  });
});

describe("searchCode", () => {
  it("matches split identifier words in keyword mode", () => {
    const hits = searchCode(fixture(), "money string", null, { mode: "keyword" });
    expect(hits.map((h) => h.symbol.name)).toEqual(["toMoneyString"]);
  });

  it("matches d3 capability labels only in the labeled variant", () => {
    const index = fixture();
    expect(searchCode(index, "formatting", null, { mode: "keyword", variant: "plain" })).toEqual([]);
    expect(
      searchCode(index, "formatting", null, { mode: "keyword", variant: "labeled" }).map((h) => h.symbol.name),
    ).toEqual(["toMoneyString"]);
  });

  it("ranks by cosine in vector mode and applies filters", () => {
    const index = fixture();
    const query = new Float32Array([0, 1, 0]);
    expect(searchCode(index, "", query, { mode: "vector" })[0]!.symbol.name).toBe("readConfig");
    const components = searchCode(index, "", query, { mode: "vector", kinds: ["component"] });
    expect(components.map((h) => h.symbol.name)).toEqual(["Button"]);
    expect(searchCode(index, "", query, { mode: "vector", exportedOnly: true }).map((h) => h.symbol.name)).not.toContain(
      "Button",
    );
    expect(searchCode(index, "", query, { mode: "vector", roles: ["utility"] }).map((h) => h.symbol.name)).toEqual([
      "toMoneyString",
    ]);
  });

  it("fuses vector and keyword ranks in hybrid mode", () => {
    const hits = searchCode(fixture(), "button", new Float32Array([0, 1, 0]), { mode: "hybrid" });
    expect(hits[0]!.symbol.name).toBe("Button");
  });
});

describe("label re-rank", () => {
  const query: Decision = {
    role: { key: "service", p: 1 },
    capabilities: [{ key: "filesystem", p: 1 }],
    effects: { key: "filesystem", p: 1 },
    reuse: 0,
    convention: 0,
  };

  function withService(): CodeIndex {
    const index = fixture();
    index.symbols[1] = { ...index.symbols[1]!, decision: query };
    return index;
  }

  it("scores shared labels and ignores a mismatch", () => {
    const index = withService();
    expect(labelAgreement(query, index.symbols[1]!.decision!)).toBe(1);
    expect(labelAgreement(query, index.symbols[0]!.decision!)).toBe(0);
  });

  it("boosts a close neighbor that shares labels and leaves a wide gap alone", () => {
    const index = withService();
    const close = searchCode(index, "load", new Float32Array([0.8, 0.6, 0]), {
      mode: "vector",
      variant: "plain",
      k: 3,
    });
    expect(close[0]!.symbol.name).toBe("toMoneyString");
    expect(rerankByLabels(close, query)[0]!.symbol.name).toBe("readConfig");

    const wide = searchCode(index, "load", new Float32Array([1, 0.2, 0]), { mode: "vector", variant: "plain", k: 3 });
    expect(rerankByLabels(wide, query)[0]!.symbol.name).toBe("toMoneyString");
  });

  it("moves capability matches ahead without reordering inside each group", () => {
    const index = withService();
    const hits = searchCode(index, "", new Float32Array([1, 0, 0]), { mode: "vector", variant: "plain", k: 3 });
    expect(hits.map((hit) => hit.symbol.name)).toEqual(["toMoneyString", "readConfig", "Button"]);
    expect(orderByCapability(hits, query).map((hit) => hit.symbol.name)).toEqual([
      "readConfig",
      "toMoneyString",
      "Button",
    ]);
    expect(orderByCapability(hits, { ...query, capabilities: [] }).map((hit) => hit.symbol.name)).toEqual(
      hits.map((hit) => hit.symbol.name),
    );
  });
});

describe("eval", () => {
  it("scores each configuration and reports unmatched expectations", () => {
    const index = fixture();
    expect(matchesExpectation(index.symbols[0]!, "src/lib/format.ts")).toBe(true);
    expect(matchesExpectation(index.symbols[0]!, "src/lib/format.ts#toMoneyString")).toBe(true);
    expect(matchesExpectation(index.symbols[0]!, "src/lib/format.ts#other")).toBe(false);
    expect(unmatchedExpectations(index, [{ query: "q", expect: ["src/missing.ts#x"] }])).toEqual(["src/missing.ts#x"]);

    const rows = runEval(index, [
      { query: "money string", expect: ["src/lib/format.ts#toMoneyString"], vector: new Float32Array([1, 0, 0]) },
      { query: "load settings", expect: ["src/core/config.ts"], vector: new Float32Array([0, 1, 0]) },
    ]);
    const vectorPlain = rows.find((r) => r.label === "vector, plain cards")!;
    expect(vectorPlain.hitAt1).toBe(1);
    expect(vectorPlain.mrr).toBe(1);
    const keyword = rows.find((r) => r.label === "keyword only")!;
    expect(keyword.ranks.map((r) => r.rank)).toEqual([1, null]);
    expect(formatEval(rows)).toContain("hybrid, d3-labeled cards");
  });

  it("uses a query decision to move a plain-card miss up", () => {
    const index = fixture();
    const decision: Decision = {
      role: { key: "service", p: 1 },
      capabilities: [{ key: "filesystem", p: 1 }],
      effects: { key: "filesystem", p: 1 },
      reuse: 0,
      convention: 0,
    };
    index.symbols[1] = { ...index.symbols[1]!, decision };
    const rows = runEval(index, [
      {
        query: "load settings",
        expect: ["src/core/config.ts"],
        vector: new Float32Array([0.8, 0.6, 0]),
        decision,
      },
    ]);
    expect(rows.find((row) => row.label === "vector, plain cards")!.ranks[0]!.rank).toBe(2);
    expect(rows.find((row) => row.label === "vector plain + label boost")!.ranks[0]!.rank).toBe(1);
    expect(rows.find((row) => row.label === "vector plain + capability first")!.ranks[0]!.rank).toBe(1);
  });
});

describe("store", () => {
  let cache: string;
  let previous: string | undefined;

  beforeEach(async () => {
    cache = await mkdtemp(join(tmpdir(), "shipper-code-index-"));
    previous = process.env["XDG_CACHE_HOME"];
    process.env["XDG_CACHE_HOME"] = cache;
  });

  afterEach(async () => {
    if (previous === undefined) {
      delete process.env["XDG_CACHE_HOME"];
    } else {
      process.env["XDG_CACHE_HOME"] = previous;
    }
    await rm(cache, { recursive: true, force: true });
  });

  it("round-trips metadata and both vector variants", async () => {
    const index = fixture();
    await writeCodeIndex(index);
    const loaded = await readCodeIndex("/repo");
    expect(loaded?.symbols.map((s) => s.name)).toEqual(["toMoneyString", "readConfig", "Button"]);
    expect([...loaded!.plain]).toEqual([...index.plain]);
    expect([...loaded!.labeled]).toEqual([...index.labeled]);
  });
});
