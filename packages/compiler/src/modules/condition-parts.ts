/**
 * The parts of a guard's condition (#47), so the inspector can show which
 * part closed a link: `lamp.lit && !night.signalled` has the parts `lamp.lit`
 * and `night.signalled`. A condition is split at `&&`, `||`, `??`, `!`, `?:`,
 * and parentheses; a comparison is a part, and so are the sides of it that
 * aren't literals, so `visits > 2` shows `visits` too.
 */
import ts from "typescript";

const LOGICAL = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

const COMPARISON = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.InstanceOfKeyword,
  ts.SyntaxKind.InKeyword,
]);

/** Whether an expression is a literal, whose value says nothing new. */
function isLiteral(node: ts.Expression): boolean {
  return (
    ts.isLiteralExpression(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(node) && node.text === "undefined") ||
    (ts.isPrefixUnaryExpression(node) && isLiteral(node.operand))
  );
}

/**
 * The parts of a condition, in source order, each once. A condition that
 * doesn't parse, or a part that spans lines, gives no parts.
 */
export function conditionParts(code: string): string[] {
  const file = ts.createSourceFile("condition.ts", `(${code});`, ts.ScriptTarget.Latest, true);
  const statement = file.statements[0];
  if (
    file.statements.length !== 1 ||
    !statement ||
    !ts.isExpressionStatement(statement) ||
    (file as { parseDiagnostics?: readonly unknown[] }).parseDiagnostics?.length
  ) {
    return [];
  }
  const parts: string[] = [];
  const add = (node: ts.Expression) => {
    if (isLiteral(node)) return;
    const text = node.getText(file);
    if (!text.includes("\n") && !parts.includes(text)) parts.push(text);
  };
  const visit = (node: ts.Expression): void => {
    if (ts.isParenthesizedExpression(node)) return visit(node.expression);
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
      return visit(node.operand);
    }
    if (ts.isBinaryExpression(node) && LOGICAL.has(node.operatorToken.kind)) {
      visit(node.left);
      visit(node.right);
      return;
    }
    if (ts.isConditionalExpression(node)) {
      visit(node.condition);
      visit(node.whenTrue);
      visit(node.whenFalse);
      return;
    }
    add(node);
    if (ts.isBinaryExpression(node) && COMPARISON.has(node.operatorToken.kind)) {
      add(node.left);
      add(node.right);
    }
  };
  visit(statement.expression);
  return parts;
}
