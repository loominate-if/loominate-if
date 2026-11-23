/**
 * Stats and resources (#94, ADR 0068): numbers a game declares, such as
 * strength, wits, and energy, each kept on the half of an actor it belongs
 * to. A physical stat stays with the body; a mental one travels with the
 * mind, so after a body swap a body has the wits of whoever is in it now.
 * A resource can be spent, up to a maximum that can be worked out from
 * other stats, and a derived stat is a formula over others.
 */
import {
  _storyRunning,
  message,
  messages,
  NameTaken,
  object,
  StateError,
  t,
  type ObjectRef,
} from "@loominate-if/core";
import { bodyOf, isBody, isMind, mindFor, mindOf, ownerOf } from "./actors.js";

/**
 * The stats a game has, by name, declared by declaration merging:
 *
 * @example
 * ```ts
 * declare module "@loominate-if/world" {
 *   interface Stats { strength: true; wits: true; energy: true }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- filled by declaration merging
export interface Stats {}

/** A stat's name. */
export type StatName = keyof Stats & string;

/** A stat kept on a body or a mind. */
export type KeptStat = {
  /** Where it's kept: `"body"`, physical, which stays with the body; or `"mind"`, mental, which travels with the mind. */
  readonly on: "body" | "mind";
  /** Where everyone starts. Defaults to 0. */
  readonly start?: number;
  /** The least it can be. */
  readonly min?: number;
  /** The most it can be: a number, or worked out from other stats, as `(who) => 5 + stat(who, "strength")`. */
  readonly max?: number | ((who: ObjectRef) => number);
  /** Whether it's spent and restored, as energy or money, with {@link spend} and {@link restore}. */
  readonly resource?: boolean;
};

/** A stat worked out from others, which can't be set. */
export type DerivedStat = {
  /** The formula, as `(who) => stat(who, "strength") * 5`. */
  readonly derived: (who: ObjectRef) => number;
};

/** How a stat is declared. */
export type StatSpec = KeptStat | DerivedStat;

declare module "@loominate-if/core" {
  interface Messages {
    /** Why a resource can't be spent: "You don't have enough energy." */
    "stat.notEnough": {
      readonly who: ObjectRef;
      readonly stat: string;
      readonly need: number;
      readonly have: number;
    };
  }
}
messages.register(
  "stat.notEnough",
  ({ who, stat }) => t`{The subj who} {does}n't have enough ${stat}.`({ who }),
  {
    source: "@loominate-if/world",
  },
);

const specs = new Map<string, StatSpec>();

/**
 * Declares stats, in `story.ts`. A game and its packages can each declare
 * their own; a stat `Stats` names but nothing declares is an error when
 * it's used.
 *
 * @example
 * ```ts
 * stats({
 *   strength: { on: "body", start: 2, min: 0, max: 10 },
 *   wits: { on: "mind", start: 3 },
 *   energy: { on: "body", resource: true, max: (who) => 5 + stat(who, "strength") },
 *   carry: { derived: (who) => stat(who, "strength") * 5 },
 * });
 * ```
 *
 * @throws StateError if a stat is declared twice, or its limits don't make sense.
 */
export function stats(declared: { readonly [S in StatName]?: StatSpec }): void {
  for (const [name, spec] of Object.entries(declared) as [string, StatSpec | undefined][]) {
    if (spec === undefined) continue;
    const where = `stats ${JSON.stringify(name)}`;
    if (specs.has(name)) throw new NameTaken(`${where}: this stat is already declared.`);
    if (!("derived" in spec)) {
      if (spec.on !== "body" && spec.on !== "mind") {
        throw new StateError(`${where}: say where it's kept, with on: "body" or on: "mind".`);
      }
      const { min, start = 0 } = spec;
      const max = typeof spec.max === "number" ? spec.max : undefined;
      if (min !== undefined && max !== undefined && min > max) {
        throw new StateError(`${where}: min ${String(min)} is more than max ${String(max)}.`);
      }
      if ((min !== undefined && start < min) || (max !== undefined && start > max)) {
        throw new StateError(`${where}: it starts at ${String(start)}, outside its limits.`);
      }
    }
    specs.set(name, spec);
  }
}

const state = object("world:stats", {
  /** Values changed in play, by the body or mind they're kept on, then stat. */
  values: {} as Record<string, Record<string, number>>,
});
/** Values set as the game loads, by holder, then stat: how things start. */
const starting = new Map<string, Map<string, number>>();

const specOf = (where: string, name: string): StatSpec => {
  const spec = specs.get(name);
  if (!spec) {
    throw new StateError(
      `${where}: there's no stat ${JSON.stringify(name)}. Declare it with stats({ ${name}: { on: "body" } }) in story.ts, and in the Stats interface.`,
    );
  }
  return spec;
};

/**
 * What a kept stat is kept on, for `who`: a body's stat on the body (a
 * mind's body, asked of a mind), a mind's stat on the mind (the mind in a
 * body, asked of a body). While the game loads, a body's mind is whoever
 * it belongs to, since nothing is in any body yet.
 */
function holderOf(where: string, who: ObjectRef, on: "body" | "mind"): string | undefined {
  const loading = !_storyRunning();
  // An actor is its body, so a body comes first: its mental stats are whoever's in it.
  if (isBody(who)) {
    if (on === "body") return who.id;
    return (loading ? ownerOf(who) : mindOf(who))?.id;
  }
  if (isMind(who)) {
    if (on === "mind") return mindFor(who, where).id;
    return loading ? undefined : bodyOf(mindFor(who, where))?.id;
  }
  throw new StateError(`${where}: ${JSON.stringify(who.id)} isn't an actor, a body, or a mind.`);
}

/** The most a kept stat can be, for `who`. */
const maxOf = (spec: KeptStat, who: ObjectRef): number =>
  spec.max === undefined ? Infinity : typeof spec.max === "number" ? spec.max : spec.max(who);

const clamp = (spec: KeptStat, who: ObjectRef, value: number): number =>
  Math.min(maxOf(spec, who), Math.max(spec.min ?? -Infinity, value));

/**
 * A stat's value for `who`, an actor, a body, or a mind: a physical stat
 * from the body, a mental one from the mind in it now, or a derived one
 * worked out. A body with no mind has its mental stats at their start.
 */
export function stat(who: ObjectRef, name: StatName): number {
  const spec = specOf("stat", name);
  if ("derived" in spec) return spec.derived(who);
  const holder = holderOf("stat", who, spec.on);
  const start = spec.start ?? 0;
  if (holder === undefined) return start;
  const kept =
    (_storyRunning() ? state.values[holder]?.[name] : undefined) ??
    starting.get(holder)?.get(name) ??
    start;
  return clamp(spec, who, kept);
}

/** A kept stat's spec, refusing a derived one. */
const keptSpec = (where: string, name: string): KeptStat => {
  const spec = specOf(where, name);
  if ("derived" in spec) {
    throw new StateError(`${where}: "${name}" is worked out from other stats, so it can't be set.`);
  }
  return spec;
};

/**
 * Sets a stat for `who`, clamped to its limits. In `story.ts`, as the game
 * loads, it sets how they start; during play, it changes it.
 *
 * @throws StateError if the stat is derived, or `who` has no body or mind to keep it on.
 */
export function setStat(who: ObjectRef, name: StatName, value: number): number {
  const where = "setStat";
  if (!Number.isFinite(value)) throw new StateError(`${where}: ${String(value)} isn't a number.`);
  const spec = keptSpec(where, name);
  const holder = holderOf(where, who, spec.on);
  if (holder === undefined) {
    throw new StateError(
      `${where}: ${JSON.stringify(who.id)} has no ${spec.on} to keep "${name}" on${_storyRunning() ? "" : " as the game begins; set it on the actor or body instead"}.`,
    );
  }
  const v = clamp(spec, who, value);
  if (!_storyRunning()) {
    const theirs = starting.get(holder) ?? new Map<string, number>();
    theirs.set(name, v);
    starting.set(holder, theirs);
  } else {
    state.values = { ...state.values, [holder]: { ...state.values[holder], [name]: v } };
  }
  return v;
}

/** Changes a stat for `who` by `by`, clamped, and returns the new value. */
export function changeStat(who: ObjectRef, name: StatName, by: number): number {
  return setStat(who, name, stat(who, name) + by);
}

const resource = (where: string, name: string): KeptStat => {
  const spec = keptSpec(where, name);
  if (spec.resource !== true) {
    throw new StateError(
      `${where}: "${name}" isn't a resource. Declare it with resource: true to spend it.`,
    );
  }
  return spec;
};

/**
 * Why `who` can't spend `amount` of a resource, or `undefined` if they can:
 * for an action's `check`, as `check: ({ body }) => canSpend(body, "energy", 3)`.
 */
export function canSpend(who: ObjectRef, name: StatName, amount: number): string | undefined {
  resource("canSpend", name);
  const have = stat(who, name);
  return have >= amount
    ? undefined
    : message("stat.notEnough", { who, stat: name, need: amount, have });
}

/**
 * Spends `amount` of a resource for `who`, and returns what's left.
 *
 * @throws StateError with why, if they haven't enough; check with {@link canSpend} first.
 */
export function spend(who: ObjectRef, name: StatName, amount: number): number {
  const why = canSpend(who, name, amount);
  if (why !== undefined) throw new StateError(`spend "${name}": ${why}`);
  return setStat(who, name, stat(who, name) - amount);
}

/** Gives back `amount` of a resource to `who`, up to its max, and returns what they have. */
export function restore(who: ObjectRef, name: StatName, amount: number): number {
  resource("restore", name);
  return setStat(who, name, stat(who, name) + amount);
}
