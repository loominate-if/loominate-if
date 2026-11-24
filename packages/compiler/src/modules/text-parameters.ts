/**
 * Checking `t` templates' message parameters at compile time (#235, ADR
 * 0074). Core parses a template's braces when the game loads and looks up
 * each parameter's name when the text renders; this finds the same mistakes
 * first, at the author's line: braces that don't match, a parameter with no
 * name, and a name no package registers.
 */
import ts from "typescript";
/**
 * How many edits make `a` into `b`: insertions, deletions, substitutions,
 * and swaps of neighbouring letters, so "teh" is one from "the".
 */
function edits(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const row = d[i] as number[];
      const up = d[i - 1] as number[];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min((up[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (up[j - 1] ?? 0) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        row[j] = Math.min(row[j] ?? 0, ((d[i - 2] as number[])[j - 2] ?? 0) + 1);
      }
    }
  }
  return (d[a.length] as number[])[b.length] ?? 0;
}

/** The registered name `name` is likeliest a misspelling of: one or two edits away, by its length. */
function closestName(name: string, names: Iterable<string>): string | undefined {
  let best: string | undefined;
  let bestScore = Infinity;
  for (const candidate of names) {
    const score = edits(name, candidate);
    if (score < bestScore || (score === bestScore && best !== undefined && candidate < best)) {
      best = candidate;
      bestScore = score;
    }
  }
  return bestScore <= Math.max(1, Math.floor(name.length / 3)) ? best : undefined;
}

/** A problem in a `t` template, at offsets in its file. */
export type TextProblem = {
  readonly severity: "error" | "warning";
  readonly start: number;
  readonly end: number;
  readonly message: string;
};

/** What the check knows of the game's message parameters. */
export type KnownParameters = {
  /** Names registered by packages and by the game, with where each comes from. */
  readonly names: ReadonlyMap<string, string>;
  /** Fallbacks that read any other name, as the world model's verbs. */
  readonly fallbacks: readonly {
    readonly from: string;
    readonly reads: string;
    readonly words: ReadonlySet<string>;
  }[];
};

/** Whether `node` is core's `t`, however it's imported or renamed. */
function isCoreT(node: ts.Expression, checker: ts.TypeChecker): boolean {
  if (!ts.isIdentifier(node)) return false;
  let symbol = checker.getSymbolAtLocation(node);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  const declaration = symbol?.declarations?.[0];
  if (!declaration || symbol?.name !== "t") return false;
  const file = declaration.getSourceFile().fileName.split("\\").join("/");
  return (
    /\/core\/(src|dist)\/text\/text\.(d\.)?ts$/.test(file) || /@loominate-if\/core\//.test(file)
  );
}

/** The names `messageParameters.register("…", …)` calls in `file` register. */
export function registeredIn(file: ts.SourceFile): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "register" &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "messageParameters"
    ) {
      const [first] = node.arguments;
      if (first && ts.isStringLiteralLike(first)) found.push(first.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** A template literal's parts as written: each literal's raw text and where it starts. */
function partsOf(template: ts.TemplateLiteral, file: ts.SourceFile): { raw: string; at: number }[] {
  const text = file.text;
  const literal = (node: ts.Node, openLength: number, closeLength: number) => {
    const start = node.getStart(file) + openLength;
    return { raw: text.slice(start, node.end - closeLength), at: start };
  };
  if (ts.isNoSubstitutionTemplateLiteral(template)) return [literal(template, 1, 1)];
  return [
    literal(template.head, 1, 2),
    ...template.templateSpans.map((s, i) =>
      literal(s.literal, 1, i === template.templateSpans.length - 1 ? 1 : 2),
    ),
  ];
}

/** Checks one `t` template's braces and names, as core's parse and render would. */
export function checkTemplate(
  template: ts.TemplateLiteral,
  file: ts.SourceFile,
  known: KnownParameters,
): TextProblem[] {
  const problems: TextProblem[] = [];
  const error = (start: number, end: number, message: string) => {
    problems.push({ severity: "error", start, end, message });
  };
  const parts = partsOf(template, file);
  /** The parameter being read: where it opened, its first word so far, and whether a value came first. */
  let open:
    { at: number; name: string; nameAt: number; reading: boolean; valueFirst: boolean } | undefined;
  for (const [i, { raw, at }] of parts.entries()) {
    for (let j = 0; j < raw.length; j++) {
      const c = raw[j];
      // An escape is one character of text, braces in \u{…} included.
      if (c === "\\") {
        if (raw[j + 1] === "u" && raw[j + 2] === "{") j = raw.indexOf("}", j);
        else j++;
        if (open?.reading) open.reading = false;
        continue;
      }
      if (!open) {
        if ((c === "{" || c === "}") && raw[j + 1] === c) j++;
        else if (c === "{")
          open = { at: at + j, name: "", nameAt: at + j + 1, reading: true, valueFirst: false };
        else if (c === "}") {
          error(
            at + j,
            at + j + 1,
            'A "}" with no "{" before it in this text. Write "}}" to print a brace.',
          );
        }
      } else if (c === "{") {
        error(
          at + j,
          at + j + 1,
          'A "{" inside a message parameter. Parameters can\'t nest; write "{{" outside one to print a brace.',
        );
        open = undefined;
      } else if (c === "}") {
        check(open, at + j + 1);
        open = undefined;
      } else if (/\s/.test(c ?? "")) {
        if (open.name !== "") open.reading = false;
        else open.nameAt = at + j + 1;
      } else if (open.reading) {
        open.name += c;
      }
    }
    if (i < parts.length - 1 && open) {
      if (open.name === "") open.valueFirst = true;
      open.reading = false;
    }
  }
  if (open) {
    error(
      open.at,
      open.at + 1,
      'A "{" with no "}" after it in this text. Write "{{" to print a brace.',
    );
  }
  return problems;

  function check(p: NonNullable<typeof open>, end: number): void {
    if (p.name === "" || p.valueFirst) {
      error(
        p.at,
        end,
        'A message parameter needs a name first, as in `{the ${door}}`. Write "{{" to print a brace.',
      );
      return;
    }
    if (known.names.has(p.name)) return;
    const nameEnd = p.nameAt + p.name.length;
    const suggestion = closestName(p.name, known.names.keys());
    const mean = suggestion === undefined ? "" : ` Did you mean \`{${suggestion}}\`?`;
    const reader = known.fallbacks[0];
    if (!reader) {
      error(
        p.nameAt,
        nameEnd,
        `\`{${p.name}}\` isn't a message parameter.${mean}${suggestion === undefined ? ' Packages such as the world model register them; check the name, or write "{{" to print a brace.' : ""}`,
      );
      return;
    }
    if (suggestion === undefined || known.fallbacks.some((f) => f.words.has(p.name.toLowerCase())))
      return;
    problems.push({
      severity: "warning",
      start: p.nameAt,
      end: nameEnd,
      message: `\`{${p.name}}\` isn't a message parameter, so ${reader.from} reads it as ${reader.reads}.${mean}`,
    });
  }
}

/** Every `t` template in `file`, checked. */
export function checkTextIn(
  file: ts.SourceFile,
  checker: ts.TypeChecker,
  known: KnownParameters,
): TextProblem[] {
  const problems: TextProblem[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTaggedTemplateExpression(node) && isCoreT(node.tag, checker)) {
      problems.push(...checkTemplate(node.template, file, known));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return problems;
}
