/**
 * Checking actions' verb phrases at compile time (#79, ADR 0075): each
 * `{slot}` in an action's `verbs` must name one of its roles, the keys of
 * its type argument, as `action<{ thing: Door; tool: Key }>`. Core checks
 * slots as the game loads too, but only against the roles it can see.
 */
import ts from "typescript";

/** A problem in a verb phrase, at offsets in its file. */
export type VerbProblem = {
  readonly start: number;
  readonly end: number;
  readonly message: string;
};

/** Whether `node` is core's `action`, however it's imported or renamed. */
function isCoreAction(node: ts.Expression, checker: ts.TypeChecker): boolean {
  if (!ts.isIdentifier(node)) return false;
  let symbol = checker.getSymbolAtLocation(node);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  const declaration = symbol?.declarations?.[0];
  if (!declaration || symbol?.name !== "action") return false;
  const file = declaration.getSourceFile().fileName.split("\\").join("/");
  return (
    /\/core\/(src|dist)\/actions\/actions\.(d\.)?ts$/.test(file) ||
    /@loominate-if\/core\//.test(file)
  );
}

/** Every action's verb phrases in `file`, checked against its roles. */
export function checkVerbPhrases(file: ts.SourceFile, checker: ts.TypeChecker): VerbProblem[] {
  const problems: VerbProblem[] = [];
  const visit = (node: ts.Node): void => {
    ts.forEachChild(node, visit);
    if (!ts.isCallExpression(node) || !isCoreAction(node.expression, checker)) return;
    const [nameArg, definition] = node.arguments;
    const typeArg = node.typeArguments?.[0];
    if (!typeArg || !definition || !ts.isObjectLiteralExpression(definition)) return;
    const verbs = definition.properties.find(
      (p): p is ts.PropertyAssignment =>
        ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "verbs",
    );
    if (!verbs || !ts.isArrayLiteralExpression(verbs.initializer)) return;
    const roles = checker
      .getTypeFromTypeNode(typeArg)
      .getApparentProperties()
      .map((s) => s.name);
    const name = nameArg && ts.isStringLiteralLike(nameArg) ? nameArg.text : "this action";
    for (const element of verbs.initializer.elements) {
      if (!ts.isStringLiteralLike(element)) continue;
      const text = element.text;
      const start = element.getStart(file) + 1;
      for (const m of text.matchAll(/\{([^{}]*)\}/g)) {
        const role = (m[1] ?? "").trim();
        if (roles.includes(role)) continue;
        const at = start + (m.index ?? 0);
        problems.push({
          start: at,
          end: at + m[0].length,
          message: `\`{${role}}\` isn't one of ${name}'s roles: ${roles.join(", ")}. A slot names one of the action's things by role, as \`{thing}\`.`,
        });
      }
    }
  };
  visit(file);
  return problems;
}
