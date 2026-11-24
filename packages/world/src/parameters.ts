/**
 * The world model's message parameter names (#235): what grammar.ts
 * registers, and what its compiler extension declares so `t` templates can
 * be checked. It's plain data, so the extension can import it without the
 * runtime.
 */

/** Articles, and `subj`, which marks the subject verbs agree with. */
export const ARTICLES = ["the", "The", "a", "A", "subj"] as const;

/**
 * Pronouns, by form: 0 is the subject ("he"), 1 the object ("him"), 2 the
 * possessive ("his"), 3 the reflexive ("himself"). `{he}`, `{she}`,
 * `{they}`, and `{it}` are the same parameter; `her` is left out, being
 * both `him` and `his`.
 */
export const PRONOUN_FORMS: Readonly<Record<string, number>> = {
  he: 0,
  she: 0,
  they: 0,
  it: 0,
  him: 1,
  them: 1,
  his: 2,
  their: 2,
  its: 2,
  himself: 3,
  herself: 3,
  themselves: 3,
  itself: 3,
};

const capital = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/** Every message parameter name the world model registers. */
export const PARAMETER_NAMES: readonly string[] = [
  ...ARTICLES,
  ...Object.keys(PRONOUN_FORMS).flatMap((w) => [w, capital(w)]),
];

/** Verbs the verb fallback knows by name, irregular ones and their plain forms, which are never taken for misspelled parameters. */
export const KNOWN_VERBS: readonly string[] = [
  "is",
  "are",
  "was",
  "were",
  "has",
  "have",
  "does",
  "do",
  "goes",
  "go",
  "isn't",
  "aren't",
  "wasn't",
  "weren't",
  "hasn't",
  "haven't",
  "doesn't",
  "don't",
];
