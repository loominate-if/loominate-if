/**
 * Relationships (#96, ADR 0067): how each mind feels about each other mind,
 * a directed pair, in the dimensions a game declares, such as affection,
 * trust, and rivalry. Thresholds fire when a pair's value crosses them,
 * once until it goes back. What an NPC does reads their relationship
 * toward whoever they *believe* is in front of them (#66), so a disguise
 * changes their response, never how they feel about the real person.
 */
import {
  _storyRunning,
  emit,
  NameTaken,
  object,
  StateError,
  type ObjectRef,
  type Text,
} from "@loominate-if/core";
import { mindFor } from "./actors.js";
import { whoIs } from "./identity.js";

/**
 * The dimensions a game's relationships have, by name, declared by
 * declaration merging:
 *
 * @example
 * ```ts
 * declare module "@loominate-if/world" {
 *   interface Dimensions { affection: true; trust: true }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- filled by declaration merging
export interface Dimensions {}

/** A relationship dimension's name. */
export type Dimension = keyof Dimensions & string;

/** How a dimension starts, and the limits a change is clamped to. */
export type DimensionSpec = {
  /** Where every pair starts. Defaults to 0. */
  readonly start?: number;
  /** The least it can be. */
  readonly min?: number;
  /** The most it can be. */
  readonly max?: number;
};

/** A pair's values, by dimension. */
export type Relationship = { readonly [D in Dimension]: number };

const specs = new Map<string, Required<Pick<DimensionSpec, "start">> & DimensionSpec>();

/**
 * Declares relationship dimensions, each with where pairs start and its
 * limits, in `story.ts`. A game and its packages can each declare their
 * own; a dimension `Dimensions` names but nothing declares is an error
 * when it's used.
 *
 * @example
 * ```ts
 * relationships({ affection: { min: -10, max: 10 }, trust: { start: 2 } });
 * ```
 *
 * @throws StateError if a dimension is declared twice, or its limits don't make sense.
 */
export function relationships(dimensions: { readonly [D in Dimension]?: DimensionSpec }): void {
  for (const [name, spec] of Object.entries(dimensions) as [string, DimensionSpec | undefined][]) {
    if (spec === undefined) continue;
    const where = `relationships ${JSON.stringify(name)}`;
    if (specs.has(name)) throw new NameTaken(`${where}: this dimension is already declared.`);
    const start = spec.start ?? 0;
    for (const [k, v] of Object.entries(spec)) {
      if (!Number.isFinite(v)) throw new StateError(`${where}: ${k} ${String(v)} isn't a number.`);
    }
    if (spec.min !== undefined && spec.max !== undefined && spec.min > spec.max) {
      throw new StateError(
        `${where}: min ${String(spec.min)} is more than max ${String(spec.max)}.`,
      );
    }
    if (
      (spec.min !== undefined && start < spec.min) ||
      (spec.max !== undefined && start > spec.max)
    ) {
      throw new StateError(`${where}: it starts at ${String(start)}, outside its limits.`);
    }
    specs.set(name, { ...spec, start });
  }
}

const state = object("world:relationships", {
  /** Values changed in play, by pair (`observer>toward`), then dimension. */
  values: {} as Record<string, Record<string, number>>,
  /** Which pairs each threshold has fired for and not been re-armed, by threshold. */
  fired: {} as Record<string, readonly string[]>,
});

/** Values set as the game loads, by pair, then dimension: how things start. */
const starting = new Map<string, Map<string, number>>();

const pairKey = (o: string, t: string): string => `${o}>${t}`;

const dimension = (where: string, name: string) => {
  const spec = specs.get(name);
  if (!spec) {
    throw new StateError(
      `${where}: there's no relationship dimension ${JSON.stringify(name)}. Declare it with relationships({ ${name}: {} }) in story.ts, and in the Dimensions interface.`,
    );
  }
  return spec;
};

const clamp = (name: string, value: number): number => {
  const spec = dimension("relationship", name);
  return Math.min(spec.max ?? Infinity, Math.max(spec.min ?? -Infinity, value));
};

/** One dimension's value for a pair: changed in play, set as the game loaded, or where it starts. */
const valueOf = (key: string, name: string): number =>
  // While the game loads there's no state yet, only how things start.
  (_storyRunning() ? state.values[key]?.[name] : undefined) ??
  starting.get(key)?.get(name) ??
  dimension("relationship", name).start;

/** How `observer` feels about `toward`, a mind or an actor, in every dimension. */
export function relationship(observer: ObjectRef, toward: ObjectRef): Relationship {
  const key = pairKey(mindFor(observer, "relationship").id, mindFor(toward, "relationship").id);
  return Object.freeze(
    Object.fromEntries([...specs.keys()].map((name) => [name, valueOf(key, name)])),
  ) as Relationship;
}

/**
 * How `observer` feels about whoever they believe `body` is (#66): what an
 * NPC acts on. For a stranger, every dimension is where it starts.
 */
export function relationshipTo(observer: ObjectRef, body: ObjectRef): Relationship {
  const who = whoIs(observer, body);
  if (who) return relationship(observer, who);
  return Object.freeze(
    Object.fromEntries([...specs].map(([name, spec]) => [name, spec.start])),
  ) as Relationship;
}

/**
 * Sets how `observer` feels about `toward`, in the dimensions given,
 * clamped to their limits. In `story.ts`, as the game loads, it sets how
 * they start; during play, it changes them, and thresholds they cross fire.
 */
export function setRelationship(
  observer: ObjectRef,
  toward: ObjectRef,
  values: { readonly [D in Dimension]?: number },
): Relationship {
  const o = mindFor(observer, "setRelationship");
  const t = mindFor(toward, "setRelationship");
  const key = pairKey(o.id, t.id);
  for (const [name, v] of Object.entries(values) as [string, number][]) {
    if (!Number.isFinite(v)) {
      throw new StateError(`setRelationship ${JSON.stringify(name)}: ${String(v)} isn't a number.`);
    }
    const value = clamp(name, v);
    if (!_storyRunning()) {
      const pair = starting.get(key) ?? new Map<string, number>();
      pair.set(name, value);
      starting.set(key, pair);
      continue;
    }
    const before = valueOf(key, name);
    state.values = { ...state.values, [key]: { ...state.values[key], [name]: value } };
    crossed(o, t, name, before, value);
  }
  return relationship(o, t);
}

/** Changes how `observer` feels about `toward` by the amounts given, clamped, and returns the new values. */
export function changeRelationship(
  observer: ObjectRef,
  toward: ObjectRef,
  by: { readonly [D in Dimension]?: number },
): Relationship {
  const now = relationship(observer, toward);
  const values: Record<string, number> = {};
  for (const [name, d] of Object.entries(by) as [string, number][]) {
    dimension("changeRelationship", name);
    values[name] = ((now as Record<string, number | undefined>)[name] ?? 0) + d;
  }
  return setRelationship(observer, toward, values);
}

/** What a threshold's `fire` is told. */
export type Crossing = {
  /** The mind whose feelings changed. */
  readonly observer: ObjectRef;
  /** The mind they feel about. */
  readonly toward: ObjectRef;
  /** The dimension. */
  readonly dimension: Dimension;
  /** Its value before, and after. */
  readonly from: number;
  readonly to: number;
};

/** When a threshold fires: as a dimension reaches a value from below, or falls to one from above. */
export type ThresholdSpec = { readonly dimension: Dimension } & (
  | { readonly reaches: number; readonly falls?: never }
  | { readonly falls: number; readonly reaches?: never }
);

type Threshold = {
  readonly id: string;
  readonly spec: ThresholdSpec;
  readonly fire: (crossing: Crossing) => string | Text | undefined;
};
const thresholds: Threshold[] = [];

/**
 * Defines a threshold: `fire` runs when a pair's dimension crosses it, in
 * the move that changes it, and what it returns stands out. It fires once
 * for each pair, until the value goes back past it, which re-arms it.
 * Define it in `story.ts`.
 *
 * @example
 * ```ts
 * threshold("smitten", { dimension: "affection", reaches: 8 }, ({ observer }) =>
 *   observer.id === "mira:mind" ? "Mira can't stop smiling at you." : undefined,
 * );
 * ```
 *
 * @throws StateError if another threshold has the ID, or the dimension isn't declared.
 */
export function threshold(
  id: string,
  spec: ThresholdSpec,
  fire: (crossing: Crossing) => string | Text | undefined,
): void {
  if (thresholds.some((t) => t.id === id)) {
    throw new NameTaken(
      `threshold ${JSON.stringify(id)}: another threshold has this ID. Give each its own.`,
    );
  }
  thresholds.push({ id, spec, fire });
}

/** Fires the thresholds a change crosses, and re-arms those it goes back past. */
function crossed(
  observer: ObjectRef,
  toward: ObjectRef,
  name: string,
  from: number,
  to: number,
): void {
  if (from === to) return;
  const pair = pairKey(observer.id, toward.id);
  for (const t of thresholds) {
    if (t.spec.dimension !== name) continue;
    dimension(`threshold ${JSON.stringify(t.id)}`, name);
    const done = state.fired[t.id] ?? [];
    const rising = t.spec.reaches !== undefined;
    const at = rising ? (t.spec.reaches as number) : (t.spec.falls as number);
    const past = rising ? to >= at : to <= at;
    const wasPast = rising ? from >= at : from <= at;
    if (!past) {
      // Gone back: it can fire again next time.
      if (done.includes(pair))
        state.fired = { ...state.fired, [t.id]: done.filter((p) => p !== pair) };
      continue;
    }
    if (wasPast || done.includes(pair)) continue;
    state.fired = { ...state.fired, [t.id]: [...done, pair] };
    const said = t.fire({ observer, toward, dimension: name as Dimension, from, to });
    const text = typeof said === "function" ? said() : said;
    if (text !== undefined && text !== "") {
      emit("scheduled", { text, source: `threshold:${t.id}`, standsOut: true });
    }
  }
}
