import { describe, expect, it } from "vitest";
import { computeRefCounts, extractSymbols } from "./extract.ts";
import { isIndexableSourcePath } from "./files.ts";

const FORMAT_TS = `import { clamp } from "./math.ts";
import type { Money } from "./types.ts";

/** Formats integer cents as a localized currency string. */
export function toMoneyString(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(clamp(cents) / 100);
}

export function overloaded(a: string): string;
export function overloaded(a: number): string;
export function overloaded(a: unknown): string {
  return String(a);
}

// Total in cents for a list of prices.
const sumCents = (items: Money[]): number => {
  let total = 0;
  for (const item of items) {
    total += item.cents;
  }
  return total;
};

const LOCAL_ONLY = 3;
export const DEFAULT_CURRENCY = "USD";

export { sumCents };
`;

const COMPONENT_TSX = `import { useState } from "react";
import { Button } from "./button.tsx";

export function useCounter(start: number) {
  const [n, setN] = useState(start);
  return { n, inc: () => setN(n + 1) };
}

export const Counter = ({ start }: { start: number }) => {
  const { n, inc } = useCounter(start);
  return <Button onClick={inc}>{n}</Button>;
};
`;

const CLASS_TS = `import { readFile } from "node:fs/promises";

export class ConfigStore {
  #cache = new Map<string, string>();

  constructor(private readonly root: string) {}

  async load(name: string): Promise<string> {
    const text = await readFile(name, "utf8");
    this.#cache.set(name, text);
    return text;
  }

  private reset(): void {
    this.#cache.clear();
  }
}
`;

describe("extractSymbols", () => {
  it("extracts functions, arrow functions, and exported consts with docs and uses", () => {
    const symbols = extractSymbols("src/lib/format.ts", FORMAT_TS);
    const byName = new Map(symbols.map((s) => [s.name, s]));

    const money = byName.get("toMoneyString")!;
    expect(money.kind).toBe("function");
    expect(money.exported).toBe(true);
    expect(money.doc).toBe("Formats integer cents as a localized currency string.");
    expect(money.signature).toBe('export function toMoneyString(cents: number, currency = "USD"): string');
    expect(money.uses).toEqual(expect.arrayContaining(["Intl.NumberFormat", "clamp (./math)"]));
    expect(money.startLine).toBe(5);
    expect(money.endLine).toBe(7);

    const sum = byName.get("sumCents")!;
    expect(sum.kind).toBe("function");
    expect(sum.exported).toBe(true);
    expect(sum.doc).toBe("Total in cents for a list of prices.");
    expect(sum.uses).not.toContain("Money (./types)");

    expect(byName.get("DEFAULT_CURRENCY")?.kind).toBe("const");
    expect(byName.has("LOCAL_ONLY")).toBe(false);
    expect(symbols.filter((s) => s.name === "overloaded")).toHaveLength(1);
  });

  it("detects hooks and components in TSX", () => {
    const symbols = extractSymbols("src/ui/counter.tsx", COMPONENT_TSX);
    expect(symbols.map((s) => [s.name, s.kind])).toEqual([
      ["useCounter", "hook"],
      ["Counter", "component"],
    ]);
    expect(symbols[1]!.uses).toEqual(["Button (./button)"]);
  });

  it("extracts classes with a member skeleton and public methods", () => {
    const symbols = extractSymbols("src/config/store.ts", CLASS_TS);
    const cls = symbols.find((s) => s.kind === "class")!;
    expect(cls.signature).toBe("export class ConfigStore");
    expect(cls.members).toEqual([
      "#cache = new Map<string, string>();",
      "constructor(private readonly root: string)",
      "async load(name: string): Promise<string>",
      "private reset(): void",
    ]);
    const methods = symbols.filter((s) => s.kind === "method");
    expect(methods.map((m) => [m.qualifiedName, m.exported])).toEqual([
      ["ConfigStore.load", true],
      ["ConfigStore.reset", false],
    ]);
    expect(methods[0]!.uses).toEqual(["readFile (node:fs/promises)"]);
  });
});

describe("computeRefCounts", () => {
  it("counts other files that mention a symbol name", () => {
    const files = [
      { relPath: "src/lib/format.ts", text: FORMAT_TS },
      { relPath: "src/a.ts", text: "toMoneyString(1); toMoneyString(2);" },
      { relPath: "src/b.ts", text: "import { toMoneyString } from './lib/format.ts';" },
      { relPath: "src/c.ts", text: "const toMoney = 1;" },
    ];
    const symbols = extractSymbols(files[0]!.relPath, files[0]!.text);
    computeRefCounts(symbols, files);
    expect(symbols.find((s) => s.name === "toMoneyString")?.refCount).toBe(2);
  });
});

describe("isIndexableSourcePath", () => {
  it("keeps source files and skips tests, declarations, and build output", () => {
    expect(isIndexableSourcePath("src/a.ts")).toBe(true);
    expect(isIndexableSourcePath("web/app/page.tsx")).toBe(true);
    expect(isIndexableSourcePath("src/a.test.ts")).toBe(false);
    expect(isIndexableSourcePath("src/a.test.ts", { includeTests: true })).toBe(true);
    expect(isIndexableSourcePath("src/types/env.d.ts")).toBe(false);
    expect(isIndexableSourcePath("dist/index.js")).toBe(false);
    expect(isIndexableSourcePath("README.md")).toBe(false);
  });
});
