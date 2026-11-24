/**
 * Storylets (#97, ADR 0070): passages that become eligible as conditions
 * are met, offered as a hand of choices with `{storylets}` or drawn with
 * `{storylet}`. Selection is by priority, then the one seen longest ago,
 * then a seeded tie-break that changes each move, so the same seed and
 * moves always select the same storylets. Once-only storylets and
 * cooldowns take storylets out of the pool for a while, or for good, and
 * every storylet can say why it isn't eligible.
 */
import { boundStore } from "../objects/objects.js";
import { RANDOM_ID, SEED_FIELD, cyrb128 } from "../random/random.js";
import { hook } from "../rules/hooks.js";
import { NameTaken, StateError } from "../state/value.js";
import { redirect, type EffectContext, type LinkNode, type PassageId } from "./story.js";

/** How long a storylet rests after it's seen: a number of moves, or, with a game clock such as the world model's, minutes. */
export type Cooldown = number | { readonly moves: number } | { readonly minutes: number };

/** A storylet's conditions: one test, or named tests, so the inspector can say which doesn't hold. */
export type StoryletCondition = (() => boolean) | Readonly<Record<string, () => boolean>>;

/** How a passage is made a storylet, for {@link storylet}. */
export type StoryletOptions = {
  /** When it's eligible. Named tests, as `{ "it's raining": () => weather.raining }`, are each explained. Always, if it doesn't say. */
  readonly when?: StoryletCondition;
  /** Higher comes first. Defaults to 0. */
  readonly priority?: number;
  /** Seen once, it's never eligible again. */
  readonly once?: boolean;
  /** How long it rests after it's seen. */
  readonly cooldown?: Cooldown;
  /** The deck it's in, as `"evenings"`, so a passage can offer or draw only those. */
  readonly deck?: string;
  /** The link's text in a hand. Defaults to the passage's name. */
  readonly label?: string | (() => string);
};

type Storylet = {
  readonly passage: PassageId;
  readonly options: StoryletOptions;
  readonly cooldown?: { readonly moves: number } | { readonly minutes: number };
};

const storylets = new Map<PassageId, Storylet>();

/** The state entity holding when each storylet was seen, by passage. */
const SEEN_ID = "$storylets";
/** The state entity holding the storylets' own move count, and the order things are seen in. */
const COUNT_ID = "$storyletCount";

type Seen = {
  readonly count: number;
  readonly order: number;
  readonly move: number;
  readonly minutes?: number;
};

let gameMinutes: (() => number) | undefined;

/**
 * Lets cooldowns count game minutes, from a clock such as the world
 * model's. @internal
 */
export function _useGameTime(minutes: () => number): void {
  gameMinutes = minutes;
}

const whole = (where: string, n: number): number => {
  if (!Number.isInteger(n) || n < 1) {
    throw new StateError(`${where}: ${String(n)} isn't a whole number, 1 or more.`);
  }
  return n;
};

/**
 * Makes a passage a storylet, in `story.ts`: it's offered by `{storylets}`
 * and drawn by `{storylet}` while it's eligible.
 *
 * @example
 * ```ts
 * storylet("Rainy visit", {
 *   when: { "it's raining": () => weather.raining, "Mira likes you": () => mira.likesYou },
 *   priority: 2,
 *   once: true,
 *   deck: "evenings",
 * });
 * ```
 *
 * @throws {@link NameTaken} if the passage is already a storylet, or
 * {@link StateError} if an option isn't valid.
 */
export function storylet(passage: PassageId, options: StoryletOptions = {}): void {
  const where = `storylet ${JSON.stringify(passage)}`;
  if (storylets.has(passage)) throw new NameTaken(`${where}: this passage is already a storylet.`);
  if (options.priority !== undefined && !Number.isFinite(options.priority)) {
    throw new StateError(`${where}: priority ${String(options.priority)} isn't a number.`);
  }
  if (options.deck?.trim() === "")
    throw new StateError(`${where}: name its deck, as deck: "evenings".`);
  const c = options.cooldown;
  const cooldown =
    c === undefined
      ? undefined
      : typeof c === "number"
        ? { moves: whole(`${where} cooldown`, c) }
        : "moves" in c
          ? { moves: whole(`${where} cooldown`, c.moves) }
          : { minutes: whole(`${where} cooldown`, c.minutes) };
  storylets.set(passage, { passage, options, ...(cooldown && { cooldown }) });
  watch();
}

/** Checks that every storylet names a passage, as a story begins. @internal */
export function _checkStorylets(exists: (id: PassageId) => boolean): void {
  for (const s of storylets.values()) {
    if (!exists(s.passage)) {
      throw new StateError(
        `storylet ${JSON.stringify(s.passage)}: there's no passage with this name. Check the spelling against the passage's :: line.`,
      );
    }
    if (s.cooldown && "minutes" in s.cooldown && !gameMinutes) {
      throw new StateError(
        `storylet ${JSON.stringify(s.passage)}: a cooldown in minutes needs a game clock, such as the world model's. Without one, count moves: cooldown: 3.`,
      );
    }
  }
}

const read = (id: string, key: string): unknown => boundStore("storylets", false).get(id, key);
const count = (key: string): number => {
  const n = read(COUNT_ID, key);
  return typeof n === "number" ? n : 0;
};
const seenOf = (passage: PassageId): Seen | undefined => read(SEEN_ID, passage) as Seen | undefined;

const plural = (n: number, unit: string): string => `${String(n)} ${unit}${n === 1 ? "" : "s"}`;

/** Minutes as days, hours, and minutes: "1 day", "2 hours and 30 minutes". */
const duration = (minutes: number): string => {
  const parts = [
    [Math.floor(minutes / 1440), "day"],
    [Math.floor((minutes % 1440) / 60), "hour"],
    [minutes % 60, "minute"],
  ] as const;
  const said = parts.filter(([n]) => n > 0).map(([n, unit]) => plural(n, unit));
  return said.length <= 1
    ? (said[0] ?? "")
    : `${said.slice(0, -1).join(", ")} and ${said.at(-1) ?? ""}`;
};

/** Why a storylet isn't eligible now, or `undefined` if it is, with the named tests that don't hold. */
function why(s: Storylet): { reason?: string; failing?: readonly string[] } {
  const seen = seenOf(s.passage);
  if (s.options.once === true && seen) return { reason: "It's once only, and it's been seen." };
  if (seen && s.cooldown) {
    const left =
      "moves" in s.cooldown
        ? seen.move + s.cooldown.moves - count("moves")
        : (seen.minutes ?? 0) + s.cooldown.minutes - (gameMinutes?.() ?? 0);
    if (left > 0) {
      const time = "moves" in s.cooldown ? plural(left, "move") : duration(left);
      return { reason: `It's resting: ${time} more.` };
    }
  }
  const when = s.options.when;
  if (when === undefined) return {};
  try {
    if (typeof when === "function") return when() ? {} : { reason: "Its condition doesn't hold." };
    const failing = Object.entries(when)
      .filter(([, test]) => !test())
      .map(([name]) => name);
    return failing.length === 0
      ? {}
      : { reason: `Not while these don't hold: ${failing.join("; ")}.`, failing };
  } catch (error) {
    return {
      reason: `Its condition failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

const inDeck = (s: Storylet, deck: string | undefined): boolean =>
  deck === undefined || s.options.deck === deck;

/** The seeded tie-break: the same for the same seed, move, and storylet, and different from move to move. */
const tieBreak = (passage: PassageId): number => {
  const seed = read(RANDOM_ID, SEED_FIELD);
  return (
    cyrb128(`${String(seed)}\u0000storylets\u0000${String(count("moves"))}\u0000${passage}`)[0] ?? 0
  );
};

/**
 * The eligible storylets, in `deck` if it's given, in the order they're
 * offered: highest priority first, then the one seen longest ago (or never),
 * then a seeded tie-break that changes each move.
 */
export function storyletsIn(deck?: string): readonly PassageId[] {
  const eligible = [...storylets.values()].filter(
    (s) => inDeck(s, deck) && why(s).reason === undefined,
  );
  const key = new Map(
    eligible.map((s) => [
      s.passage,
      { order: seenOf(s.passage)?.order ?? -1, tie: tieBreak(s.passage) },
    ]),
  );
  return eligible
    .sort((a, b) => {
      const p = (b.options.priority ?? 0) - (a.options.priority ?? 0);
      if (p !== 0) return p;
      const ka = key.get(a.passage);
      const kb = key.get(b.passage);
      return (ka?.order ?? 0) - (kb?.order ?? 0) || (ka?.tie ?? 0) - (kb?.tie ?? 0);
    })
    .map((s) => s.passage);
}

/** A storylet and whether it's eligible, as {@link storyletStatus} gives it. */
export type StoryletStatus = {
  readonly passage: PassageId;
  readonly deck?: string;
  readonly priority: number;
  readonly once: boolean;
  /** How many times it's been seen. */
  readonly seen: number;
  /** Where it comes in its deck's order now, from 1, while it's eligible. */
  readonly rank?: number;
  /** While it isn't eligible, why. */
  readonly reason?: string;
  /** The named tests in its `when` that don't hold. */
  readonly failing?: readonly string[];
};

/** Every storylet, in the order they were made, with whether it's eligible and why not: what the inspector shows. */
export function storyletStatus(): readonly StoryletStatus[] {
  const ranks = new Map<string, number>();
  for (const deck of new Set([...storylets.values()].map((s) => s.options.deck))) {
    storyletsIn(deck).forEach((p, i) => ranks.set(p, i + 1));
  }
  return [...storylets.values()].map((s) => {
    const { reason, failing } = why(s);
    const rank = ranks.get(s.passage);
    return Object.freeze({
      passage: s.passage,
      ...(s.options.deck !== undefined && { deck: s.options.deck }),
      priority: s.options.priority ?? 0,
      once: s.options.once === true,
      seen: seenOf(s.passage)?.count ?? 0,
      ...(rank !== undefined && { rank }),
      ...(reason !== undefined && { reason }),
      ...(failing !== undefined && { failing }),
    });
  });
}

const deckName = (deck: readonly string[] | undefined): string | undefined =>
  deck === undefined || deck.length === 0 ? undefined : deck.join(" ");

/**
 * A hand of storylets, from `{storylets}`, `{storylets evenings}`, or
 * `{storylets evenings, limit: 3}`: a link to each eligible one, in order,
 * up to `limit`.
 */
export function storyletLinks(
  args: { readonly deck?: readonly string[]; readonly limit?: number } = {},
): LinkNode[] {
  const { limit } = args;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new StateError(`{storylets}: limit ${String(limit)} isn't a whole number, 1 or more.`);
  }
  return storyletsIn(deckName(args.deck))
    .slice(0, limit)
    .map((passage) => {
      const label = storylets.get(passage)?.options.label;
      return {
        type: "link",
        label: typeof label === "function" ? label() : (label ?? passage),
        target: passage,
      };
    });
}

/**
 * Draws a storylet, from `{storylet}` or `{storylet evenings}`: the player
 * goes straight to the first eligible one, as part of the move. If none is
 * eligible, the passage carries on.
 */
export function storyletDraw(
  args: { readonly deck?: readonly string[] },
  // An arrival directive's runtime is called with the effect context too; a draw needs none of it.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- part of the directive's call
  context?: EffectContext,
): void {
  const [first] = storyletsIn(deckName(args.deck));
  if (first !== undefined) redirect(first);
}

let watching = false;
/** Starts keeping track of storylets, with the first one made, so a game without them runs none of this. */
function watch(): void {
  if (watching) return;
  watching = true;
  // A storylet is seen whenever the player arrives at it, however they got there.
  hook("passageEnter").rule(
    "storylets seen",
    ({ passage }) => {
      if (!storylets.has(passage)) return;
      const store = boundStore("storylets", true);
      const before = seenOf(passage);
      const order = count("order") + 1;
      store.set(COUNT_ID, "order", order);
      store.set(SEEN_ID, passage, {
        count: (before?.count ?? 0) + 1,
        order,
        // The move it's seen in: its count once the move ends.
        move: count("moves") + 1,
        ...(gameMinutes && { minutes: gameMinutes() }),
      });
    },
    { source: "@loominate-if/core" },
  );

  // Cooldowns count moves; a continue only acknowledges what was read, so it isn't one (#311).
  hook("turnEnd").rule(
    "storylet moves",
    ({ move }) => {
      if (move === "continue") return;
      boundStore("storylets", true).set(COUNT_ID, "moves", count("moves") + 1);
    },
    { source: "@loominate-if/core" },
  );
}
