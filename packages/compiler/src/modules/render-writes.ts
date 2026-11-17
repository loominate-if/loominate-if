/**
 * Finds state changes in rendering code (#222). Rendering must be pure
 * (design principle 3); core throws when it isn't, and this catches the
 * syntactic cases at compile time instead (principle 6).
 */
import ts from "typescript";

/** An expression in rendering code that would change state. */
export type RenderWrite = {
  /** Offsets of the expression in the code. */
  readonly start: number;
  readonly end: number;
  /** The expression as written. */
  readonly text: string;
  /** For a plain `a = b`, which in a condition is likely a mistyped `===`: `a === b`. */
  readonly comparison?: string;
};

const UPDATES = new Set([ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken]);

/**
 * Assignments, `++`, `--`, and `delete` in `code`. Function bodies inside it are
 * skipped, since a function written there may change its own locals.
 */
export function renderWrites(code: string): RenderWrite[] {
  // Parenthesized so the code parses as one expression, as it's generated.
  const file = ts.createSourceFile("render.ts", `(${code})`, ts.ScriptTarget.Latest, true);
  const found: RenderWrite[] = [];
  const text = (node: ts.Node): string => code.slice(node.getStart(file) - 1, node.end - 1);
  const add = (node: ts.Node, comparison?: string): void => {
    const start = node.getStart(file) - 1;
    found.push({
      start,
      end: node.end - 1,
      text: text(node),
      ...(comparison !== undefined && { comparison }),
    });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return;
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      add(
        node,
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken
          ? `${text(node.left)} === ${text(node.right)}`
          : undefined,
      );
    } else if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      UPDATES.has(node.operator)
    ) {
      add(node);
    } else if (ts.isDeleteExpression(node)) {
      add(node);
    } else {
      // Inside a write, one report covers the whole expression.
      ts.forEachChild(node, visit);
    }
  };
  visit(file);
  return found;
}

/** The author-facing message for a write, `condition` when it's in `{if}` or `{when}`. */
export function renderWriteMessage(write: RenderWrite, condition: boolean): string {
  if (write.comparison !== undefined && condition) {
    return `\`${write.text}\` sets a value instead of comparing. To compare, use \`===\`: \`${write.comparison}\`.`;
  }
  return `Showing a passage can't change state, so \`${write.text}\` can't run here. Change it in an effect instead, like \`{on enter: ${write.text}}\`.`;
}
