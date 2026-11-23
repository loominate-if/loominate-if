/**
 * Perceived identity (#66, ADR 0066): others see bodies, not minds. Who
 * they think they're facing is a belief: the person the body belongs to,
 * whichever mind is in it, or whoever it's disguised as, until they learn
 * who's really there. An NPC's attitude, how they feel about someone, is
 * keyed by minds, so what they do reads their attitude toward whoever they
 * *believe* is in front of them: a disguise changes their response, never
 * how they feel about the real person.
 */
import { _storyRunning, object, StateError, type ObjectRef } from "@loominate-if/core";
import { isBody, mindFor, mindOf, ownerOf, type Mind } from "./actors.js";

/** What a body passes for while disguised: another actor, or a stranger described. */
export type DisguiseAs = ObjectRef | string;

const state = object("world:identity", {
  /** Disguises, by body: the mind it passes for, or what a stranger is called. */
  disguises: {} as Record<string, { readonly mind?: string; readonly stranger?: string }>,
  /**
   * What each observer has seen through, by observer, then body: the mind
   * that was really there and the disguise it wore, when they learned it.
   */
  seen: {} as Record<string, Record<string, { readonly mind: string; readonly disguise: string }>>,
  /** Attitudes, by observer, then the mind they feel about. */
  attitudes: {} as Record<string, Record<string, number>>,
});

/**
 * How things start, as `story.ts` sets them while the game loads: authored,
 * like the clock's start, so not state. During play, changes go to state,
 * which undo and saves see, over these.
 */
const starting = {
  attitudes: new Map<string, Map<string, number>>(),
  disguises: new Map<string, { readonly mind?: string; readonly stranger?: string }>(),
};

/** A body's disguise now: as changed in play, or as it started. */
const disguiseOf = (
  id: string,
): { readonly mind?: string; readonly stranger?: string } | undefined =>
  Object.hasOwn(state.disguises, id) ? state.disguises[id] : starting.disguises.get(id);

const checkBody = (where: string, b: ObjectRef): void => {
  if (!isBody(b)) {
    throw new StateError(
      `${where}: ${JSON.stringify(b.id)} isn't a body. Disguise an actor, or a body made with body().`,
    );
  }
};
/** A disguise as a key, to tell when it changes. */
const disguiseKey = (b: ObjectRef): string => JSON.stringify(disguiseOf(b.id) ?? null);

/**
 * Disguises a body: others take it for `as`, another actor, or, given
 * words, a stranger, as `"a hooded figure"`, until they see through it.
 * A new disguise fools even those who saw through the last one. In
 * `story.ts`, while the game loads, it's how the body starts.
 *
 * @example
 * ```ts
 * disguise(roy, { as: captain });
 * disguise(roy, { as: "a hooded figure" });
 * ```
 *
 * @throws StateError if `body` isn't a body, or `as` isn't a mind or words.
 */
export function disguise(b: ObjectRef, options: { readonly as: DisguiseAs }): void {
  checkBody("disguise", b);
  const as = options.as;
  if (typeof as === "string" && as.trim() === "") {
    throw new StateError('disguise: say what it passes for, as "a hooded figure".');
  }
  const d = typeof as === "string" ? { stranger: as } : { mind: mindFor(as, "disguise").id };
  // While the game loads, it's how the body starts.
  if (!_storyRunning()) starting.disguises.set(b.id, d);
  else state.disguises = { ...state.disguises, [b.id]: d };
}

/** Ends a body's disguise: others take it for whoever it belongs to again. */
export function undisguise(b: ObjectRef): void {
  checkBody("undisguise", b);
  if (!_storyRunning()) {
    starting.disguises.delete(b.id);
    return;
  }
  // A disguise it started in is ended by recording no disguise, which undo and saves see.
  state.disguises = { ...state.disguises, [b.id]: {} };
}

/** What a body passes for: the mind it's disguised as, words for a stranger, or `undefined` if it isn't disguised. */
export function disguisedAs(b: ObjectRef): Mind | string | undefined {
  const d = disguiseOf(b.id);
  if (!d || (d.mind === undefined && d.stranger === undefined)) return undefined;
  return d.mind !== undefined ? mindFor({ id: d.mind }, "disguisedAs") : d.stranger;
}

/**
 * The observer sees who's really in the body now: through its disguise,
 * and past whoever it belongs to to the mind inhabiting it. If the
 * disguise or the mind in it changes later, they can be fooled again.
 */
export function expose(b: ObjectRef, observer: ObjectRef): void {
  checkBody("expose", b);
  const o = mindFor(observer, "expose");
  const inside = mindOf(b);
  if (!inside) return; // an empty body: there's no one to see
  state.seen = {
    ...state.seen,
    [o.id]: { ...state.seen[o.id], [b.id]: { mind: inside.id, disguise: disguiseKey(b) } },
  };
}

/** Whether `observer` sees who's really in `body`: it isn't disguised and is inhabited by its own mind, or they've seen through it since. */
export function seesThrough(observer: ObjectRef, b: ObjectRef): boolean {
  const truth = mindOf(b);
  const believed = whoIs(observer, b);
  return truth !== undefined && believed?.id === truth.id;
}

/**
 * Who `observer` believes `body` is: whoever it belongs to, whichever mind
 * is in it, or whoever it's disguised as, unless they've seen through it.
 * `undefined` means a stranger: a body disguised as one, or one that
 * belongs to no mind.
 */
export function whoIs(observer: ObjectRef, b: ObjectRef): Mind | undefined {
  checkBody("whoIs", b);
  const o = mindFor(observer, "whoIs");
  const seen = state.seen[o.id]?.[b.id];
  const inside = mindOf(b);
  if (seen && inside?.id === seen.mind && seen.disguise === disguiseKey(b)) return inside;
  const d = disguiseOf(b.id);
  if (d?.mind !== undefined) return mindFor({ id: d.mind }, "whoIs");
  if (d?.stranger !== undefined) return undefined;
  return ownerOf(b);
}

/** How `observer` feels about `toward`, a mind or an actor: 0 unless set. */
export function attitude(observer: ObjectRef, toward: ObjectRef): number {
  const o = mindFor(observer, "attitude");
  const t = mindFor(toward, "attitude");
  return state.attitudes[o.id]?.[t.id] ?? starting.attitudes.get(o.id)?.get(t.id) ?? 0;
}

/**
 * Sets how `observer` feels about `toward`. In `story.ts`, while the game
 * loads, it sets how they feel to begin with; during play, it changes it.
 */
export function setAttitude(observer: ObjectRef, toward: ObjectRef, value: number): void {
  if (!Number.isFinite(value)) {
    throw new StateError(`setAttitude: ${String(value)} isn't a number.`);
  }
  const o = mindFor(observer, "setAttitude");
  const t = mindFor(toward, "setAttitude");
  if (!_storyRunning()) {
    const theirs = starting.attitudes.get(o.id) ?? new Map<string, number>();
    theirs.set(t.id, value);
    starting.attitudes.set(o.id, theirs);
    return;
  }
  state.attitudes = { ...state.attitudes, [o.id]: { ...state.attitudes[o.id], [t.id]: value } };
}

/** Changes how `observer` feels about `toward` by `by`, and returns the new attitude. */
export function changeAttitude(observer: ObjectRef, toward: ObjectRef, by: number): number {
  const value = attitude(observer, toward) + by;
  setAttitude(observer, toward, value);
  return value;
}

/**
 * How `observer` feels about whoever they believe `body` is: what an NPC
 * acts on. 0 for a stranger.
 */
export function attitudeTo(observer: ObjectRef, b: ObjectRef): number {
  const who = whoIs(observer, b);
  return who ? attitude(observer, who) : 0;
}
