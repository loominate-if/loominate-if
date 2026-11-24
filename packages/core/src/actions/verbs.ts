/**
 * Verb phrases (#79, ADR 0075): what a player might type for an action, for
 * a parser and an autocomplete command line to come. Nothing reads them
 * yet, but a game written now works with a parser later. A phrase is words,
 * a slot for each of the action's things by role, as `{thing}`, and
 * optional words in parentheses: "pick (up) {thing}".
 */
import { StateError } from "../state/value.js";

/** One part of a verb phrase. */
export type VerbPart =
  | { readonly kind: "word"; readonly word: string }
  | { readonly kind: "optional"; readonly words: readonly string[] }
  | { readonly kind: "slot"; readonly role: string };

/** A verb phrase, as written and in parts. */
export type VerbPhrase = {
  /** As written, as `unlock {thing} with {tool}`. */
  readonly text: string;
  readonly parts: readonly VerbPart[];
};

/**
 * Reads a verb phrase into its parts.
 *
 * @throws StateError if its braces or parentheses don't match, a slot is
 * empty, or it has no words outside its slots.
 */
export function parseVerbPhrase(text: string, where = "verb phrase"): VerbPhrase {
  const at = `${where} ${JSON.stringify(text)}`;
  const parts: VerbPart[] = [];
  const tokens = text.match(/\{[^{}]*\}|\([^()]*\)|[^\s{}()]+|[{}()]/g) ?? [];
  for (const token of tokens) {
    if (token.startsWith("{") && token.endsWith("}") && token.length > 1) {
      const role = token.slice(1, -1).trim();
      if (!/^[A-Za-z_$][\w$]*$/.test(role)) {
        throw new StateError(`${at}: a slot names one of the action's things by role, as {thing}.`);
      }
      parts.push({ kind: "slot", role });
    } else if (token.startsWith("(") && token.endsWith(")") && token.length > 1) {
      const words = token
        .slice(1, -1)
        .trim()
        .split(/\s+/)
        .filter((w) => w !== "");
      if (words.length === 0 || words.some((w) => /[{}]/.test(w))) {
        throw new StateError(
          `${at}: optional words in parentheses are words only, as "pick (up) {thing}".`,
        );
      }
      parts.push({ kind: "optional", words });
    } else if (/^[{}()]$/.test(token)) {
      throw new StateError(
        `${at}: its "${token}" has no partner. Write slots as {thing} and optional words as (up).`,
      );
    } else {
      parts.push({ kind: "word", word: token.toLowerCase() });
    }
  }
  if (!parts.some((p) => p.kind === "word")) {
    throw new StateError(`${at}: it needs a word to start from, as "take {thing}".`);
  }
  return Object.freeze({ text, parts: Object.freeze(parts) });
}
