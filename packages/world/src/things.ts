/**
 * Things, places, and the containment tree (#62, ADR 0031).
 *
 * Each thing stores one `location`: the thing or place it's in or on. Contents
 * are computed from those, so a thing is never in two places, and a move is
 * one change for undo. What a thing can hold, and whether it opens, locks,
 * lets light through, or gives light, comes from mixins spread into its
 * definition, not from a class hierarchy.
 */
import {
  mixin,
  object,
  StateError,
  type Handle,
  type ObjectDefinition,
  type ObjectRef,
  type StateId,
} from "@loominate-if/core";
import { checkRegions, roomDefaultsFor } from "./regions.js";

/** How a thing holds what's in it: `in` for containers and places, `on` for surfaces. */
export type Holding = "in" | "on";

/** What every thing has: a name, and where it is. */
export type ThingFields = {
  /** What the thing is called, such as "brass lantern". */
  name: string;
  /** The thing or place it's in or on, or `null` when it's nowhere. Change it with {@link move}. */
  location: ObjectRef | null;
};

/** What every place has, beyond a thing's fields. */
export type PlaceFields = ThingFields & {
  /** Places hold things in them. */
  holds: "in";
  /** Whether the place is dark, so nothing in it can be seen without light. */
  isDark: boolean;
  /** The regions it's in. */
  regions: ObjectRef[];
};

/** A thing: an object of the world model with a name and a location. */
export type Thing = Handle<ThingFields>;

/** A place, such as a room: the top of a containment tree. */
export type Place = Handle<PlaceFields>;

/** The state a thing's mixins may give it, read by containment and scope. */
type Features = {
  readonly holds?: Holding;
  readonly isOpen?: boolean;
  readonly isTransparent?: boolean;
  readonly isLit?: boolean;
  readonly isDark?: boolean;
};

/** Every thing and place defined with {@link thing} and {@link place}, by ID. */
const registry = new Map<StateId, Thing>();
/** The IDs of places, which bound sight, reach, and hearing. */
const places = new Set<StateId>();

/**
 * A container: things go in it. It's open unless it's also {@link openable},
 * and opaque unless it's also {@link transparent}.
 */
export const container = mixin({
  /** Things go in it. */
  holds: "in" as Holding,
});

/** A surface: things go on it, and stay in sight and in reach. */
export const surface = mixin({
  /** Things go on it. */
  holds: "on" as Holding,
});

/**
 * Something that opens and closes, such as a box or a door. Spread
 * {@link lockable} in too, and it won't open while it's locked.
 */
export const openable = mixin({
  /** Whether it's open. */
  isOpen: false,
  /** Opens it, unless it's locked. Returns whether it's open now. */
  open(): boolean {
    if ((this as Partial<Pick<LockableFields, "isLocked">>).isLocked === true) return false;
    this.isOpen = true;
    return true;
  },
  /** Closes it. */
  close(): void {
    this.isOpen = false;
  },
});

/** What {@link lockable} adds. */
type LockableFields = { isLocked: boolean };

/** Something that locks, such as a door or a chest. A locked {@link openable} won't open. */
export const lockable = mixin({
  /** Whether it's locked. */
  isLocked: true,
  /** Locks it. It must be closed, if it opens: returns whether it's locked now. */
  lock(): boolean {
    if ((this as Partial<Pick<Features, "isOpen">>).isOpen === true) return false;
    this.isLocked = true;
    return true;
  },
  /** Unlocks it. */
  unlock(): void {
    this.isLocked = false;
  },
});

/** Something that can be seen through even when closed, such as a glass case. */
export const transparent = mixin({
  /** Sight passes through it when it's closed. Reach doesn't. */
  isTransparent: true,
});

/** Something that gives light when lit, such as a lamp or a candle. */
export const lightSource = mixin({
  /** Whether it's giving light. */
  isLit: false,
  /** Lights it. */
  light(): void {
    this.isLit = true;
  },
  /** Puts it out. */
  extinguish(): void {
    this.isLit = false;
  },
});

/**
 * A thing as {@link thing} defines it from definition `D`: `D`, with a `name`,
 * and a `location` that holds any thing or place.
 */
export type ThingOf<D> = Omit<D, "location"> & {
  name: D extends { name: string } ? D["name"] : string;
  location: ObjectRef | null;
};

/**
 * Defines a thing: an object with a name and a location, built on core's `object()`.
 *
 * @remarks
 * Spread mixins in for what it can do: {@link container} or {@link surface}
 * to hold things, {@link openable}, {@link lockable}, {@link transparent}, and
 * {@link lightSource}. `location` defaults to `null`, nowhere.
 *
 * @example
 * ```ts
 * export const chest = thing("chest", {
 *   ...container,
 *   ...openable,
 *   ...lockable,
 *   name: "oak chest",
 *   location: cellar,
 * });
 * ```
 *
 * @throws StateError if the ID is taken or invalid, or a property isn't valid state.
 */
export function thing<Id extends StateId, D extends ObjectDefinition<D> & { name: string }>(
  id: Id,
  definition: D & { location?: ObjectRef | null } & ThisType<Handle<ThingOf<D>, Id>>,
): Handle<ThingOf<D>, Id> {
  const handle = object(id, withDefaults({ location: null }, definition) as ObjectDefinition<D>);
  registry.set(id, handle as unknown as Thing);
  return handle as unknown as Handle<ThingOf<D>, Id>;
}

/**
 * Defines a place, such as a room: it holds things in it, and bounds what
 * can be seen, reached, and heard. `isDark` defaults to `false`.
 *
 * @remarks
 * List the regions it's in as `regions`; it takes their `roomDefaults` for
 * whatever it doesn't set itself, the nearest region's first.
 *
 * @example
 * ```ts
 * export const cellar = place("cellar", { name: "the cellar", isDark: true });
 * ```
 *
 * @throws StateError if the ID is taken or invalid, or a property isn't valid state.
 */
export function place<Id extends StateId, D extends ObjectDefinition<D> & { name: string }>(
  id: Id,
  definition: D & { isDark?: boolean; regions?: readonly ObjectRef[] } & ThisType<
      Handle<ThingOf<D> & PlaceFields, Id>
    >,
): Handle<ThingOf<D> & PlaceFields, Id> {
  const where = `place ${JSON.stringify(id)}`;
  const regions = checkRegions(definition.regions ?? [], where);
  const defaults = withDefaults({ holds: "in", isDark: false }, roomDefaultsFor(regions));
  const handle = thing(
    id,
    withDefaults(defaults, withDefaults(definition, { regions })) as unknown as D,
  );
  places.add(id);
  return handle as unknown as Handle<ThingOf<D> & PlaceFields, Id>;
}

/**
 * `definition` with `defaults` for what it leaves out. It copies property
 * descriptors rather than spreading, which would read each getter once and
 * store its value. @internal
 */
export function withDefaults<D extends object>(defaults: object, definition: D): D {
  return Object.defineProperties(
    Object.defineProperties({}, Object.getOwnPropertyDescriptors(defaults)),
    Object.getOwnPropertyDescriptors(definition),
  ) as D;
}

/** The thing defined with `id`, for code that has only a reference. @internal */
export function thingFor(ref: ObjectRef): Thing | undefined {
  return registry.get(ref.id);
}

/** A thing's mixin state, for containment and scope. @internal */
export function features(t: ObjectRef): Features {
  return (registry.get(t.id) ?? {}) as Features;
}

/** Whether `t` is a place. */
export function isPlace(t: ObjectRef): boolean {
  return places.has(t.id);
}

/** How `t` holds things, `in` or `on`, or `undefined` if it can't hold them. */
export function holding(t: ObjectRef): Holding | undefined {
  return features(t).holds;
}

/** What `t` is in or on, or `undefined` when it's nowhere. */
export function parentOf(t: ObjectRef): Thing | undefined {
  const at = registry.get(t.id)?.location;
  return at ? registry.get(at.id) : undefined;
}

/**
 * What's directly in or on `parent`, sorted by ID so the order never depends
 * on when things were defined or moved.
 */
export function contents(parent: ObjectRef): Thing[] {
  const out: Thing[] = [];
  for (const t of registry.values()) if (t.location?.id === parent.id) out.push(t);
  return out.sort(byId);
}

/** Whether `t` is in or on `ancestor`, directly or inside something else that is. */
export function isWithin(t: ObjectRef, ancestor: ObjectRef): boolean {
  const seen = new Set<StateId>();
  for (let at = parentOf(t); at && !seen.has(at.id); at = parentOf(at)) {
    if (at.id === ancestor.id) return true;
    seen.add(at.id);
  }
  return false;
}

/** The place `t` is in, however deep, or `undefined` if it isn't in one. A place is its own. */
export function placeOf(t: ObjectRef): Place | undefined {
  const seen = new Set<StateId>();
  for (let at: Thing | undefined = registry.get(t.id); at && !seen.has(at.id); at = parentOf(at)) {
    if (places.has(at.id)) return at as Place;
    seen.add(at.id);
  }
  return undefined;
}

/**
 * Moves `t` into or onto `to`, or nowhere with `null`.
 *
 * @remarks
 * This checks only that the move makes sense: `to` holds things, and isn't
 * `t` or inside it. Whether the player may make it, such as into a closed or
 * locked box, is for actions to decide.
 *
 * @throws StateError if `t` or `to` isn't a thing defined with `thing()` or
 * `place()`, `to` can't hold things, `t` is a place, or the move would put `t` inside itself.
 */
export function move(t: ObjectRef, to: ObjectRef | null): void {
  const moving = registry.get(t.id);
  const from = moving ? placeOf(moving) : undefined;
  const where = `move ${JSON.stringify(t.id)}`;
  if (!moving) throw new StateError(`${where}: it isn't defined with thing() or place().`);
  if (places.has(t.id)) {
    throw new StateError(`${where}: it's a place, and places don't move.`);
  }
  if (to === null) {
    moving.location = null;
    moved(moving, from);
    return;
  }
  const into = registry.get(to.id);
  const target = `${where} to ${JSON.stringify(to.id)}`;
  if (!into) throw new StateError(`${target}: it isn't defined with thing() or place().`);
  if (holding(into) === undefined) {
    throw new StateError(
      `${target}: it can't hold things. Spread container or surface into its definition.`,
    );
  }
  if (into.id === t.id || isWithin(into, t)) {
    throw new StateError(`${target}: that would put it inside itself.`);
  }
  moving.location = into;
  moved(moving, from);
}

/** Called after each move, with the place the thing was in. */
type MoveListener = (moved: Thing, from: Place | undefined) => void;
const listeners: MoveListener[] = [];

/** Calls `listener` after every {@link move}. @internal */
export function onMove(listener: MoveListener): void {
  listeners.push(listener);
}

function moved(t: Thing, from: Place | undefined): void {
  for (const l of listeners) l(t, from);
}

/** Sorts things by ID. */
export const byId = (a: ObjectRef, b: ObjectRef): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Every thing and place, sorted by ID. @internal */
export function allThings(): Thing[] {
  return [...registry.values()].sort(byId);
}
