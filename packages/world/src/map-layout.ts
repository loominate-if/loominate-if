/**
 * The world's rooms on the map grid (#394, #426; ADR 0124, ADR 0125), as the
 * story map's Rooms view and the auto-map both draw them: every room with
 * exits, laid out from the room the player's body starts in, with pins.
 * Anchoring on where the player starts by definition, not where they are,
 * keeps rooms in place as the player moves, and after a save is loaded.
 */
import { createStore, describeObjects, type ObjectRef, type StateValue } from "@loominate-if/core";
import { PLAYER_ID } from "./actors.js";
import { connectedRooms, exitsOf, type Exit } from "./exits.js";
import { gridLayout, type GridCell, type GridLayout } from "./map-grid.js";
import { _mapPin, isPlace, thingFor, type Place } from "./things.js";

/** An exit, with the room it leaves. */
export type MapExit = { readonly room: Place; readonly exit: Exit };

/** The world's rooms, their exits, and where the grid puts them. */
export type WorldMap = {
  /** Every room with exits, or that one leads to, from the starting room along the exits. */
  readonly rooms: readonly Place[];
  /** Every exit, room by room in ID order, each room's in direction order. */
  readonly exits: readonly MapExit[];
  /** The room the player's body starts in, by definition, if there's a player. */
  readonly start?: Place;
  /** Where the grid puts each room, and which exits are bent; indexes are {@link exits}'. */
  readonly layout: GridLayout;
};

const REF = "$ref";
/** The ID a stored reference points at. */
const refIn = (value: StateValue | undefined): string | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? ((value as Record<string, StateValue>)[REF] as string | undefined)
    : undefined;

let starting: { readonly found: boolean; readonly room?: Place } = { found: false };

/**
 * The room the player's body starts in, by the definitions, before any
 * play: the player's mind, the body it inhabits, and that body's location,
 * out to the place it's in. Definitions don't change during a run, so it's
 * found once.
 */
export function _startingRoom(): Place | undefined {
  if (starting.found) return starting.room;
  const defaults = new Map(
    describeObjects(createStore()).map((o) => [
      o.id,
      new Map(o.properties.map((p) => [p.key, p.value])),
    ]),
  );
  const at = (id: string | undefined, key: string): string | undefined =>
    id === undefined ? undefined : refIn(defaults.get(id)?.get(key));
  const body = at(at(PLAYER_ID, "mind"), "inhabits");
  const seen = new Set<string>();
  let room: Place | undefined;
  for (let id = body; id !== undefined && !seen.has(id); id = at(id, "location")) {
    seen.add(id);
    const ref: ObjectRef = { id };
    if (isPlace(ref)) {
      room = thingFor(ref) as Place;
      break;
    }
  }
  starting = { found: true, ...(room && { room }) };
  return room;
}

/** The world's rooms on the map grid, as they are now. */
export function _worldMap(): WorldMap {
  const connected = connectedRooms();
  const exits = connected.flatMap((room) => exitsOf(room).map((exit) => ({ room, exit })));
  // Rooms exits lead to but that have none of their own are rooms too.
  const all = new Map<string, Place>(connected.map((r) => [r.id, r]));
  for (const { exit } of exits) if (!all.has(exit.to.id)) all.set(exit.to.id, exit.to);
  const start = _startingRoom();
  const pins = new Map<string, GridCell>();
  for (const room of all.values()) {
    const pin = _mapPin(room);
    if (pin) pins.set(room.id, pin);
  }
  const layout = gridLayout(
    [...all.keys()],
    exits.map(({ room, exit }) => ({
      from: room.id,
      to: exit.to.id,
      direction: exit.direction.name,
    })),
    start?.id,
    pins,
  );
  // In the order a player meets them: the start, then along the exits, then the rest.
  const ordered = new Map<string, Place>();
  const roots = [...(start && all.has(start.id) ? [start] : []), ...all.values()];
  for (const root of roots) {
    const queue = [root];
    for (let at = queue.shift(); at !== undefined; at = queue.shift()) {
      if (ordered.has(at.id)) continue;
      ordered.set(at.id, at);
      for (const { room, exit } of exits) if (room.id === at.id) queue.push(exit.to);
    }
  }
  return { rooms: [...ordered.values()], exits, ...(start && { start }), layout };
}
