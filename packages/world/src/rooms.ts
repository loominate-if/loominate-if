/**
 * Rooms: passages tagged `room:`, visits, and regions the player moves
 * between (#63, ADR 0033).
 *
 * A room is a place a passage describes. Arriving at a `[room: cellar]`
 * passage moves the player there and counts a visit. Moving the player across
 * a region's edge runs the region's `onEnter` and `onLeave`.
 */
import { object, StateError, type EffectContext, type ObjectRef } from "@loominate-if/core";
import { currentPlayerBody, playerBody } from "./actors.js";
import { nearestRegions, regionFor, type Region, type RegionHooks } from "./regions.js";
import { byId, isPlace, isWithin, move, onMove, placeOf, type Place } from "./things.js";

/** Visits to each place, by ID: arrivals at its `room:` passages. */
const visits = object("world:visits", { counts: {} as Record<string, number> });

/**
 * What a passage tagged `[room: cellar]` calls when the player arrives: it
 * moves the player's body into `room`, unless it's already there, and counts
 * a visit to it.
 *
 * @remarks
 * It runs before the passage's own `{on enter: …}` code, so that code sees
 * the player in the room. A body already in the room, even inside something
 * there, such as a chair, stays where it is.
 *
 * @throws StateError if `room` isn't a place, or the player has no body.
 */
export function enterRoom(room: Place, context?: EffectContext): void {
  void context;
  const where = `[room: ${room.id}]`;
  if (!isPlace(room)) {
    throw new StateError(
      `${where}: ${JSON.stringify(room.id)} isn't a place. Define it with place().`,
    );
  }
  const body = playerBody();
  if (!body) {
    throw new StateError(
      `${where}: the player's mind is in no body, so it can't enter the room. Put it in one with possess().`,
    );
  }
  if (placeOf(body)?.id !== room.id) move(body, room);
  visits.counts[room.id] = visitsTo(room) + 1;
}

/** How many times the player has arrived at `room`'s passages, counting this arrival. */
export function visitsTo(room: ObjectRef): number {
  return visits.counts[room.id] ?? 0;
}

/**
 * The regions `t` is in, sorted by ID: for a place, the regions it lists and
 * the regions those are in; for a thing, its place's; for a region, the
 * regions it's in.
 */
export function regionsOf(t: ObjectRef): Region[] {
  const self = regionFor(t);
  if (self) return nearestRegions(self.regions).sort(byId);
  const at = placeOf(t);
  return at ? nearestRegions(at.regions).sort(byId) : [];
}

/** Whether `t` is in `region`, directly or through a region inside it. */
export function isInRegion(t: ObjectRef, region: ObjectRef): boolean {
  return regionsOf(t).some((r) => r.id === region.id);
}

/** Runs regions' hooks when the player's body crosses their edges. */
onMove((moved, from) => {
  const body = currentPlayerBody();
  if (!body || !(moved.id === body.id || isWithin(body, moved))) return;
  const to = placeOf(body);
  if (from?.id === to?.id) return;
  const before = from ? regionsOf(from) : [];
  const after = to ? regionsOf(to) : [];
  const has = (list: readonly Region[], r: Region) => list.some((x) => x.id === r.id);
  // Inner regions are left before the regions around them, and entered after them.
  const depth = (r: Region) => regionsOf(r).length;
  const left = before
    .filter((r) => !has(after, r))
    .sort((a, b) => depth(b) - depth(a) || byId(a, b));
  const entered = after
    .filter((r) => !has(before, r))
    .sort((a, b) => depth(a) - depth(b) || byId(a, b));
  for (const r of left) (r as Region & RegionHooks).onLeave?.(from as Place);
  for (const r of entered) (r as Region & RegionHooks).onEnter?.(to as Place);
});
