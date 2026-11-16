/**
 * Finding the structure of code inside `{ }` with TypeScript's scanner, so
 * braces and commas inside strings, template literals, comments, and regular
 * expressions don't count (ADR 0004).
 */
import ts from "typescript";

/** Tokens after which `/` divides; anywhere else it starts a regular expression. */
const ENDS_OPERAND = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.Identifier,
  ts.SyntaxKind.PrivateIdentifier,
  ts.SyntaxKind.NumericLiteral,
  ts.SyntaxKind.BigIntLiteral,
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.CloseParenToken,
  ts.SyntaxKind.CloseBracketToken,
  ts.SyntaxKind.CloseBraceToken,
  ts.SyntaxKind.ThisKeyword,
  ts.SyntaxKind.SuperKeyword,
  ts.SyntaxKind.TrueKeyword,
  ts.SyntaxKind.FalseKeyword,
  ts.SyntaxKind.NullKeyword,
  ts.SyntaxKind.PlusPlusToken,
  ts.SyntaxKind.MinusMinusToken,
]);

type Frame = "brace" | "paren" | "bracket" | "template";

/**
 * Walks the tokens of `source` from `start` to `limit`, tracking nesting.
 * `visit` sees each token with the nesting depth outside it, and returns true
 * to stop.
 */
function walk(
  source: string,
  start: number,
  limit: number,
  visit: (kind: ts.SyntaxKind, tokenStart: number, depth: number) => boolean,
): void {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.Standard,
    source,
    undefined,
    start,
    limit - start,
  );
  const stack: Frame[] = [];
  let previous = ts.SyntaxKind.Unknown;
  for (;;) {
    let kind = scanner.scan();
    if (kind === ts.SyntaxKind.EndOfFileToken) return;
    if (
      (kind === ts.SyntaxKind.SlashToken || kind === ts.SyntaxKind.SlashEqualsToken) &&
      !ENDS_OPERAND.has(previous)
    ) {
      kind = scanner.reScanSlashToken();
    }
    if (kind === ts.SyntaxKind.CloseBraceToken && stack.at(-1) === "template") {
      kind = scanner.reScanTemplateToken(false);
      if (kind === ts.SyntaxKind.TemplateTail) stack.pop();
      previous = kind;
      continue;
    }
    const tokenStart = scanner.getTokenStart();
    const closes =
      kind === ts.SyntaxKind.CloseBraceToken ||
      kind === ts.SyntaxKind.CloseParenToken ||
      kind === ts.SyntaxKind.CloseBracketToken;
    if (visit(kind, tokenStart, closes ? stack.length - 1 : stack.length)) return;
    switch (kind) {
      case ts.SyntaxKind.OpenBraceToken:
        stack.push("brace");
        break;
      case ts.SyntaxKind.OpenParenToken:
        stack.push("paren");
        break;
      case ts.SyntaxKind.OpenBracketToken:
        stack.push("bracket");
        break;
      case ts.SyntaxKind.TemplateHead:
        stack.push("template");
        break;
      default:
        if (closes) stack.pop();
    }
    previous = kind;
  }
}

/**
 * Returns the offset of the `}` that closes the `{` at `open`, looking no
 * further than `limit`, or undefined if it isn't closed.
 */
export function matchBrace(source: string, open: number, limit: number): number | undefined {
  let found: number | undefined;
  walk(source, open, limit, (kind, at, depth) => {
    if (kind === ts.SyntaxKind.CloseBraceToken && depth === 0) {
      found = at;
      return true;
    }
    return false;
  });
  return found;
}

/** Splits `start`…`end` at commas outside brackets, strings, and templates. */
export function splitTopLevel(source: string, start: number, end: number): [number, number][] {
  const parts: [number, number][] = [];
  let from = start;
  walk(source, start, end, (kind, at, depth) => {
    if (kind === ts.SyntaxKind.CommaToken && depth === 0) {
      parts.push([from, at]);
      from = at + 1;
    }
    return false;
  });
  parts.push([from, end]);
  return parts;
}

/**
 * The free-standing identifiers in a piece of code: every identifier that
 * isn't a property name after `.` or `?.`. Used to decide which scope exports
 * and context names a passage needs.
 */
export function identifiers(code: string): Set<string> {
  const names = new Set<string>();
  let previous = ts.SyntaxKind.Unknown;
  walk(code, 0, code.length, (kind, at) => {
    if (
      kind === ts.SyntaxKind.Identifier &&
      previous !== ts.SyntaxKind.DotToken &&
      previous !== ts.SyntaxKind.QuestionDotToken
    ) {
      const match = /^[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*/u.exec(code.slice(at));
      if (match) names.add(match[0]);
    }
    previous = kind;
    return false;
  });
  return names;
}
