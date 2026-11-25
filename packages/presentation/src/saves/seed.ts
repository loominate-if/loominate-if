/**
 * Shareable seeds (#132, ADR 0108): a new game's master seed as memorable
 * words, "amber-lantern-fog", shared with the game's version as
 * "amber-lantern-fog@1.2.0". A seed is only its words: the same words and
 * version give the same world, whatever list made them.
 */

/**
 * How a game uses seeds: `true` shows the seed and takes one to play,
 * `false` shows none, `"daily"` gives everyone today's, and any other text is
 * the seed every game starts from.
 */
export type SeedSetting = boolean | "daily" | (string & {});

/** How many words a seed has. */
const WORDS = 3;

/**
 * A fresh seed of `words`, each chosen by `draw`, which gives a random whole
 * number below 2³². Unbiased: draws past the last whole multiple of the list's
 * length are drawn again. @internal
 */
export function _freshWordSeed(words: readonly string[], draw: () => number): string {
  const limit = 2 ** 32 - (2 ** 32 % words.length);
  const picked: string[] = [];
  while (picked.length < WORDS) {
    const n = draw();
    if (n < limit) picked.push(words[n % words.length] ?? "");
  }
  return picked.join("-");
}

/** A 32-bit FNV-1a hash of `text`. */
function fnv(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** The day's seed, the same for everyone on that date: `day` as `2026-11-25`, in UTC. @internal */
export function _dailySeed(words: readonly string[], day: string): string {
  let i = 0;
  return _freshWordSeed(words, () => fnv(`daily:${day}:${String(i++)}`));
}

/** A seed as it's shared, with the version of the game it was made for. @internal */
export function _sharedSeed(seed: string, version: string): string {
  return `${seed}@${version}`;
}

/**
 * A seed as the player typed or a link gave it: lowercase, words joined by
 * hyphens, and the version after an `@`, if any. `undefined` when there are
 * no words. @internal
 */
export function _parseSeed(text: string): { seed: string; version?: string } | undefined {
  const at = text.lastIndexOf("@");
  const version = at < 0 ? "" : text.slice(at + 1).trim();
  const seed = (at < 0 ? text : text.slice(0, at))
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter((w) => w !== "")
    .join("-");
  if (seed === "") return undefined;
  return { seed, ...(version !== "" && { version }) };
}
