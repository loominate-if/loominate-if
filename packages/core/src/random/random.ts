/**
 * Named, seeded random streams (#24, ADR 0008).
 *
 * Every stream's position lives in the state store, so undo, save, and replay
 * see it: undoing and retrying draws the same values. A stream's starting point
 * comes from the master seed and the stream's full name alone, so draws from one
 * stream never shift another, and a substream such as `world/level-3` gives the
 * same results whenever it's first used.
 */
import { boundStore } from "../objects/objects.js";
import { StateError } from "../state/value.js";

/** The state entity holding the master seed. IDs starting with `$` are reserved for core. */
export const RANDOM_ID = "$random";
/** The field of {@link RANDOM_ID} holding the master seed. */
export const SEED_FIELD = "seed";
/** The state entity holding each stream's position, one field per stream name. */
const STREAMS_ID = "$streams";

/** A named source of random values. Streams hold no state themselves; their position is in the story's store. */
export interface RandomStream {
  /** The stream's full name, with substream names joined by `/`, as in `world/level-3`. */
  readonly name: string;
  /** A number from 0 inclusive to 1 exclusive. */
  next(): number;
  /**
   * A whole number from `min` to `max`, both inclusive, without bias.
   * @throws {@link StateError} unless both are safe integers, `min ≤ max`, and the range has at most 2³² values.
   */
  int(min: number, max: number): number;
  /**
   * True with probability `p`.
   * @throws {@link StateError} unless `p` is from 0 to 1.
   */
  chance(p: number): boolean;
  /**
   * One of `items`, each equally likely.
   * @throws {@link StateError} if `items` is empty.
   */
  pick<T>(items: readonly T[]): T;
  /** A shuffled copy of `items`. */
  shuffle<T>(items: readonly T[]): T[];
  /**
   * A substream, named `<this name>/<name>`. Its results depend only on the
   * master seed and its name, never on what this stream has drawn.
   */
  substream(name: string): RandomStream;
}

const NAME = /^[^/]+$/;

/**
 * A random stream. Define streams once, in a module, and draw from them in
 * effects, never while a passage renders.
 *
 * @example
 * ```ts
 * export const weather = randomStream("weather");
 * // {on enter: if (weather.chance(0.3)) raining.on = true}
 * ```
 * @throws {@link StateError} if `name` is empty or contains `/`.
 */
export function randomStream(name: string): RandomStream {
  return makeStream(checkName(name));
}

function checkName(name: string): string {
  if (!NAME.test(name)) {
    throw new StateError(
      `randomStream ${JSON.stringify(name)}: a stream name is non-empty and has no "/"; use substream() for nesting.`,
    );
  }
  return name;
}

function makeStream(name: string): RandomStream {
  const where = `random stream ${JSON.stringify(name)}`;

  /** Draws one 32-bit value, advancing the stored position. */
  const draw = (): number => {
    const store = boundStore(where, true);
    const seed = store.get(RANDOM_ID, SEED_FIELD);
    if (typeof seed !== "string") {
      throw new StateError(
        `${where}: the story has no seed yet. Draw from streams in effects, which run after begin().`,
      );
    }
    const stored = store.get(STREAMS_ID, name);
    const state = isState(stored) ? [...stored] : startState(seed, name);
    const value = sfc32(state);
    store.set(STREAMS_ID, name, state);
    return value;
  };

  const int = (min: number, max: number): number => {
    if (
      !Number.isSafeInteger(min) ||
      !Number.isSafeInteger(max) ||
      min > max ||
      max - min >= 2 ** 32
    ) {
      throw new StateError(
        `${where}: int(${String(min)}, ${String(max)}) needs whole numbers with min ≤ max, at most 2³² apart.`,
      );
    }
    const range = max - min + 1;
    // Rejecting the top sliver of values that don't divide evenly keeps every result equally likely.
    const limit = Math.floor(2 ** 32 / range) * range;
    let value = draw();
    while (value >= limit) value = draw();
    return min + (value % range);
  };

  return Object.freeze({
    name,
    next: () => draw() / 2 ** 32,
    int,
    chance(p: number) {
      if (!(p >= 0 && p <= 1)) {
        throw new StateError(`${where}: chance(${String(p)}) needs a probability from 0 to 1.`);
      }
      return draw() / 2 ** 32 < p;
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new StateError(`${where}: pick() needs at least one item.`);
      return items[int(0, items.length - 1)] as T;
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = [...items];
      // Fisher–Yates, from the end.
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i);
        [out[i], out[j]] = [out[j] as T, out[i] as T];
      }
      return out;
    },
    substream: (sub: string) => makeStream(`${name}/${checkName(sub)}`),
  });
}

function isState(value: unknown): value is readonly number[] {
  return Array.isArray(value) && value.length === 4 && value.every((n) => Number.isInteger(n));
}

/** A stream's first position: the cyrb128 hash of the seed and name, then 15 draws to mix it. */
function startState(seed: string, name: string): number[] {
  const state = cyrb128(`${seed}\u0000${name}`);
  for (let i = 0; i < 15; i++) sfc32(state);
  return state;
}

/**
 * cyrb128: a 128-bit string hash over UTF-16 code units, as four unsigned
 * 32-bit words. Part of ADR 0008; never change it.
 */
export function cyrb128(text: string): number[] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/**
 * sfc32 (Chris Doty-Humphrey's Small Fast Chaotic generator): advances `state`
 * in place and returns an unsigned 32-bit value. Part of ADR 0008; never change it.
 */
export function sfc32(state: number[]): number {
  let [a = 0, b = 0, c = 0, d = 0] = state;
  const t = (((a + b) | 0) + d) | 0;
  d = (d + 1) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) | 0;
  state[0] = a >>> 0;
  state[1] = b >>> 0;
  state[2] = c >>> 0;
  state[3] = d >>> 0;
  return t >>> 0;
}
