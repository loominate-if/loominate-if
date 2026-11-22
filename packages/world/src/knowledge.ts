/**
 * Knowledge: facts, where they came from, and what each mind has seen or
 * knows of (#67, ADR 0035).
 *
 * Facts are defined once, in code, and are never state. What a mind knows is
 * state, on a world-owned record per mind, so undo, saves, and the inspector
 * see it. Minds ask through methods of their own, `mira.knows(…)`, and
 * {@link player} asks for whichever mind the player controls now.
 */
import {
  object,
  StateError,
  type EffectContext,
  type Handle,
  type ObjectRef,
  type StateId,
} from "@loominate-if/core";
import { mindFor, playerMind } from "./actors.js";
import { inScope } from "./scope.js";
import { thingFor, type Thing } from "./things.js";

/** A fact a mind can know, such as "the butler handled the letter". */
export type Fact<Id extends string = string> = {
  /** Its stable ID, under which minds remember it. */
  readonly id: Id;
  /** What it says, for the inspector and for a game's notes. */
  readonly text: string;
};

/** How {@link fact} defines a fact. */
export type FactOptions = {
  /** What it says. */
  readonly text: string;
};

/** Where a mind learned a fact. */
export type FactSource = {
  /** The thing or mind it came from, such as the diary or the gardener. */
  readonly from?: ObjectRef;
  /** The passage it was revealed in. */
  readonly passage?: string;
};

/** How a mind learns a fact. */
export type LearnOptions = FactSource;

/** What every mind can do with what it knows. An actor passes these through to its mind. */
export type MindKnowledge = {
  /** Whether it knows `fact`. */
  knows(fact: Fact): boolean;
  /**
   * Learns `fact`, from a thing or mind, or in a passage. Learning a fact it
   * already knows keeps where it first learned it.
   */
  learn(fact: Fact, options?: LearnOptions): void;
  /** Where it first learned `fact`, or `undefined` if it doesn't know it. */
  sourceOf(fact: Fact): FactSource | undefined;
  /** The facts it knows, in the order it learned them. */
  knownFacts(): Fact[];
  /** Marks `thing` as seen, as arriving in a room does for everything in sight. */
  see(thing: ObjectRef): void;
  /** Whether it has seen `thing`. */
  hasSeen(thing: ObjectRef): boolean;
  /** Makes `thing` familiar: known of without being seen, such as a famous painting. */
  learnAbout(thing: ObjectRef): void;
  /** Whether it knows of `thing`: it has seen it, it's familiar, or the thing has `isFamiliar: true`. */
  knowsAbout(thing: ObjectRef): boolean;
  /** Forgets a fact, or that it has seen or knows of a thing. */
  forget(what: Fact | ObjectRef): void;
};

/** The names of {@link MindKnowledge}'s methods, which a mind's own properties can't use. @internal */
export const KNOWLEDGE_METHODS = [
  "knows",
  "learn",
  "sourceOf",
  "knownFacts",
  "see",
  "hasSeen",
  "learnAbout",
  "knowsAbout",
  "forget",
] as const satisfies readonly (keyof MindKnowledge)[];

/** What one mind knows, as stored. */
type KnowledgeRecord = Handle<{
  facts: Record<string, { from?: ObjectRef; passage?: string }>;
  seen: Record<string, true>;
  familiar: Record<string, true>;
}>;

/** Every fact, by ID. */
const allFacts = new Map<string, Fact>();
/** Each mind's knowledge, by the mind's ID. */
const records = new Map<StateId, KnowledgeRecord>();

/**
 * Defines a fact. Give it a stable ID: minds remember facts by it, so saves
 * depend on it.
 *
 * @example
 * ```ts
 * export const missingLetter = fact("missingLetter", { text: "The letter is missing from the desk." });
 * ```
 *
 * @throws StateError if the ID is empty or another fact has it.
 */
export function fact<Id extends string>(id: Id, options: FactOptions): Fact<Id> {
  const where = `fact ${JSON.stringify(id)}`;
  if (typeof id !== "string" || id.length === 0) {
    throw new StateError("fact: the ID must be a non-empty string.");
  }
  if (allFacts.has(id)) {
    throw new StateError(`${where}: another fact has this ID. Give each fact its own.`);
  }
  const defined: Fact<Id> = Object.freeze({ id, text: options.text });
  allFacts.set(id, defined);
  return defined;
}

/**
 * Defines several facts at once, each key its ID, each value its text or
 * its {@link FactOptions}.
 *
 * @example
 * ```ts
 * export const facts = defineFacts({
 *   missingLetter: "The letter is missing from the desk.",
 *   butlerHandledLetter: "The butler handled the letter before supper.",
 * });
 * ```
 *
 * @throws StateError if another fact has one of the IDs.
 */
export function defineFacts<D extends Record<string, string | FactOptions>>(
  definitions: D,
): { readonly [K in keyof D & string]: Fact<K> } {
  const out: Record<string, Fact> = {};
  for (const [id, d] of Object.entries(definitions)) {
    out[id] = fact(id, typeof d === "string" ? { text: d } : d);
  }
  return Object.freeze(out) as { readonly [K in keyof D & string]: Fact<K> };
}

/** The fact with ID `id`, or `undefined`. */
export function factNamed(id: string): Fact | undefined {
  return allFacts.get(id);
}

/** Creates `m`'s knowledge, when it's defined. @internal */
export function createKnowledge(m: ObjectRef): void {
  records.set(
    m.id,
    object(`world:knowledge:${m.id}`, {
      facts: {} as Record<string, { from?: ObjectRef; passage?: string }>,
      seen: {} as Record<string, true>,
      familiar: {} as Record<string, true>,
    }),
  );
}

/** The knowledge of the mind `ref` names. */
function recordOf(ref: ObjectRef, where: string): KnowledgeRecord {
  const found = records.get(mindFor(ref, where).id);
  if (!found) throw new StateError(`${where}: ${JSON.stringify(ref.id)} has no knowledge record.`);
  return found;
}

/** Checks that `f` is a defined fact. */
function checkFact(f: Fact, where: string): void {
  if (allFacts.get(f.id) !== f) {
    throw new StateError(
      `${where}: ${JSON.stringify(f.id)} isn't a fact. Define it with fact() or defineFacts().`,
    );
  }
}

/** Checks that `t` is a thing or place. */
function checkThing(t: ObjectRef, where: string): Thing {
  const found = thingFor(t);
  if (!found) {
    throw new StateError(
      `${where}: ${JSON.stringify(t.id)} isn't defined with thing() or place().`,
    );
  }
  return found;
}

const isFact = (what: Fact | ObjectRef): what is Fact => allFacts.get(what.id) === what;

/** What a mind can do with what it knows, for `m`. */
function knowledgeOf(m: ObjectRef): MindKnowledge {
  return {
    knows(f) {
      checkFact(f, "knows");
      return Object.hasOwn(recordOf(m, "knows").facts, f.id);
    },
    learn(f, options = {}) {
      checkFact(f, "learn");
      const record = recordOf(m, "learn");
      if (Object.hasOwn(record.facts, f.id)) return;
      record.facts[f.id] = {
        ...(options.from !== undefined && { from: options.from }),
        ...(options.passage !== undefined && { passage: options.passage }),
      };
    },
    sourceOf(f) {
      checkFact(f, "sourceOf");
      const stored = recordOf(m, "sourceOf").facts[f.id];
      if (!stored) return undefined;
      return {
        ...(stored.from && { from: thingFor(stored.from) ?? stored.from }),
        ...(stored.passage !== undefined && { passage: stored.passage }),
      };
    },
    knownFacts() {
      return Object.keys(recordOf(m, "knownFacts").facts).flatMap((id) => {
        const f = allFacts.get(id);
        return f ? [f] : [];
      });
    },
    see(t) {
      checkThing(t, "see");
      recordOf(m, "see").seen[t.id] = true;
    },
    hasSeen(t) {
      checkThing(t, "hasSeen");
      return Object.hasOwn(recordOf(m, "hasSeen").seen, t.id);
    },
    learnAbout(t) {
      checkThing(t, "learnAbout");
      recordOf(m, "learnAbout").familiar[t.id] = true;
    },
    knowsAbout(t) {
      const found = checkThing(t, "knowsAbout");
      const record = recordOf(m, "knowsAbout");
      return (
        Object.hasOwn(record.seen, t.id) ||
        Object.hasOwn(record.familiar, t.id) ||
        (found as unknown as { isFamiliar?: unknown }).isFamiliar === true
      );
    },
    forget(what) {
      const record = recordOf(m, "forget");
      if (isFact(what)) {
        record.facts = Object.fromEntries(
          Object.entries(record.facts).filter(([id]) => id !== what.id),
        );
        return;
      }
      checkThing(what, "forget");
      record.seen = Object.fromEntries(
        Object.entries(record.seen).filter(([id]) => id !== what.id),
      );
      record.familiar = Object.fromEntries(
        Object.entries(record.familiar).filter(([id]) => id !== what.id),
      );
    },
  };
}

/**
 * The methods every mind is defined with. Each asks `this`, so an actor,
 * which is its body, asks its mind. @internal
 */
export const mindKnowledge: MindKnowledge = Object.fromEntries(
  KNOWLEDGE_METHODS.map((name) => [
    name,
    function (this: ObjectRef, ...args: unknown[]) {
      return (knowledgeOf(this)[name] as (...a: unknown[]) => unknown)(...args);
    },
  ]),
) as MindKnowledge;

/** The player: the mind the player controls now, whichever it is. */
export type Player = MindKnowledge & {
  /** The mind the player controls now. */
  readonly mind: ObjectRef;
};

const playerNow = (): ObjectRef => playerMind();

/**
 * The mind the player controls now, whichever it is: `player.knows(…)`
 * follows the player through {@link playAs}, possession, and body swaps,
 * where `you.knows(…)` asks one actor's mind.
 *
 * @example
 * ```ts
 * if (player.knows(facts.missingLetter)) …
 * ```
 */
export const player: Player = Object.freeze({
  get mind() {
    return playerNow();
  },
  ...(Object.fromEntries(
    KNOWLEDGE_METHODS.map((name) => [
      name,
      (...args: unknown[]) =>
        (knowledgeOf(playerNow())[name] as (...a: unknown[]) => unknown)(...args),
    ]),
  ) as MindKnowledge),
});

/** What `{reveal}` takes. */
export type RevealArguments = {
  /** The fact revealed. */
  readonly fact: Fact;
  /** The thing or mind it comes from, if the passage names one. */
  readonly from?: ObjectRef;
};

/**
 * What `{reveal facts.x}` calls when the player reaches it: the player's mind
 * learns the fact, from `from` if it's given, in this passage.
 */
export function reveal(args: RevealArguments, context?: EffectContext): void {
  player.learn(args.fact, {
    ...(args.from !== undefined && { from: args.from }),
    ...(context && { passage: context.passage }),
  });
}

/** Marks everything `observer` can see as seen by `minds`, such as on arrival in a room. @internal */
export function noteSights(observer: ObjectRef, minds: readonly ObjectRef[]): void {
  const seen = inScope(observer, "see");
  for (const m of minds) {
    const record = recordOf(m, "seeing");
    for (const t of seen) record.seen[t.id] = true;
  }
}
