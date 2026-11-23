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
  emit,
  hook,
  message,
  messages,
  NameTaken,
  object,
  StateError,
  t,
  type ObjectRef,
} from "@loominate-if/core";
import { allBodies, bodyOf, isBody, isMind, mindFor, mindOf, ownerOf } from "./actors.js";
import { clock } from "./clock.js";
import type { Delay } from "./schedule.js";

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

/** A modifier as kept: how much it adds or multiplies, and until when, if it wears off. */
type Mod = {
  readonly by?: number;
  readonly times?: number;
  /** The clock's minutes when it wears off. */
  readonly until?: number;
  /** The move count when it wears off. */
  readonly untilMove?: number;
  readonly wearsOff?: string;
};
type Mods = Record<string, Record<string, Record<string, Mod>>>;

const state = object("world:stats", {
  /** Values changed in play, by the body or mind they're kept on, then stat. */
  values: {} as Record<string, Record<string, number>>,
  /** Modifiers changed in play, by holder, then stat, then source. */
  mods: {} as Mods,
});
/** Values set as the game loads, by holder, then stat: how things start. */
const starting = new Map<string, Map<string, number>>();
/** Modifiers set as the game loads: how things start. */
const startingMods: Mods = {};

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

/** A kept stat's value for `who` before modifiers, clamped, and what it's kept on. */
function base(who: ObjectRef, name: string, spec: KeptStat): { value: number; holder?: string } {
  const holder = holderOf("stat", who, spec.on);
  const start = spec.start ?? 0;
  if (holder === undefined) return { value: start };
  const kept =
    (_storyRunning() ? state.values[holder]?.[name] : undefined) ??
    starting.get(holder)?.get(name) ??
    start;
  return { value: clamp(spec, who, kept), holder };
}

/** The modifiers on a holder's stat now, by source: as changed in play, or as they started; worn-off ones left out. */
function modsOn(holder: string, name: string): Record<string, Mod> {
  const all = _storyRunning()
    ? (state.mods[holder]?.[name] ?? startingMods[holder]?.[name])
    : startingMods[holder]?.[name];
  const out: Record<string, Mod> = {};
  for (const [from, m] of Object.entries(all ?? {})) if (!wornOff(m)) out[from] = m;
  return out;
}

/** Whether a modifier has worn off, by the clock or the move count. */
const wornOff = (m: Mod): boolean =>
  _storyRunning() &&
  ((m.until !== undefined && clock.minutes >= m.until) ||
    (m.untilMove !== undefined && clock.moves >= m.untilMove));

/**
 * A stat's value for `who`, an actor, a body, or a mind: a physical stat
 * from the body, a mental one from the mind in it now, or a derived one
 * worked out. Modifiers apply, additions then multiplications, and the
 * result stays within the stat's limits. A body with no mind has its
 * mental stats at their start.
 */
export function stat(who: ObjectRef, name: StatName): number {
  const spec = specOf("stat", name);
  if ("derived" in spec) return spec.derived(who);
  const { value, holder } = base(who, name, spec);
  if (holder === undefined) return value;
  const mods = Object.values(modsOn(holder, name));
  const added = mods.reduce((n, m) => n + (m.by ?? 0), value);
  return clamp(
    spec,
    who,
    mods.reduce((n, m) => n * (m.times ?? 1), added),
  );
}

/** A stat's value for `who` without its modifiers. A derived stat is worked out from others' modified values. */
export function baseStat(who: ObjectRef, name: StatName): number {
  const spec = specOf("baseStat", name);
  return "derived" in spec ? spec.derived(who) : base(who, name, spec).value;
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
  return setStat(who, name, baseStat(who, name) + by);
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
  return setStat(who, name, baseStat(who, name) - amount);
}

/** Gives back `amount` of a resource to `who`, up to its max, and returns what they have. */
export function restore(who: ObjectRef, name: StatName, amount: number): number {
  resource("restore", name);
  return setStat(who, name, baseStat(who, name) + amount);
}

/** A modifier, for {@link modify}: it adds `by`, or multiplies by `times`. */
export type Modifier = (
  { readonly by: number; readonly times?: never } | { readonly times: number; readonly by?: never }
) & {
  /** Where it comes from, as `"potion"`: a new one from the same source replaces it. */
  readonly from: string;
  /** How long it lasts, as `minutes(30)` or `moves(3)`. Until it's removed, if it doesn't say. */
  readonly lasts?: Delay;
  /** What the player is told when it wears off: "The potion's warmth fades." */
  readonly wearsOff?: string;
};

/**
 * Modifies a stat for `who`: adds to it, or multiplies it, from a source,
 * for a while or until removed. A new modifier from the same source
 * replaces the last; different sources stack, additions first. It's kept
 * with the stat, on the body or the mind. In `story.ts`, as the game
 * loads, it's how things start.
 *
 * @example
 * ```ts
 * modify(you, "strength", { by: 2, from: "potion", lasts: minutes(30), wearsOff: "The potion's warmth fades." });
 * ```
 *
 * @throws StateError if the stat is derived, or the modifier isn't a number.
 */
export function modify(who: ObjectRef, name: StatName, modifier: Modifier): void {
  const where = `modify "${name}"`;
  const spec = keptSpec(where, name);
  const amount = modifier.by ?? modifier.times;
  if (amount === undefined || !Number.isFinite(amount)) {
    throw new StateError(
      `${where}: give it by, an amount to add, or times, an amount to multiply by.`,
    );
  }
  if (modifier.from.trim() === "")
    throw new StateError(`${where}: say where it's from, as from: "potion".`);
  const holder = holderOf(where, who, spec.on);
  if (holder === undefined)
    throw new StateError(`${where}: ${JSON.stringify(who.id)} has no ${spec.on} to keep it on.`);
  const lasts = modifier.lasts;
  const now = _storyRunning()
    ? { minutes: clock.minutes, moves: clock.moves }
    : { minutes: 0, moves: 0 };
  const m: Mod = {
    ...(modifier.by !== undefined && { by: modifier.by }),
    ...(modifier.times !== undefined && { times: modifier.times }),
    ...(lasts !== undefined &&
      ("minutes" in lasts
        ? { until: now.minutes + lasts.minutes }
        : { untilMove: now.moves + lasts.moves })),
    ...(modifier.wearsOff !== undefined && { wearsOff: modifier.wearsOff }),
  };
  if (!_storyRunning()) {
    startingMods[holder] = {
      ...startingMods[holder],
      [name]: { ...startingMods[holder]?.[name], [modifier.from]: m },
    };
    return;
  }
  setMods(holder, name, { ...currentMods(holder, name), [modifier.from]: m });
}

/** A holder's modifiers on a stat, as kept now, worn-off ones included. */
const currentMods = (holder: string, name: string): Record<string, Mod> =>
  state.mods[holder]?.[name] ?? startingMods[holder]?.[name] ?? {};

const setMods = (holder: string, name: string, mods: Record<string, Mod>): void => {
  state.mods = {
    ...state.mods,
    [holder]: { ...(state.mods[holder] ?? startingMods[holder]), [name]: mods },
  };
};

/** Removes the modifier from `from` on a stat for `who`, if there is one. */
export function unmodify(who: ObjectRef, name: StatName, from: string): void {
  const spec = keptSpec(`unmodify "${name}"`, name);
  const holder = holderOf("unmodify", who, spec.on);
  if (holder === undefined) return;
  const { [from]: _gone, ...rest } = currentMods(holder, name);
  void _gone;
  setMods(holder, name, rest);
}

/** A modifier on a stat now, as {@link modifiersOf} lists it. */
export type ActiveModifier = {
  readonly from: string;
  readonly by?: number;
  readonly times?: number;
  /** The clock's minutes, or the move count, when it wears off, if it does. */
  readonly until?: number;
  readonly untilMove?: number;
};

/** The modifiers on a stat for `who` now, by source. */
export function modifiersOf(who: ObjectRef, name: StatName): readonly ActiveModifier[] {
  const spec = keptSpec("modifiersOf", name);
  const holder = holderOf("modifiersOf", who, spec.on);
  if (holder === undefined) return [];
  return Object.entries(modsOn(holder, name)).map(([from, m]) => ({
    from,
    ...(m.by !== undefined && { by: m.by }),
    ...(m.times !== undefined && { times: m.times }),
    ...(m.until !== undefined && { until: m.until }),
    ...(m.untilMove !== undefined && { untilMove: m.untilMove }),
  }));
}

/** Takes away the modifiers that have worn off, and tells the player what each says as it does. */
function wearOff(): void {
  const all = { ...startingMods, ...state.mods };
  for (const [holder, byStat] of Object.entries(all)) {
    for (const [name, mods] of Object.entries(byStat)) {
      // Read what's needed first: a view of a modifier can't be used once it's been replaced.
      const entries = Object.entries(mods).map(([from, m]) => ({
        from,
        gone: wornOff(m),
        wearsOff: m.wearsOff,
        kept: { ...m },
      }));
      if (!entries.some((e) => e.gone)) continue;
      setMods(
        holder,
        name,
        Object.fromEntries(entries.filter((e) => !e.gone).map((e) => [e.from, e.kept])),
      );
      for (const e of entries) {
        if (e.gone && e.wearsOff !== undefined) {
          emit("scheduled", { text: e.wearsOff, source: `modifier:${e.from}`, standsOut: true });
        }
      }
    }
  }
}

hook("clockAdvance").rule("modifiers wear off", wearOff, { source: "@loominate-if/world" });
hook("turnEnd").rule("modifiers wear off", wearOff, {
  source: "@loominate-if/world",
  after: "move counter",
});

/** One row of the inspector's Stats tab. @internal */
export type _StatRow = {
  readonly body: string;
  /** The mind a mental stat comes from, the one in the body now. */
  readonly mind?: string;
  readonly stat: string;
  readonly base: number;
  readonly now: number;
  readonly modifiers: readonly ActiveModifier[];
};

/** Every body's stats, base and modified, with their modifiers, for the inspector. @internal */
export function _statsTable(): readonly _StatRow[] {
  const rows: _StatRow[] = [];
  for (const b of allBodies()) {
    const inside = mindOf(b);
    for (const [name, spec] of specs) {
      const mental = !("derived" in spec) && spec.on === "mind";
      if (mental && !inside) continue;
      rows.push({
        body: b.id,
        ...(mental && inside && { mind: inside.id }),
        stat: name,
        base: baseStat(b, name as StatName),
        now: stat(b, name as StatName),
        modifiers: "derived" in spec ? [] : modifiersOf(b, name as StatName),
      });
    }
  }
  return rows;
}
