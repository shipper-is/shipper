import { describe, expect, it, vi } from "vitest";
import { D3RequestError, askD3, systemOneUrl, type D3Answer } from "./d3-client.ts";
import { decideSymbol, stateCharBudget, toDecision, toQueryDecision } from "./decisions.ts";
import type { CodeSymbol } from "./extract.ts";
import { buildQueryQuestions, buildQuestions, buildTaxonomy } from "./taxonomy.ts";

const questions = buildQuestions(buildTaxonomy());

function answers(capabilities: Record<string, number>, choice = "formatting"): Record<string, D3Answer> {
  return {
    role: { type: "choice", choice: "utility", probabilities: { utility: 0.8, service: 0.2 } },
    capability: { type: "choice", choice, probabilities: capabilities },
    effects: { type: "choice", choice: "pure", probabilities: { pure: 0.9, mixed: 0.1 } },
    reuse: { type: "score", score: 3, probabilities: {} },
    convention: { type: "score", score: 1, probabilities: {} },
  };
}

const sym: CodeSymbol = {
  id: "src/a.ts#big",
  relPath: "src/a.ts",
  name: "big",
  qualifiedName: "big",
  kind: "function",
  exported: true,
  startLine: 1,
  endLine: 500,
  signature: "export function big()",
  doc: "",
  body: Array.from({ length: 500 }, (_, i) => `  step(${i});`).join("\n"),
  members: [],
  uses: [],
  refCount: 0,
};

describe("toDecision", () => {
  it("normalizes scores and keeps confident capabilities, ignoring other", () => {
    const decision = toDecision(
      answers({ formatting: 0.6, other: 0.25, "string-text": 0.13, parsing: 0.02 }),
      questions,
    );
    expect(decision.role).toEqual({ key: "utility", p: 0.8 });
    expect(decision.capabilities.map((c) => c.key)).toEqual(["formatting", "string-text"]);
    expect(decision.reuse).toBeCloseTo(3 / 4);
    expect(decision.convention).toBeCloseTo(1 / 2);
  });

  it("drops weak capabilities when d3 picked other", () => {
    const decision = toDecision(answers({ other: 0.9, formatting: 0.05 }, "other"), questions);
    expect(decision.capabilities).toEqual([]);
  });
});

describe("toQueryDecision", () => {
  it("keeps role, capability, and effects, and leaves reuse unused", () => {
    const queryQuestions = buildQueryQuestions(buildTaxonomy());
    expect(Object.keys(queryQuestions).sort()).toEqual(["capability", "effects", "role"]);
    const decision = toQueryDecision(answers({ "hashing-ids": 0.7, filesystem: 0.2 }));
    expect(decision.role.key).toBe("utility");
    expect(decision.capabilities.map((cap) => cap.key)).toEqual(["hashing-ids", "filesystem"]);
    expect(decision.effects.key).toBe("pure");
    expect(decision.reuse).toBe(0);
    expect(decision.convention).toBe(0);
  });
});

describe("stateCharBudget", () => {
  it("leaves room for the largest question inside the micro-batch", () => {
    const budget = stateCharBudget(questions, 4096);
    expect(budget).toBeGreaterThan(5000);
    expect(budget).toBeLessThan(4096 * 2.8);
  });
});

describe("decideSymbol", () => {
  it("shrinks the state and retries when the server rejects a prompt", async () => {
    const sizes: number[] = [];
    const ask = vi.fn(async (opts: { state: string }) => {
      sizes.push(opts.state.length);
      if (opts.state.length > 2000) {
        throw new D3RequestError("too long", 400, "prompt does not fit in the micro-batch");
      }
      return { answers: answers({ formatting: 0.9 }), inputTokens: 500 };
    });
    const result = await decideSymbol({
      baseUrl: "http://127.0.0.1:1",
      symbol: sym,
      questions,
      stateChars: 6000,
      ask: ask as unknown as typeof askD3,
    });
    expect(result.attempts).toBeGreaterThan(1);
    expect(result.mode).toBe("excerpt");
    expect(sizes[0]).toBeGreaterThan(2000);
    expect(sizes.at(-1)).toBeLessThanOrEqual(2000);
  });

  it("does not retry when the server is not a decision model", async () => {
    const ask = vi.fn(async () => {
      throw new D3RequestError("not a decision model", 501, "");
    });
    await expect(
      decideSymbol({ baseUrl: "x", symbol: sym, questions, stateChars: 6000, ask: ask as unknown as typeof askD3 }),
    ).rejects.toThrow("not a decision model");
    expect(ask).toHaveBeenCalledTimes(1);
  });
});

describe("askD3", () => {
  it("posts state and questions to /v1/systemone and validates answers", async () => {
    const fetchFn = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () =>
      Response.json({ answers: answers({ formatting: 1 }), usage: { input_tokens: 42 } }),
    );
    const result = await askD3({ baseUrl: "http://127.0.0.1:9/", state: "s", questions, model: "d3", fetchFn });
    expect(result.inputTokens).toBe(42);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:9/v1/systemone");
    expect(JSON.parse(init!.body as string)).toMatchObject({ state: "s", model: "d3" });
  });

  it("raises D3RequestError with the status on failure", async () => {
    const fetchFn = async () => new Response("bad", { status: 400, statusText: "Bad Request" });
    await expect(askD3({ baseUrl: "http://x", state: "s", questions, fetchFn })).rejects.toMatchObject({
      status: 400,
    });
  });

  it("accepts a full endpoint URL", () => {
    expect(systemOneUrl("http://localhost:11434/v1/systemone")).toBe("http://localhost:11434/v1/systemone");
  });
});
