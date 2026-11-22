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
  useVisitMemory,
  type EffectContext,
  type Handle,
  type ObjectRef,
  type StateId,
} from "@loominate-if/core";
import { currentPlayerMind, mindFor, playerMind } from "./actors.js";
import { inScope } from "./scope.js";
import { roomPassageIds } from "./rooms.js";
import { isPlace, thingFor, type Thing } from "./things.js";

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
  /**
   * Forgets a fact for good, or that it has seen or knows of a thing. For a
   * place, it also forgets visiting it and the passages that describe it.
   */
  forget(what: Fact | ObjectRef): void;
  /** Forgets for good its visits to `passage`, or with no passage, to every passage and room. */
  forgetVisits(passage?: string): void;
  /**
   * Blocks everything it remembers, until {@link MindKnowledge.regainMemory}:
   * facts, things seen and familiar, and visits. New memories still form.
   */
  loseMemory(): void;
  /**
   * Lifts {@link MindKnowledge.loseMemory}'s amnesia: what it remembered
   * before and what it learned since are remembered together. Visits add up,
   * and a fact learned both times keeps its first source.
   */
  regainMemory(): void;
  /** Whether {@link MindKnowledge.loseMemory} is blocking its memories. */
  readonly hasAmnesia: boolean;
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
  "forgetVisits",
  "loseMemory",
  "regainMemory",
  "hasAmnesia",
] as const satisfies readonly (keyof MindKnowledge)[];

/** What a mind remembers, as stored. */
type Memories = {
  facts: Record<string, { from?: ObjectRef; passage?: string }>;
  seen: Record<string, true>;
  familiar: Record<string, true>;
  /** Visits to passages, by passage ID. */
  visits: Record<string, number>;
  /** Visits to rooms, by place ID. */
  roomVisits: Record<string, number>;
};

/** What one mind knows: its memories, and those formed during amnesia, which hides the rest. */
type KnowledgeRecord = Handle<{ memories: Memories; amnesia: Memories | null }>;

const blank = (): Memories => ({ facts: {}, seen: {}, familiar: {}, visits: {}, roomVisits: {} });

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
    object(`world:knowledge:${m.id}`, { memories: blank(), amnesia: null as Memories | null }),
  );
}

/** The knowledge of the mind `ref` names. */
function recordOf(ref: ObjectRef, where: string): KnowledgeRecord {
  const found = records.get(mindFor(ref, where).id);
  if (!found) throw new StateError(`${where}: ${JSON.stringify(ref.id)} has no knowledge record.`);
  return found;
}

/** The memories `m` can recall now: those since its amnesia, if it has any. */
function recall(m: ObjectRef, where: string): Memories {
  const record = recordOf(m, where);
  return record.amnesia ?? record.memories;
}

/** Every layer of `m`'s memories, blocked or not, for forgetting for good. */
function layers(m: ObjectRef, where: string): Memories[] {
  const record = recordOf(m, where);
  return record.amnesia ? [record.memories, record.amnesia] : [record.memories];
}

/** `table` without `keys`. */
const without = <V>(table: Record<string, V>, keys: readonly string[]): Record<string, V> =>
  Object.fromEntries(Object.entries(table).filter(([k]) => !keys.includes(k)));

/** Adds up two tables of visit counts. */
const added = (a: Record<string, number>, b: Record<string, number>): Record<string, number> => {
  const out = { ...a };
  for (const [k, n] of Object.entries(b)) out[k] = (out[k] ?? 0) + n;
  return out;
};

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
      return Object.hasOwn(recall(m, "knows").facts, f.id);
    },
    learn(f, options = {}) {
      checkFact(f, "learn");
      const memories = recall(m, "learn");
      if (Object.hasOwn(memories.facts, f.id)) return;
      memories.facts[f.id] = {
        ...(options.from !== undefined && { from: options.from }),
        ...(options.passage !== undefined && { passage: options.passage }),
      };
    },
    sourceOf(f) {
      checkFact(f, "sourceOf");
      const stored = recall(m, "sourceOf").facts[f.id];
      if (!stored) return undefined;
      return {
        ...(stored.from && { from: thingFor(stored.from) ?? stored.from }),
        ...(stored.passage !== undefined && { passage: stored.passage }),
      };
    },
    knownFacts() {
      return Object.keys(recall(m, "knownFacts").facts).flatMap((id) => {
        const f = allFacts.get(id);
        return f ? [f] : [];
      });
    },
    see(t) {
      checkThing(t, "see");
      recall(m, "see").seen[t.id] = true;
    },
    hasSeen(t) {
      checkThing(t, "hasSeen");
      return Object.hasOwn(recall(m, "hasSeen").seen, t.id);
    },
    learnAbout(t) {
      checkThing(t, "learnAbout");
      recall(m, "learnAbout").familiar[t.id] = true;
    },
    knowsAbout(t) {
      const found = checkThing(t, "knowsAbout");
      const memories = recall(m, "knowsAbout");
      return (
        Object.hasOwn(memories.seen, t.id) ||
        Object.hasOwn(memories.familiar, t.id) ||
        (found as unknown as { isFamiliar?: unknown }).isFamiliar === true
      );
    },
    forget(what) {
      if (isFact(what)) {
        for (const memories of layers(m, "forget")) {
          memories.facts = without(memories.facts, [what.id]);
        }
        return;
      }
      const t = checkThing(what, "forget");
      const passages = isPlace(t) ? roomPassageIds(t) : [];
      for (const memories of layers(m, "forget")) {
        memories.seen = without(memories.seen, [t.id]);
        memories.familiar = without(memories.familiar, [t.id]);
        memories.roomVisits = without(memories.roomVisits, [t.id]);
        memories.visits = without(memories.visits, passages);
      }
    },
    forgetVisits(passage) {
      for (const memories of layers(m, "forgetVisits")) {
        if (passage === undefined) {
          memories.visits = {};
          memories.roomVisits = {};
        } else {
          memories.visits = without(memories.visits, [passage]);
        }
      }
    },
    loseMemory() {
      const record = recordOf(m, "loseMemory");
      if (!record.amnesia) record.amnesia = blank();
    },
    regainMemory() {
      const record = recordOf(m, "regainMemory");
      const since = record.amnesia;
      if (!since) return;
      const before = record.memories;
      record.memories = {
        facts: { ...before.facts, ...without(since.facts, Object.keys(before.facts)) },
        seen: { ...before.seen, ...since.seen },
        familiar: { ...before.familiar, ...since.familiar },
        visits: added(before.visits, since.visits),
        roomVisits: added(before.roomVisits, since.roomVisits),
      };
      record.amnesia = null;
    },
    get hasAmnesia() {
      return recordOf(m, "hasAmnesia").amnesia !== null;
    },
  };
}

/** How many visits to `passage` the mind `m` remembers. @internal */
export function rememberedVisits(m: ObjectRef, passage: string): number {
  return recall(m, "visits").visits[passage] ?? 0;
}

/** Has `m` remember one more visit to `passage`. @internal */
export function rememberVisit(m: ObjectRef, passage: string): void {
  const memories = recall(m, "visits");
  memories.visits[passage] = (memories.visits[passage] ?? 0) + 1;
}

/** How many visits to `room` the mind `m` remembers. @internal */
export function rememberedRoomVisits(m: ObjectRef, room: ObjectRef): number {
  return recall(m, "visitsTo").roomVisits[room.id] ?? 0;
}

/** Has `m` remember one more visit to `room`. @internal */
export function rememberRoomVisit(m: ObjectRef, room: ObjectRef): void {
  const memories = recall(m, "enterRoom");
  memories.roomVisits[room.id] = (memories.roomVisits[room.id] ?? 0) + 1;
}

/**
 * The methods every mind is defined with. Each asks `this`, so an actor,
 * which is its body, asks its mind. @internal
 */
export const mindKnowledge: MindKnowledge = forwarding(function (this: ObjectRef) {
  return knowledgeOf(this);
});

/**
 * An object with {@link MindKnowledge}'s methods and `hasAmnesia`, each
 * asking the knowledge `target` gives, called with the object as `this`.
 */
function forwarding(target: (this: ObjectRef) => MindKnowledge): MindKnowledge {
  const out: PropertyDescriptorMap = {};
  for (const name of KNOWLEDGE_METHODS) {
    out[name] =
      name === "hasAmnesia"
        ? {
            get(this: ObjectRef) {
              return target.call(this).hasAmnesia;
            },
            enumerable: true,
          }
        : {
            value: function (this: ObjectRef, ...args: unknown[]) {
              return (target.call(this)[name] as (...a: unknown[]) => unknown)(...args);
            },
            enumerable: true,
          };
  }
  return Object.defineProperties({}, out) as MindKnowledge;
}

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
export const player: Player = Object.freeze(
  Object.defineProperty(
    forwarding(() => knowledgeOf(playerNow())),
    "mind",
    { get: playerNow, enumerable: true },
  ) as Player,
);

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
    const memories = recall(m, "seeing");
    for (const t of seen) memories.seen[t.id] = true;
  }
}

// Passages' visits and first visits are what the player's mind remembers.
useVisitMemory({
  count(passage) {
    const m = currentPlayerMind();
    return m ? rememberedVisits(m, passage) : undefined;
  },
  record(passage) {
    const m = currentPlayerMind();
    if (m) rememberVisit(m, passage);
  },
});
