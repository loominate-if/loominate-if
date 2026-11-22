/**
 * Regions: groups of rooms with shared defaults and enter and leave hooks
 * (#63, ADR 0033). A region may be in other regions, so they nest.
 *
 * This module knows nothing of things or places, so `place()` can read a
 * region's room defaults without an import cycle.
 */
import {
  object,
  StateError,
  type Handle,
  type ObjectDefinition,
  type ObjectRef,
  type StateId,
} from "@loominate-if/core";

/** What every region has. */
export type RegionFields = {
  /** What the region is called, such as "the manor". */
  name: string;
  /** The regions it's in, so regions nest. */
  regions: ObjectRef[];
};

/** A region: a group of rooms, and of other regions. */
export type Region = Handle<RegionFields>;

/** What a region may do when the player enters or leaves it. */
export type RegionHooks = {
  /** Runs when the player moves into the region, from a place outside it. */
  onEnter?(room: ObjectRef): void;
  /** Runs when the player moves out of the region, to a place outside it. */
  onLeave?(room: ObjectRef): void;
};

/** What a definition passed to {@link region} may include beyond its own properties. */
export type RegionOptions = {
  /** The regions it's in. */
  regions?: readonly ObjectRef[];
  /**
   * Defaults for its rooms, such as `{ isDark: true }`: a room in the region
   * takes each one it doesn't set itself. Getters stay getters, with `this`
   * the room, so a default can follow state: `get isDark() { return power.isOut; }`.
   */
  roomDefaults?: object;
};

/** A region as {@link region} defines it from definition `D`. */
export type RegionOf<D> = Omit<D, "roomDefaults" | "regions"> & RegionFields;

const regions = new Map<StateId, Region & RegionHooks>();
/** Each region's room defaults, kept out of state: they're copied into rooms' definitions. */
const roomDefaults = new Map<StateId, object>();
/** Each region's parents as defined, for reading before any story runs. */
const definedParents = new Map<StateId, readonly StateId[]>();

/**
 * Defines a region: a group of rooms with shared defaults and hooks.
 *
 * @remarks
 * Rooms join a region by listing it in their own `regions`, and so does a
 * region inside another. `roomDefaults` gives member rooms defaults for what
 * they don't set themselves, and `onEnter` and `onLeave` run when the player
 * moves in or out.
 *
 * @example
 * ```ts
 * export const manor = region("manor", {
 *   name: "manor",
 *   roomDefaults: { isDark: true },
 *   onEnter() {
 *     emit("narrative", { text: "The door booms shut behind you." });
 *   },
 * });
 * export const hall = place("hall", { name: "hall", regions: [manor] });
 * ```
 *
 * @throws StateError if the ID is taken or invalid, a property isn't valid
 * state, or one of `regions` isn't a region.
 */
export function region<Id extends StateId, D extends ObjectDefinition<D> & { name: string }>(
  id: Id,
  definition: D & RegionOptions & RegionHooks & ThisType<Handle<RegionOf<D>, Id>>,
): Handle<RegionOf<D>, Id> {
  const where = `region ${JSON.stringify(id)}`;
  const { roomDefaults: defaults, ...own } = Object.getOwnPropertyDescriptors(definition);
  const parents = checkRegions(definition.regions ?? [], where);
  const handle = object(
    id,
    Object.defineProperties({ regions: parents }, own) as unknown as ObjectDefinition<D>,
  );
  regions.set(id, handle as unknown as Region & RegionHooks);
  definedParents.set(
    id,
    parents.map((p) => p.id),
  );
  if (defaults?.value !== undefined) roomDefaults.set(id, defaults.value as object);
  return handle as unknown as Handle<RegionOf<D>, Id>;
}

/** Checks that each of `list` is a region. @internal */
export function checkRegions(list: readonly ObjectRef[], where: string): ObjectRef[] {
  for (const r of list) {
    if (!regions.has(r.id)) {
      throw new StateError(
        `${where}: ${JSON.stringify(r.id)} isn't a region. Define it with region().`,
      );
    }
  }
  return [...list];
}

/** Whether `ref` is a region. */
export function isRegion(ref: ObjectRef): boolean {
  return regions.has(ref.id);
}

/** The region defined with `id`. @internal */
export function regionFor(ref: ObjectRef): (Region & RegionHooks) | undefined {
  return regions.get(ref.id);
}

/**
 * `list` and every region they're in, nearest first: each listed region in
 * order, then the regions those are in. Each appears once. @internal
 */
export function nearestRegions(list: readonly ObjectRef[]): (Region & RegionHooks)[] {
  const out: (Region & RegionHooks)[] = [];
  const seen = new Set<StateId>();
  const queue = [...list];
  for (let next = queue.shift(); next; next = queue.shift()) {
    const r = regions.get(next.id);
    if (!r || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
    queue.push(...r.regions);
  }
  return out;
}

/**
 * The room defaults from `list` and the regions they're in, as one
 * definition: a nearer region's default wins. Read only while rooms are
 * defined, before any story runs, from each region's definition. @internal
 */
export function roomDefaultsFor(list: readonly ObjectRef[]): object {
  const merged = {};
  // Farthest first, so nearer regions' defaults replace theirs.
  for (const r of nearestRegionsFromDefinitions(list).reverse()) {
    const d = roomDefaults.get(r);
    if (d) Object.defineProperties(merged, Object.getOwnPropertyDescriptors(d));
  }
  return merged;
}

/** Like {@link nearestRegions}, from definitions, since no story runs while rooms are defined. */
function nearestRegionsFromDefinitions(list: readonly ObjectRef[]): StateId[] {
  const out: StateId[] = [];
  const queue = list.map((r) => r.id);
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    if (out.includes(next)) continue;
    out.push(next);
    queue.push(...(definedParents.get(next) ?? []));
  }
  return out;
}
