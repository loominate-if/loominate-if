/**
 * Checking a directive's arguments against what its package declared
 * (ADR 0004, ADR 0015), and reading them into values the generator writes.
 */
import type { CodeSyntax, DirectiveSyntax, NameSyntax, Span } from "../passages/syntax.js";
import type { ArgumentSpec } from "./extension.js";

/** An argument as written, matched to its declaration and read. */
export type BoundArgument = { readonly spec: ArgumentSpec } & (
  | { readonly kind: "expression" | "condition"; readonly code: CodeSyntax }
  | { readonly kind: "duration"; readonly ms: number; readonly span: Span }
  | { readonly kind: "passage"; readonly target: NameSyntax }
  | { readonly kind: "words"; readonly words: readonly string[]; readonly span: Span }
  | { readonly kind: "choice"; readonly word: string; readonly span: Span }
);

/** A problem with an argument, positioned for the author. */
export type ArgumentProblem = { readonly message: string; readonly span: Span };

const DURATION = /^(\d+(?:\.\d+)?|\.\d+)(ms|s)$/;
const WORD = /^[\p{L}\p{N}_-]+$/u;

const quote = (s: string): string => `\`${s}\``;
const list = (words: readonly string[]): string =>
  words.length <= 1
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} or ${words.at(-1) ?? ""}`;

/** What an argument takes, as a phrase. */
function describe(spec: ArgumentSpec): string {
  if (spec.kind === "passage") return "a passage, `-> Name`";
  if (spec.named === true) return quote(`${spec.name}: …`);
  switch (spec.kind) {
    case "expression":
      return `an expression (${spec.name})`;
    case "condition":
      return "a condition";
    case "duration":
      return "a duration such as `1.5s` or `300ms`";
    case "words":
      return `words (${spec.name})`;
    case "choice":
      return list((spec.choices ?? []).map(quote));
  }
}

/** What a directive takes, as a sentence fragment. */
function takes(specs: readonly ArgumentSpec[]): string {
  if (specs.length === 0) return "no arguments";
  return specs
    .map((s) => (s.required === true ? describe(s) : `optionally ${describe(s)}`))
    .join(", then ");
}

/** How an argument was written, for messages. */
const written = (b: BoundArgument): string =>
  b.spec.kind === "passage" || b.spec.named === true
    ? quote(b.spec.kind === "passage" ? "-> …" : `${b.spec.name}:`)
    : b.kind === "choice"
      ? quote(b.word)
      : quote(b.spec.name);

/**
 * Matches `directive`'s arguments to `specs`: passages to the passage
 * argument, `key: value` to named ones, and the rest in order.
 */
export function bindArguments(
  directive: DirectiveSyntax,
  specs: readonly ArgumentSpec[],
  example: string | undefined,
): { readonly args: readonly BoundArgument[]; readonly problems: readonly ArgumentProblem[] } {
  const name = `\`{${directive.name}}\``;
  const like = example === undefined ? "" : `, like \`${example}\``;
  const problems: ArgumentProblem[] = [];
  const args: BoundArgument[] = [];
  const problem = (message: string, span: Span): void => {
    problems.push({ message, span });
  };
  const positional = specs.filter((s) => s.kind !== "passage" && s.named !== true);
  let next = 0;

  const bind = (spec: ArgumentSpec, code: CodeSyntax, span: Span): void => {
    switch (spec.kind) {
      case "expression":
      case "condition":
        args.push({ spec, kind: spec.kind, code });
        return;
      case "passage":
        // Passages are written `-> Name` and matched apart.
        return;
      case "duration": {
        const m = DURATION.exec(code.code);
        if (!m) {
          problem(
            `${name} needs a duration such as \`1.5s\` or \`300ms\`, not \`${code.code}\`.`,
            span,
          );
          return;
        }
        const n = Number(m[1]);
        args.push({ spec, kind: "duration", ms: m[2] === "s" ? n * 1000 : n, span });
        return;
      }
      case "words": {
        const words = code.code.split(/\s+/);
        const bad = words.find((w) => !WORD.test(w));
        if (bad !== undefined) {
          problem(`${name} takes plain words for ${spec.name}, but \`${bad}\` isn't one.`, span);
          return;
        }
        args.push({ spec, kind: "words", words, span });
        return;
      }
      case "choice": {
        const choices = spec.choices ?? [];
        if (!choices.includes(code.code)) {
          problem(`${name} takes ${list(choices.map(quote))} here, not \`${code.code}\`.`, span);
          return;
        }
        args.push({ spec, kind: "choice", word: code.code, span });
        return;
      }
    }
  };

  for (const a of directive.args) {
    if (a.type === "target") {
      const spec = specs.find((s) => s.kind === "passage");
      if (!spec) {
        problem(`${name} doesn't take a passage. It takes ${takes(specs)}.`, a.span);
      } else if (args.some((b) => b.spec === spec)) {
        problem(`${name} takes one passage.`, a.span);
      } else {
        args.push({ spec, kind: "passage", target: a.target });
      }
    } else if (a.type === "named") {
      const spec = specs.find(
        (s) => s.kind !== "passage" && s.named === true && s.name === a.key.name,
      );
      if (!spec) {
        problem(
          `${name} has no \`${a.key.name}:\` argument. It takes ${takes(specs)}.`,
          a.key.span,
        );
      } else if (args.some((b) => b.spec === spec)) {
        problem(`${name} already has \`${a.key.name}:\`.`, a.span);
      } else {
        bind(spec, a.value, a.span);
      }
    } else {
      // An optional word can be left out: one a later optional choice takes skips to it.
      const here = positional[next];
      if (
        here?.kind === "choice" &&
        here.required !== true &&
        !(here.choices ?? []).includes(a.value.code)
      ) {
        const later = positional.findIndex(
          (s, i) => i > next && s.kind === "choice" && (s.choices ?? []).includes(a.value.code),
        );
        if (later >= 0) next = later;
      }
      const spec = positional[next++];
      if (!spec) {
        problem(`${name} doesn't take \`${a.value.code}\` here. It takes ${takes(specs)}.`, a.span);
      } else {
        bind(spec, a.value, a.span);
      }
    }
  }

  for (const spec of specs) {
    if (spec.required === true && !args.some((b) => b.spec === spec)) {
      // A malformed argument was already reported; don't also call it missing.
      if (problems.length > 0) continue;
      const instead = spec.unless ?? [];
      if (args.some((b) => instead.includes(b.spec.name))) continue;
      const or = instead.map((n) => `, or \`${n}\``).join("");
      problem(`${name} needs ${describe(spec)}${or}${like}.`, directive.span);
    }
  }
  for (const b of args) {
    for (const x of b.spec.excludes ?? []) {
      const other = args.find((o) => o.spec.name === x);
      if (other) {
        problem(`${name} can't take ${written(b)} and ${written(other)} together.`, directive.span);
      }
    }
  }
  return { args, problems };
}
