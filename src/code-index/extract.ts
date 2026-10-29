import ts from "typescript";
import type { SourceFile } from "./files.ts";

export type SymbolKind =
  | "function"
  | "component"
  | "hook"
  | "class"
  | "method"
  | "interface"
  | "type"
  | "enum"
  | "const";

export type CodeSymbol = {
  /** `relPath#qualifiedName`, with `:line` appended when a file defines the same name twice. */
  id: string;
  relPath: string;
  name: string;
  qualifiedName: string;
  kind: SymbolKind;
  exported: boolean;
  startLine: number;
  endLine: number;
  signature: string;
  doc: string;
  body: string;
  /** Collapsed member signatures, used as the skeleton when a class is too large to show whole. */
  members: string[];
  /** Imported names and well-known globals the body touches, e.g. `readFile (node:fs/promises)`. */
  uses: string[];
  /** Number of other files that mention this symbol's name. */
  refCount: number;
};

const KNOWN_GLOBALS = new Set([
  "AbortController",
  "AbortSignal",
  "Array",
  "Blob",
  "Buffer",
  "Bun",
  "Date",
  "FormData",
  "Headers",
  "Intl",
  "JSON",
  "Map",
  "Math",
  "Number",
  "Object",
  "Promise",
  "Reflect",
  "RegExp",
  "Request",
  "Response",
  "Set",
  "String",
  "TextDecoder",
  "TextEncoder",
  "URL",
  "URLSearchParams",
  "WeakMap",
  "WebSocket",
  "crypto",
  "document",
  "fetch",
  "history",
  "localStorage",
  "location",
  "navigator",
  "performance",
  "process",
  "queueMicrotask",
  "requestAnimationFrame",
  "sessionStorage",
  "setInterval",
  "setTimeout",
  "structuredClone",
  "window",
]);

const MAX_USES = 24;
const MAX_SIGNATURE_CHARS = 400;
const MAX_MEMBER_CHARS = 160;

function scriptKindFor(relPath: string): ts.ScriptKind {
  if (relPath.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }
  if (relPath.endsWith(".jsx")) {
    return ts.ScriptKind.JSX;
  }
  if (/\.[cm]?js$/.test(relPath)) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function moduleLabel(spec: string): string {
  return spec.startsWith(".") ? spec.replace(/\.[cm]?[jt]sx?$/, "") : spec;
}

/** Local binding name → readable label such as `useState (react)`. */
function collectImports(sf: ts.SourceFile): Map<string, string> {
  const imports = new Map<string, string>();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) {
      continue;
    }
    const spec = moduleLabel(stmt.moduleSpecifier.text);
    const clause = stmt.importClause;
    if (!clause) {
      continue;
    }
    if (clause.name) {
      imports.set(clause.name.text, `${clause.name.text} (${spec})`);
    }
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      imports.set(bindings.name.text, `${bindings.name.text} (${spec})`);
    } else if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        const imported = element.propertyName?.text ?? element.name.text;
        imports.set(element.name.text, `${imported} (${spec})`);
      }
    }
  }
  return imports;
}

/** Names exported through `export { a, b as c }` or `export default a`. */
function collectExportedNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const stmt of sf.statements) {
    if (
      ts.isExportDeclaration(stmt) &&
      !stmt.moduleSpecifier &&
      stmt.exportClause &&
      ts.isNamedExports(stmt.exportClause)
    ) {
      for (const element of stmt.exportClause.elements) {
        names.add((element.propertyName ?? element.name).text);
      }
    } else if (ts.isExportAssignment(stmt) && ts.isIdentifier(stmt.expression)) {
      names.add(stmt.expression.text);
    }
  }
  return names;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);
}

function cleanComment(raw: string): string {
  if (raw.startsWith("//")) {
    return raw.replace(/^\/\/+\s?/, "").trim();
  }
  return raw
    .replace(/^\/\*+/, "")
    .replace(/\*+\/$/, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").trimEnd())
    .join("\n")
    .trim();
}

const DIRECTIVE_COMMENT = /^(eslint|prettier|@ts-|istanbul|c8 |#region|#endregion)/;

function leadingDoc(node: ts.Node, text: string): string {
  const ranges = ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [];
  return ranges
    .map((range) => cleanComment(text.slice(range.pos, range.end)))
    .filter((comment) => comment.length > 0 && !DIRECTIVE_COMMENT.test(comment))
    .join("\n")
    .trim();
}

function lineOf(sf: ts.SourceFile, pos: number): number {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

function containsJsx(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) {
      return;
    }
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

function rootIdentifier(expr: ts.Expression): string | null {
  let current: ts.Expression = expr;
  while (ts.isPropertyAccessExpression(current)) {
    current = current.expression;
  }
  return ts.isIdentifier(current) ? current.text : null;
}

/** `Intl.NumberFormat`, `process.env`, … — the first two segments of an identifier chain. */
function chainPrefix(expr: ts.PropertyAccessExpression): string | null {
  const parts: string[] = [];
  let current: ts.Expression = expr;
  while (ts.isPropertyAccessExpression(current)) {
    parts.unshift(current.name.text);
    current = current.expression;
  }
  if (!ts.isIdentifier(current)) {
    return null;
  }
  parts.unshift(current.text);
  return parts.slice(0, 2).join(".");
}

/** Type positions are skipped unless the symbol itself is a type, so `uses` reflects runtime behavior. */
function collectUses(node: ts.Node, imports: Map<string, string>, includeTypes = false): string[] {
  const uses = new Set<string>();
  const visit = (n: ts.Node) => {
    if (uses.size >= MAX_USES || (!includeTypes && ts.isTypeNode(n))) {
      return;
    }
    if (ts.isIdentifier(n)) {
      const label = imports.get(n.text);
      const isPropertyName = ts.isPropertyAccessExpression(n.parent) && n.parent.name === n;
      if (label && !isPropertyName) {
        uses.add(label);
      }
    } else if (
      ts.isPropertyAccessExpression(n) &&
      !ts.isPropertyAccessExpression(n.parent) &&
      KNOWN_GLOBALS.has(rootIdentifier(n) ?? "")
    ) {
      const chain = chainPrefix(n);
      if (chain) {
        uses.add(chain);
      }
    } else if (
      (ts.isCallExpression(n) || ts.isNewExpression(n)) &&
      ts.isIdentifier(n.expression) &&
      KNOWN_GLOBALS.has(n.expression.text)
    ) {
      uses.add(n.expression.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return [...uses];
}

type FunctionLike = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | ts.MethodDeclaration;

/** The function inside `const X = memo(() => …)` / `forwardRef(function X() …)`, if any. */
function unwrapFunction(initializer: ts.Expression | undefined): ts.ArrowFunction | ts.FunctionExpression | null {
  if (!initializer) {
    return null;
  }
  let current: ts.Expression = initializer;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) {
    current = current.expression;
  }
  if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
    return current;
  }
  if (ts.isCallExpression(current)) {
    for (const arg of current.arguments) {
      const inner = unwrapFunction(arg);
      if (inner) {
        return inner;
      }
    }
  }
  return null;
}

function functionKind(name: string, fn: FunctionLike): SymbolKind {
  if (/^use[A-Z0-9]/.test(name)) {
    return "hook";
  }
  if (/^[A-Z]/.test(name) && containsJsx(fn)) {
    return "component";
  }
  return "function";
}

/** Source from `start` up to the function body: the declaration header plus parameters and return type. */
function headerBefore(sf: ts.SourceFile, start: number, body: ts.Node | undefined, end: number): string {
  const stop = body ? body.getStart(sf) : end;
  return clip(collapse(sf.text.slice(start, stop)), MAX_SIGNATURE_CHARS);
}

function memberSkeleton(sf: ts.SourceFile, member: ts.ClassElement): string | null {
  if (ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member) || ts.isGetAccessor(member) || ts.isSetAccessor(member)) {
    return clip(headerBefore(sf, member.getStart(sf), member.body, member.getEnd()), MAX_MEMBER_CHARS);
  }
  if (ts.isPropertyDeclaration(member)) {
    const fn = unwrapFunction(member.initializer);
    if (fn) {
      return clip(headerBefore(sf, member.getStart(sf), fn.body, member.getEnd()), MAX_MEMBER_CHARS);
    }
    return clip(collapse(member.getText(sf)), MAX_MEMBER_CHARS);
  }
  return null;
}

function memberName(member: ts.ClassElement): string | null {
  const name = member.name;
  if (!name) {
    return null;
  }
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name)) {
    return name.text;
  }
  return null;
}

export function extractSymbols(relPath: string, text: string): CodeSymbol[] {
  const sf = ts.createSourceFile(relPath, text, ts.ScriptTarget.Latest, true, scriptKindFor(relPath));
  const imports = collectImports(sf);
  const exportedNames = collectExportedNames(sf);
  const symbols: CodeSymbol[] = [];
  const seenIds = new Set<string>();

  const push = (sym: Omit<CodeSymbol, "id" | "refCount" | "members"> & { members?: string[] }) => {
    let id = `${relPath}#${sym.qualifiedName}`;
    if (seenIds.has(id)) {
      id = `${id}:${sym.startLine}`;
    }
    seenIds.add(id);
    symbols.push({ ...sym, id, members: sym.members ?? [], refCount: 0 });
  };

  const isExported = (node: ts.Node, name: string) =>
    hasModifier(node, ts.SyntaxKind.ExportKeyword) || exportedNames.has(name);

  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt)) {
      if (!stmt.body) {
        continue;
      }
      const name = stmt.name?.text ?? "default";
      push({
        relPath,
        name,
        qualifiedName: name,
        kind: functionKind(name, stmt),
        exported: isExported(stmt, name),
        startLine: lineOf(sf, stmt.getStart(sf)),
        endLine: lineOf(sf, stmt.getEnd()),
        signature: headerBefore(sf, stmt.getStart(sf), stmt.body, stmt.getEnd()),
        doc: leadingDoc(stmt, text),
        body: stmt.getText(sf),
        uses: collectUses(stmt, imports),
      });
    } else if (ts.isClassDeclaration(stmt)) {
      const className = stmt.name?.text ?? "default";
      const classExported = isExported(stmt, className);
      const members = stmt.members
        .map((member) => memberSkeleton(sf, member))
        .filter((line): line is string => line !== null);
      push({
        relPath,
        name: className,
        qualifiedName: className,
        kind: containsJsx(stmt) && /^[A-Z]/.test(className) ? "component" : "class",
        exported: classExported,
        startLine: lineOf(sf, stmt.getStart(sf)),
        endLine: lineOf(sf, stmt.getEnd()),
        signature: clip(collapse(sf.text.slice(stmt.getStart(sf), stmt.members.pos)).replace(/\{$/, "").trim(), MAX_SIGNATURE_CHARS),
        doc: leadingDoc(stmt, text),
        body: stmt.getText(sf),
        members,
        uses: collectUses(stmt, imports),
      });

      for (const member of stmt.members) {
        const name = memberName(member);
        if (!name) {
          continue;
        }
        const fn = ts.isMethodDeclaration(member)
          ? member
          : ts.isPropertyDeclaration(member)
            ? unwrapFunction(member.initializer)
            : null;
        if (!fn?.body) {
          continue;
        }
        const hidden =
          ts.isPrivateIdentifier(member.name!) ||
          hasModifier(member, ts.SyntaxKind.PrivateKeyword) ||
          hasModifier(member, ts.SyntaxKind.ProtectedKeyword);
        push({
          relPath,
          name,
          qualifiedName: `${className}.${name}`,
          kind: "method",
          exported: classExported && !hidden,
          startLine: lineOf(sf, member.getStart(sf)),
          endLine: lineOf(sf, member.getEnd()),
          signature: headerBefore(sf, member.getStart(sf), fn.body, member.getEnd()),
          doc: leadingDoc(member, text),
          body: member.getText(sf),
          uses: collectUses(member, imports),
        });
      }
    } else if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt) || ts.isEnumDeclaration(stmt)) {
      const name = stmt.name.text;
      const kind: SymbolKind = ts.isInterfaceDeclaration(stmt) ? "interface" : ts.isEnumDeclaration(stmt) ? "enum" : "type";
      push({
        relPath,
        name,
        qualifiedName: name,
        kind,
        exported: isExported(stmt, name),
        startLine: lineOf(sf, stmt.getStart(sf)),
        endLine: lineOf(sf, stmt.getEnd()),
        signature: clip(collapse(stmt.getText(sf)), MAX_SIGNATURE_CHARS),
        doc: leadingDoc(stmt, text),
        body: stmt.getText(sf),
        uses: collectUses(stmt, imports, true),
      });
    } else if (ts.isVariableStatement(stmt)) {
      const declarations = stmt.declarationList.declarations;
      for (const decl of declarations) {
        if (!ts.isIdentifier(decl.name)) {
          continue;
        }
        const name = decl.name.text;
        const exported = isExported(stmt, name);
        const range: ts.Node = declarations.length === 1 ? stmt : decl;
        const fn = unwrapFunction(decl.initializer);
        if (!fn && !exported) {
          continue;
        }
        push({
          relPath,
          name,
          qualifiedName: name,
          kind: fn ? functionKind(name, fn) : "const",
          exported,
          startLine: lineOf(sf, range.getStart(sf)),
          endLine: lineOf(sf, range.getEnd()),
          signature: fn
            ? headerBefore(sf, range.getStart(sf), fn.body, range.getEnd())
            : clip(collapse(range.getText(sf)), MAX_SIGNATURE_CHARS),
          doc: leadingDoc(stmt, text),
          body: range.getText(sf),
          uses: collectUses(decl, imports),
        });
      }
    }
  }

  return symbols;
}

const IDENTIFIER = /[A-Za-z_$][\w$]*/g;

/** Fill `refCount`: how many other files mention each top-level symbol's name. */
export function computeRefCounts(symbols: CodeSymbol[], files: SourceFile[]): void {
  const identifiersByFile = files.map((file) => ({
    relPath: file.relPath,
    identifiers: new Set(file.text.match(IDENTIFIER) ?? []),
  }));
  for (const sym of symbols) {
    if (sym.kind === "method" || sym.name.length < 3 || sym.name === "default") {
      continue;
    }
    let count = 0;
    for (const file of identifiersByFile) {
      if (file.relPath !== sym.relPath && file.identifiers.has(sym.name)) {
        count++;
      }
    }
    sym.refCount = count;
  }
}

export function extractFromFiles(files: SourceFile[]): CodeSymbol[] {
  const symbols = files.flatMap((file) => extractSymbols(file.relPath, file.text));
  computeRefCounts(symbols, files);
  return symbols;
}
