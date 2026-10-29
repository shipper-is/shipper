import type { CodeSymbol } from "./extract.ts";
import { EFFECT_OPTIONS, ROLE_OPTIONS, type Taxonomy } from "./taxonomy.ts";

export type Decision = {
  role: { key: string; p: number };
  capabilities: Array<{ key: string; p: number }>;
  effects: { key: string; p: number };
  /** 0..1, from the reuse score question. */
  reuse: number;
  /** 0..1, from the convention score question. */
  convention: number;
};

/** How much of the symbol's code made it into a decision state. */
export type CardMode = "full" | "excerpt" | "skeleton" | "header";

const MIN_CODE_CHARS = 200;
const MAX_DOC_CHARS = 600;
const MAX_EMBED_CODE_CHARS = 1500;

/** `toMoneyString` → `to money string`, `HTTPClient` → `http client`, `snake_case` → `snake case`. */
export function splitIdentifier(name: string): string {
  return name
    .replace(/[_$\-.]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** `src/search/index-file.ts` → `search index file`. */
export function pathWords(relPath: string): string {
  return relPath
    .replace(/\.[^/.]+$/, "")
    .split("/")
    .filter((segment) => segment !== "src" && segment !== "index")
    .map(splitIdentifier)
    .join(" ");
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function headerLines(sym: CodeSymbol): string[] {
  const lines = [
    `File: ${sym.relPath}`,
    `Symbol: ${sym.qualifiedName} (${sym.kind}${sym.exported ? ", exported" : ""})`,
    `Name words: ${splitIdentifier(sym.qualifiedName)}`,
    `Signature: ${sym.signature}`,
  ];
  if (sym.doc) {
    lines.push(`Documentation: ${clip(sym.doc, MAX_DOC_CHARS)}`);
  }
  if (sym.uses.length > 0) {
    lines.push(`Uses: ${sym.uses.join(", ")}`);
  }
  if (sym.refCount > 0) {
    lines.push(`Referenced from ${sym.refCount} other file${sym.refCount === 1 ? "" : "s"}`);
  }
  return lines;
}

/** First and last lines of `body` with an omission marker, fitting `budget` characters. */
function excerpt(body: string, budget: number): string {
  const lines = body.split("\n");
  const head: string[] = [];
  const tail: string[] = [];
  let used = 0;
  const headBudget = Math.floor(budget * 0.65);
  for (const line of lines) {
    if (used + line.length + 1 > headBudget) {
      break;
    }
    head.push(line);
    used += line.length + 1;
  }
  for (let i = lines.length - 1; i >= head.length; i--) {
    const line = lines[i]!;
    if (used + line.length + 1 > budget - 40) {
      break;
    }
    tail.unshift(line);
    used += line.length + 1;
  }
  const omitted = lines.length - head.length - tail.length;
  if (omitted <= 0) {
    return [...head, ...tail].join("\n");
  }
  return [...head, `  // … ${omitted} lines omitted …`, ...tail].join("\n");
}

function skeleton(sym: CodeSymbol, budget: number): string | null {
  if (sym.members.length === 0) {
    return null;
  }
  const lines = [`${sym.signature} {`];
  let used = lines[0]!.length + 2;
  for (const member of sym.members) {
    if (used + member.length + 3 > budget) {
      lines.push("  // … more members …");
      break;
    }
    lines.push(`  ${member}`);
    used += member.length + 3;
  }
  lines.push("}");
  return lines.join("\n");
}

/**
 * The `state` sent to the decision model. Header facts always come first; the code section gets
 * whatever budget remains, degrading from the full body to an excerpt, a member skeleton, or nothing.
 */
export function decisionState(sym: CodeSymbol, maxChars: number): { text: string; mode: CardMode } {
  const header = clip(headerLines(sym).join("\n"), Math.floor(maxChars * 0.5));
  const codeBudget = maxChars - header.length - "\nCode:\n".length;
  if (codeBudget < MIN_CODE_CHARS) {
    return { text: header, mode: "header" };
  }
  if (sym.body.length <= codeBudget) {
    return { text: `${header}\nCode:\n${sym.body}`, mode: "full" };
  }
  const skel = skeleton(sym, codeBudget);
  if (skel) {
    return { text: `${header}\nCode:\n${skel}`, mode: "skeleton" };
  }
  return { text: `${header}\nCode:\n${excerpt(sym.body, codeBudget)}`, mode: "excerpt" };
}

/**
 * Text that gets embedded for similarity search. `plain` uses only deterministic facts; passing a
 * decision adds the decision model's labels as plain-language descriptions.
 */
export function embedText(sym: CodeSymbol, labels?: { decision: Decision; taxonomy: Taxonomy }): string {
  const lines = [
    `${sym.kind} ${splitIdentifier(sym.qualifiedName)} (${sym.qualifiedName})`,
    `File: ${sym.relPath} (${pathWords(sym.relPath)})`,
    `Signature: ${sym.signature}`,
  ];
  if (sym.doc) {
    lines.push(`Documentation: ${clip(sym.doc, MAX_DOC_CHARS)}`);
  }
  if (labels) {
    const { decision, taxonomy } = labels;
    lines.push(`Role: ${ROLE_OPTIONS[decision.role.key] ?? decision.role.key}`);
    if (decision.capabilities.length > 0) {
      lines.push(
        `Capabilities: ${decision.capabilities
          .map((c) => taxonomy.capabilities[c.key] ?? c.key)
          .join("; ")}`,
      );
    }
    lines.push(`Side effects: ${EFFECT_OPTIONS[decision.effects.key] ?? decision.effects.key}`);
  }
  if (sym.uses.length > 0) {
    lines.push(`Uses: ${sym.uses.join(", ")}`);
  }
  lines.push(`Code: ${clip(sym.body, MAX_EMBED_CODE_CHARS)}`);
  return lines.join("\n");
}
