/**
 * Checks passage references across a game (#32): links and `-> Target`
 * arguments must name a passage, and every passage should be reachable.
 */
import ts from "typescript";
import type {
  CodeSyntax,
  ContentSyntax,
  LinkSyntax,
  NameSyntax,
  PassageSyntax,
} from "../passages/syntax.js";

/** A passage and the file it's in. */
export type FilePassage = { readonly file: string; readonly passage: PassageSyntax };

/** A link problem, before it's positioned in its file. */
export type LinkProblem = {
  readonly severity: "error" | "warning";
  readonly file: string;
  readonly message: string;
  readonly at: NameSyntax;
  /** True if it says the passage can't be reached. */
  readonly unreachable?: true;
};

/** Every passage named after `->`, in links and directive arguments, in source order. */
export function passageTargets(
  content: readonly ContentSyntax[],
  stays: ReadonlySet<string> = new Set(),
): NameSyntax[] {
  const out: NameSyntax[] = [];
  const visit = (nodes: readonly ContentSyntax[]): void => {
    for (const n of nodes) {
      if (n.type === "link") {
        // A link that takes an action stays on its passage: it has no target.
        if (!(n.guard && stays.has(n.guard.name))) out.push(n.target);
        visit(n.label);
      } else if (n.type === "directive") {
        for (const a of n.args) if (a.type === "target") out.push(a.target);
      } else if (n.type === "if") {
        for (const b of n.branches) visit(b.content);
      } else if (n.type === "emphasis") {
        visit(n.content);
      }
    }
  };
  visit(content);
  return out;
}

/**
 * The links that sit on lines of their own, apart from other text: these stand
 * between paragraphs. Any other link, including one inside emphasis, is inline,
 * part of its paragraph's sentence (#207).
 */
export function standaloneLinks(
  content: readonly ContentSyntax[],
  source: string,
): Set<LinkSyntax> {
  const all: LinkSyntax[] = [];
  const top: LinkSyntax[] = [];
  const visit = (nodes: readonly ContentSyntax[], topLevel: boolean): void => {
    for (const n of nodes) {
      if (n.type === "link") {
        all.push(n);
        if (topLevel) top.push(n);
      } else if (n.type === "emphasis") visit(n.content, false);
      else if (n.type === "if") for (const b of n.branches) visit(b.content, topLevel);
    }
  };
  visit(content, true);
  const out = new Set<LinkSyntax>();
  for (const link of top) {
    const lineStart = source.lastIndexOf("\n", link.span.start - 1) + 1;
    const nl = source.indexOf("\n", link.span.start);
    const lineEnd = nl < 0 ? source.length : nl;
    // Blank out every link and guard on the line; anything left is other text.
    let rest = source.slice(lineStart, lineEnd);
    for (const l of all) {
      const end = l.guard?.span.end ?? l.span.end;
      if (l.span.start >= lineStart && end <= lineEnd) {
        const a = l.span.start - lineStart;
        const b = end - lineStart;
        rest = rest.slice(0, a) + " ".repeat(b - a) + rest.slice(b);
      }
    }
    if (rest.trim() === "") out.add(link);
  }
  return out;
}

/** All inline code in `content`: conditions, printed expressions, and directives' code and arguments. */
export function codeIn(content: readonly ContentSyntax[]): CodeSyntax[] {
  const out: CodeSyntax[] = [];
  const visit = (nodes: readonly ContentSyntax[]): void => {
    for (const n of nodes) {
      if (n.type === "print") {
        out.push(n.expression);
      } else if (n.type === "directive") {
        if (n.code) out.push(n.code);
        for (const a of n.args) if (a.type !== "target") out.push(a.value);
      } else if (n.type === "link") {
        visit(n.label);
        if (n.guard) visit([n.guard]);
      } else if (n.type === "if") {
        for (const b of n.branches) {
          if (b.condition) out.push(b.condition);
          visit(b.content);
        }
      } else if (n.type === "emphasis") {
        visit(n.content);
      }
    }
  };
  visit(content);
  return out;
}

/** Calls that only ask about a passage, so naming one there doesn't lead to it. */
const QUERIES = new Set(["visited", "visits"]);

/** Whether `node` is the first argument of `visited(…)`, `visits(…)`, or `x.visited(…)`. */
function isQueryArgument(node: ts.Node): boolean {
  const call = node.parent;
  if (!ts.isCallExpression(call) || call.arguments[0] !== node) return false;
  const callee = call.expression;
  const name = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : undefined;
  return name !== undefined && QUERIES.has(name);
}

/**
 * The string literals in TypeScript source text that may name a passage to go
 * to. Arguments to `visited` and `visits` are left out, since they only ask about
 * a passage. An alias such as `const seen = visited` isn't recognized, which only
 * means a warning may be missed.
 */
export function stringLiterals(code: string): string[] {
  const out: string[] = [];
  // Parent pointers are needed to see what a literal is passed to.
  const file = ts.createSourceFile("code.ts", code, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): void => {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      !isQueryArgument(node)
    ) {
      out.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

/** Edit distance, for suggesting the passage an author meant. */
function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(
        (row[j] ?? 0) + 1,
        (next[j - 1] ?? 0) + 1,
        (row[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    row = next;
  }
  return row[b.length] ?? 0;
}

/** The closest passage name, if one is close enough to be a likely typo. */
export function closestName(name: string, names: Iterable<string>): string | undefined {
  let best: string | undefined;
  let bestScore = Infinity;
  for (const candidate of names) {
    const score =
      candidate.toLowerCase() === name.toLowerCase()
        ? 0
        : distance(name.toLowerCase(), candidate.toLowerCase());
    if (score < bestScore || (score === bestScore && best !== undefined && candidate < best)) {
      best = candidate;
      bestScore = score;
    }
  }
  return bestScore <= Math.max(1, Math.floor(name.length / 3)) ? best : undefined;
}

/**
 * Reports links to passages that don't exist, and, when `start` is given,
 * passages nothing reaches.
 *
 * @param named - strings that appear in code. A passage named in code, as in
 * `goTo("Attic")`, counts as reachable, since code can move there.
 * @param entryRoles - tag roles whose passages a package enters itself, such
 * as rooms and actors; those count as reachable too.
 */
export function checkLinks(
  passages: readonly FilePassage[],
  named: ReadonlySet<string>,
  start: string | undefined,
  entryRoles: ReadonlySet<string> = new Set(),
  stays: ReadonlySet<string> = new Set(),
): LinkProblem[] {
  const problems: LinkProblem[] = [];
  const byName = new Map<string, FilePassage>();
  for (const p of passages)
    if (!byName.has(p.passage.name.name)) byName.set(p.passage.name.name, p);

  const edges = new Map<string, string[]>();
  for (const { file, passage } of passages) {
    const targets = passageTargets(passage.content, stays);
    edges.set(
      passage.name.name,
      targets.map((t) => t.name),
    );
    for (const t of targets) {
      if (byName.has(t.name)) continue;
      const guess = closestName(t.name, byName.keys());
      problems.push({
        severity: "error",
        file,
        at: t,
        message: `There's no passage named \`${t.name}\`.${
          guess === undefined
            ? " Check the spelling, or add the passage."
            : ` Did you mean \`${guess}\`?`
        }`,
      });
    }
  }

  if (start === undefined || !byName.has(start)) return problems;
  const reached = new Set<string>();
  const entries = passages
    .filter(({ passage }) =>
      passage.tags.some((t) => t.value !== undefined && entryRoles.has(t.name)),
    )
    .map(({ passage }) => passage.name.name);
  const queue = [start, ...[...named].filter((n) => byName.has(n)), ...entries];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    if (reached.has(next)) continue;
    reached.add(next);
    for (const target of edges.get(next) ?? []) if (byName.has(target)) queue.push(target);
  }
  for (const { file, passage } of passages) {
    if (reached.has(passage.name.name)) continue;
    problems.push({
      severity: "warning",
      file,
      at: passage.name,
      unreachable: true,
      message: `Nothing leads to \`${passage.name.name}\` from \`${start}\`, so players can't reach it. Link to it from another passage, or remove it.`,
    });
  }
  return problems;
}
