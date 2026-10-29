import { describe, expect, it } from "vitest";
import { decisionState, embedText, pathWords, splitIdentifier, type Decision } from "./cards.ts";
import type { CodeSymbol } from "./extract.ts";
import { buildTaxonomy } from "./taxonomy.ts";

function symbol(overrides: Partial<CodeSymbol> = {}): CodeSymbol {
  return {
    id: "src/lib/format.ts#toMoneyString",
    relPath: "src/lib/format.ts",
    name: "toMoneyString",
    qualifiedName: "toMoneyString",
    kind: "function",
    exported: true,
    startLine: 1,
    endLine: 3,
    signature: "export function toMoneyString(cents: number): string",
    doc: "Formats cents.",
    body: "export function toMoneyString(cents: number): string {\n  return String(cents);\n}",
    members: [],
    uses: ["Intl.NumberFormat"],
    refCount: 4,
    ...overrides,
  };
}

function longBody(lines: number): string {
  return Array.from({ length: lines }, (_, i) => `  const value${i} = compute(${i});`).join("\n");
}

describe("splitIdentifier / pathWords", () => {
  it("splits camelCase, acronyms, snake_case, and dotted names", () => {
    expect(splitIdentifier("toMoneyString")).toBe("to money string");
    expect(splitIdentifier("HTTPClient")).toBe("http client");
    expect(splitIdentifier("parse_yaml_file")).toBe("parse yaml file");
    expect(splitIdentifier("ConfigStore.load")).toBe("config store load");
  });

  it("drops src/index and the extension from paths", () => {
    expect(pathWords("src/search/index-file.ts")).toBe("search index file");
    expect(pathWords("src/code-index/index.ts")).toBe("code index");
  });
});

describe("decisionState", () => {
  it("includes the whole body when it fits", () => {
    const state = decisionState(symbol(), 4000);
    expect(state.mode).toBe("full");
    expect(state.text).toContain("Name words: to money string");
    expect(state.text).toContain("Referenced from 4 other files");
    expect(state.text).toContain("return String(cents);");
  });

  it("falls back to an excerpt that stays within budget", () => {
    const state = decisionState(symbol({ body: longBody(400) }), 3000);
    expect(state.mode).toBe("excerpt");
    expect(state.text.length).toBeLessThanOrEqual(3000);
    expect(state.text).toMatch(/lines omitted/);
    expect(state.text).toContain("value0");
    expect(state.text).toContain("value399");
  });

  it("uses the member skeleton for large classes", () => {
    const state = decisionState(
      symbol({ kind: "class", signature: "export class Store", body: longBody(400), members: ["load(): void", "save(): void"] }),
      3000,
    );
    expect(state.mode).toBe("skeleton");
    expect(state.text).toContain("export class Store {\n  load(): void\n  save(): void\n}");
  });

  it("sends only the header when the budget leaves no room for code", () => {
    const state = decisionState(symbol({ body: longBody(400) }), 300);
    expect(state.mode).toBe("header");
    expect(state.text).not.toContain("Code:");
  });
});

describe("embedText", () => {
  it("adds d3 labels as plain-language descriptions only when given", () => {
    const taxonomy = buildTaxonomy();
    const decision: Decision = {
      role: { key: "utility", p: 0.9 },
      capabilities: [{ key: "formatting", p: 0.8 }],
      effects: { key: "pure", p: 0.95 },
      reuse: 0.9,
      convention: 0.7,
    };
    const plain = embedText(symbol());
    const labeled = embedText(symbol(), { decision, taxonomy });
    expect(plain).toContain("function to money string (toMoneyString)");
    expect(plain).not.toContain("Capabilities:");
    expect(labeled).toContain("Capabilities: Formatting values for display");
    expect(labeled).toContain("Side effects: No side effects");
  });
});
