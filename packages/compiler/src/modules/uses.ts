/**
 * Where names are used in a game's code (#72, ADR 0064): in its TypeScript
 * files and its passages' inline code, each use with the call it sits in,
 * if any. It reads syntax alone, without type checking, so packages' checks
 * can ask cheaply, such as the world model's "does any exit lead to this
 * room?". A name's own declaration isn't a use.
 */
import ts from "typescript";

/** One use of a name, for {@link CheckContext.uses}. */
export type NameUse = {
  /** The file it's in, as a full path: a TypeScript file, or a passage file for inline code. */
  readonly file: string;
  /**
   * The nearest call it's an argument of, if any, and which argument, from
   * 0, counting the use inside an object or array in that argument too:
   * `cellar` in `connect(hall, { down: cellar })` is argument 1 of `connect`.
   */
  readonly call?: { readonly callee: string; readonly argument: number };
};

/** The name a call is made by: `connect` for `connect(…)` and `world.connect(…)`. */
const calleeName = (e: ts.Expression): string =>
  ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : "";

/** Whether `id` names something rather than using it: a declaration, a property's key, or a member's name. */
function isNamePosition(id: ts.Identifier): boolean {
  const p = id.parent;
  return (
    ((ts.isVariableDeclaration(p) ||
      ts.isFunctionDeclaration(p) ||
      ts.isClassDeclaration(p) ||
      ts.isParameter(p) ||
      ts.isPropertyAssignment(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isBindingElement(p)) &&
      p.name === id) ||
    (ts.isPropertyAccessExpression(p) && p.name === id) ||
    ts.isImportSpecifier(p) ||
    ts.isExportSpecifier(p)
  );
}

/** The call `node` is an argument of, nearest first, and which argument. */
function enclosingCall(node: ts.Node): NameUse["call"] {
  let child: ts.Node = node;
  for (let p = node.parent; p !== undefined && !ts.isSourceFile(p); p = p.parent) {
    if (ts.isCallExpression(p)) {
      const argument = p.arguments.indexOf(child as ts.Expression);
      if (argument >= 0) return { callee: calleeName(p.expression), argument };
    }
    // A function boundary: what's inside it isn't an argument of an outer call, but its body.
    if (ts.isFunctionLike(p)) return undefined;
    child = p;
  }
  return undefined;
}

/** Every use of every name in `text`, by name. */
function usesIn(file: string, text: string, into: Map<string, NameUse[]>): void {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && !isNamePosition(node)) {
      const call = enclosingCall(node);
      const list = into.get(node.text) ?? [];
      list.push({ file, ...(call !== undefined && { call }) });
      into.set(node.text, list);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

/**
 * Where each name is used in `sources` (TypeScript files) and `code`
 * (passages' inline code, each with its passage file).
 */
export function nameUses(
  sources: readonly { readonly file: string; readonly text: string }[],
  code: readonly { readonly file: string; readonly code: string }[],
): ReadonlyMap<string, readonly NameUse[]> {
  const out = new Map<string, NameUse[]>();
  for (const s of sources) usesIn(s.file, s.text, out);
  // Inline code is an expression or statements; read each as statements on its own.
  for (const c of code) usesIn(c.file, `${c.code};`, out);
  return out;
}
