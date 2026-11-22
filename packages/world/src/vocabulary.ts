/**
 * Vocabulary (#73, ADR 0043): the words a player could use for a thing, for
 * a parser to come. Nothing in the world model reads them; they're typed
 * now so games written today work with a parser later.
 */
import { StateError, type ObjectRef } from "@loominate-if/core";
import { pluralOf } from "./listing.js";
import { thingFor, type Thing, type Vocabulary } from "./things.js";

/** A thing's vocabulary, every list present. */
export type FullVocabulary = {
  readonly nouns: readonly string[];
  readonly adjectives: readonly string[];
  readonly plurals: readonly string[];
};

/** `words` lowercased, without repeats, in order. */
const tidy = (words: readonly string[]): string[] => [
  ...new Set(words.map((w) => w.toLowerCase())),
];

/**
 * The words a player could use for `thing`: those it gives as `vocab`, after
 * those of its name, whose last word is a noun and the rest adjectives, with
 * the name's plural. "brass lantern" gives the noun "lantern", the adjective
 * "brass", and the plural "lanterns".
 *
 * @example
 * ```ts
 * export const lantern = thing("lantern", {
 *   name: "brass lantern",
 *   vocab: { nouns: ["lamp"], adjectives: ["old"] },
 * });
 * vocabOf(lantern); // nouns lantern, lamp; adjectives brass, old; plurals lanterns
 * ```
 *
 * @throws StateError if `thing` isn't a thing, or a word has a space in it.
 */
export function vocabOf(thing: ObjectRef): FullVocabulary {
  const found = thingFor(thing);
  if (!found) {
    throw new StateError(
      `vocabOf: ${JSON.stringify(thing.id)} isn't defined with thing() or place().`,
    );
  }
  const given = ((found as Thing & { vocab?: Vocabulary }).vocab ?? {}) as Vocabulary;
  for (const word of [
    ...(given.nouns ?? []),
    ...(given.adjectives ?? []),
    ...(given.plurals ?? []),
  ]) {
    if (/\s/.test(word) || word === "") {
      throw new StateError(
        `vocabOf ${JSON.stringify(found.id)}: "${word}" isn't one word. List each word on its own.`,
      );
    }
  }
  const words = found.name.trim().split(/\s+/);
  const noun = words.at(-1);
  // A proper name, such as "Mira", has no plural of its own.
  const proper = (found as Thing & { isProper?: boolean }).isProper ?? /^\p{Lu}/u.test(found.name);
  const plural = proper ? undefined : pluralOf(found).trim().split(/\s+/).at(-1);
  return {
    nouns: tidy([...(noun ? [noun] : []), ...(given.nouns ?? [])]),
    adjectives: tidy([...words.slice(0, -1), ...(given.adjectives ?? [])]),
    plurals: tidy([...(plural ? [plural] : []), ...(given.plurals ?? [])]),
  };
}
