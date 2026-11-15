/**
 * Which directive names the parser recognizes. A precursor to the full
 * extension API (#187), which adds argument declarations, role scoping, and
 * diagnostics on top of this.
 */

/** How a directive is written, as far as the parser needs to know. */
export type DirectiveSpec = {
  /** The name, lowercase words separated by single spaces, such as `beat` or `on enter`. */
  readonly name: string;
  /**
   * True if the directive takes TypeScript statements after a colon,
   * `{on enter: …}`. Otherwise it takes arguments, `{beat 1.5s}`.
   */
  readonly code?: boolean;
};

/** The directives core passage syntax provides (ADR 0004). */
export const coreDirectives: readonly DirectiveSpec[] = [
  { name: "on first visit", code: true },
  { name: "on enter", code: true },
  { name: "on leave", code: true },
  { name: "beat" },
  { name: "wait" },
  { name: "continue" },
  { name: "when" },
];

/** Names that belong to the grammar itself and can't be registered. */
const GRAMMAR = new Set(["if", "else", "else if"]);
const NAME = /^[a-z][a-z0-9-]*( [a-z][a-z0-9-]*)*$/;

/** A directive name ready for matching: the spec and a pattern for its words. */
export type DirectiveMatcher = { readonly spec: DirectiveSpec; readonly words: readonly string[] };

/**
 * Checks `specs` and orders them longest name first, so `on first visit`
 * wins over a shorter name that starts the same way.
 * @throws Error if a name is malformed, reserved, or given twice.
 */
export function directiveMatchers(specs: readonly DirectiveSpec[]): DirectiveMatcher[] {
  const seen = new Set<string>();
  for (const spec of specs) {
    if (!NAME.test(spec.name)) {
      throw new Error(
        `directive "${spec.name}": names are lowercase words separated by single spaces.`,
      );
    }
    if (GRAMMAR.has(spec.name)) {
      throw new Error(`directive "${spec.name}": that name is part of the passage grammar.`);
    }
    if (seen.has(spec.name)) throw new Error(`directive "${spec.name}" is registered twice.`);
    seen.add(spec.name);
  }
  return specs
    .map((spec) => ({ spec, words: spec.name.split(" ") }))
    .sort((a, b) => b.spec.name.length - a.spec.name.length);
}
