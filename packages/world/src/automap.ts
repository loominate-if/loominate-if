/**
 * The world model's auto-map (#394, ADR 0125): presentation's auto-map,
 * showing the rooms the player has visited in a window around their room,
 * on the grid the story map's Rooms view uses. It's read from game state
 * each time it's drawn, so undo, saves, and replays agree. A game places
 * it, as with `addToHeader("automap")`.
 */
import { message } from "@loominate-if/core";
import {
  automapWidget,
  widgets,
  type AutomapLink,
  type AutomapRoom,
  type AutomapView,
  type WidgetDefinition,
  type AutomapData,
  type AutomapFullMap,
  type AutomapMarker,
  type AutomapStub,
} from "@loominate-if/presentation";
import { currentPlayerBody, currentPlayerMind, isBody } from "./actors.js";
import { _gridStep } from "./map-grid.js";
import { exitsOf } from "./exits.js";
import { _worldMap, type WorldMap } from "./map-layout.js";
import { visitsTo } from "./rooms.js";
import { _allThings, _mapMarking, isPlace, isWithin, placeOf, type Place } from "./things.js";

/** How the world model's auto-map is drawn, for {@link automap}. */
export type AutomapSettings = {
  /** Cells across, odd so the player's room is in the middle. Defaults to 5. */
  readonly columns?: number;
  /** Cells down, odd. Defaults to 3. */
  readonly rows?: number;
};

/** The rooms the player has visited, and the room they're in. */
function visitedRooms(map: WorldMap, here: Place): Set<string> {
  return new Set(map.rooms.filter((r) => r.id === here.id || visitsTo(r) > 0).map((r) => r.id));
}

/**
 * The ways between rooms on show: each pair once, from the room met first,
 * so a ladder reads "Up / Down" from the bottom; one-way ways marked, and
 * ways that aren't a step in their direction named.
 */
function linksAmong(map: WorldMap, on: ReadonlySet<string>): AutomapLink[] {
  const { rooms, exits, layout } = map;
  const links: AutomapLink[] = [];
  const drawn = new Set<string>();
  const short = (direction: string): string => message("compass.short", { direction });
  const order = new Map(rooms.map((r, i) => [r.id, i]));
  const met = exits
    .map((e, i) => ({ ...e, i }))
    .sort((a, b) => (order.get(a.room.id) ?? 0) - (order.get(b.room.id) ?? 0) || a.i - b.i);
  for (const { room, exit, i } of met) {
    // A hidden way isn't drawn until it's revealed (#431); it still placed the rooms.
    if (exit.hidden === true || !on.has(room.id) || !on.has(exit.to.id)) continue;
    const pair = [room.id, exit.to.id].sort().join("\u0000");
    if (drawn.has(pair)) continue;
    drawn.add(pair);
    const back = exits.find(
      (e) => e.room.id === exit.to.id && e.exit.to.id === room.id && e.exit.hidden !== true,
    );
    const label = back
      ? `${short(exit.direction.name)} / ${short(back.exit.direction.name)}`
      : short(exit.direction.name);
    links.push({
      from: room.id,
      to: exit.to.id,
      ...(!back && { oneWay: true as const }),
      ...(layout.bent.has(i) && { label }),
    });
  }
  return links;
}

/** The player's room now, and the map, if they're somewhere on it. */
function whereNow(): { here: Place; map: WorldMap } | undefined {
  const body = currentPlayerBody();
  const here = body ? placeOf(body) : undefined;
  if (!here) return undefined;
  const map = _worldMap();
  return map.layout.cells.has(here.id) ? { here, map } : undefined;
}

/** What a screen reader says for the map: where the player is, and the visited rooms next to it. */
function summaryOf(map: WorldMap, here: Place, visited: ReadonlySet<string>): string {
  const nearby = map.exits
    .filter(
      ({ room, exit }) =>
        room.id === here.id &&
        exit.hidden !== true &&
        visited.has(exit.to.id) &&
        exit.to.id !== here.id,
    )
    .map(({ exit }) =>
      message("automap.nearby", { room: exit.to, direction: exit.direction.name }),
    );
  return message("automap.summary", { room: here, nearby });
}

/**
 * What the player last saw where (#396), by room: people, unless marked
 * `onMap: false`, and things marked `onMap`. It's what the player's mind
 * remembers, not where they are now. What the player carries isn't marked.
 */
function markersByRoom(): Map<string, AutomapMarker[]> {
  const byRoom = new Map<string, AutomapMarker[]>();
  const mind = currentPlayerMind();
  const body = currentPlayerBody();
  if (!mind) return byRoom;
  const people: [string, AutomapMarker][] = [];
  const things: [string, AutomapMarker][] = [];
  for (const t of _allThings()) {
    if (isPlace(t) || (body && (t.id === body.id || isWithin(t, body)))) continue;
    const marking = _mapMarking(t);
    const person = isBody(t);
    if (marking === false || (marking === undefined && !person)) continue;
    const room = mind.lastSaw(t);
    if (!room) continue;
    const marked = typeof marking === "object" ? marking : {};
    const marker: AutomapMarker = {
      label: marked.label ?? t.name,
      ...(marked.icon !== undefined && { icon: marked.icon }),
      ...(person && { person: true as const }),
    };
    (person ? people : things).push([room.id, marker]);
  }
  // People first, then things, each in the order they're defined.
  for (const [room, marker] of [...people, ...things]) {
    byRoom.set(room, [...(byRoom.get(room) ?? []), marker]);
  }
  return byRoom;
}

/** A visited room's ways to rooms the player hasn't been to, as stubs pointing their way. */
function stubsOf(room: Place, visited: ReadonlySet<string>): AutomapStub[] {
  return exitsOf(room)
    .filter((e) => e.hidden !== true && !visited.has(e.to.id))
    .map((e) => {
      const step = _gridStep(e.direction.name);
      return {
        x: step.x,
        y: step.y,
        ...(!step.compass && {
          label: message("compass.short", { direction: e.direction.name }),
        }),
      };
    });
}

/** What a room shows besides its name: its markers and stubs, if it has any. */
function extras(
  room: Place,
  visited: ReadonlySet<string>,
  markers: ReadonlyMap<string, readonly AutomapMarker[]>,
): Pick<AutomapRoom, "markers" | "stubs"> {
  const here = markers.get(room.id) ?? [];
  const stubs = stubsOf(room, visited);
  return { ...(here.length > 0 && { markers: here }), ...(stubs.length > 0 && { stubs }) };
}

/** The visited rooms around the player, in a window of `columns` by `rows` cells. @internal */
export function _automapView(size: { columns: number; rows: number }): AutomapView | undefined {
  const now = whereNow();
  if (!now) return undefined;
  const { here, map } = now;
  const centre = map.layout.cells.get(here.id) ?? { x: 0, y: 0 };
  const left = centre.x - Math.floor(size.columns / 2);
  const top = centre.y - Math.floor(size.rows / 2);
  const visited = visitedRooms(map, here);
  const markers = markersByRoom();
  // A room in the window, or just outside it, so a way can run off the edge toward it.
  const near = (x: number, y: number): boolean =>
    x >= -1 && y >= -1 && x <= size.columns && y <= size.rows;
  const shown: AutomapRoom[] = map.rooms.flatMap((r) => {
    const cell = map.layout.cells.get(r.id);
    if (!cell || !visited.has(r.id)) return [];
    const x = cell.x - left;
    const y = cell.y - top;
    if (!near(x, y)) return [];
    return [
      {
        id: r.id,
        label: r.name,
        x,
        y,
        ...(r.id === here.id && { current: true as const }),
        ...extras(r, visited, markers),
      },
    ];
  });
  return {
    summary: summaryOf(map, here, visited),
    rooms: shown,
    links: linksAmong(map, new Set(shown.map((r) => r.id))),
  };
}

/**
 * Every room the player has visited, for the full map (#395), on a grid
 * just big enough for them, each with its ways out: to the room, named, if
 * the player has been there. @internal
 */
export function _automapFull(): AutomapFullMap | undefined {
  const now = whereNow();
  if (!now) return undefined;
  const { here, map } = now;
  const visited = visitedRooms(map, here);
  const markers = markersByRoom();
  const placed = map.rooms.flatMap((r) => {
    const cell = map.layout.cells.get(r.id);
    return cell && visited.has(r.id) ? [{ room: r, cell }] : [];
  });
  const left = Math.min(...placed.map((p) => p.cell.x));
  const top = Math.min(...placed.map((p) => p.cell.y));
  const rooms: AutomapRoom[] = placed.map(({ room, cell }) => ({
    id: room.id,
    label: room.name,
    x: cell.x - left,
    y: cell.y - top,
    ...(room.id === here.id && { current: true as const }),
    ways: exitsOf(room)
      .filter((exit) => exit.hidden !== true)
      .map((exit) => ({
        label: message("automap.way", {
          direction: exit.direction.name,
          ...(visited.has(exit.to.id) && { room: exit.to }),
        }),
        ...(visited.has(exit.to.id) && { to: exit.to.id }),
      })),
    ...extras(room, visited, markers),
  }));
  return {
    columns: Math.max(...rooms.map((r) => r.x)) + 1,
    rows: Math.max(...rooms.map((r) => r.y)) + 1,
    view: {
      summary: summaryOf(map, here, visited),
      rooms,
      links: linksAmong(map, visited),
    },
  };
}

/**
 * An auto-map widget showing the rooms the player has visited around their
 * room. The world model registers one as `automap`, with the defaults;
 * replace it to change them, as `widgets.replace("automap", automap({ columns: 7 }))`,
 * and place it with `addToHeader("automap")` or in a layout of your own.
 */
export function automap(settings: AutomapSettings = {}): WidgetDefinition<AutomapData> {
  return automapWidget({
    ...(settings.columns !== undefined && { columns: settings.columns }),
    ...(settings.rows !== undefined && { rows: settings.rows }),
    rooms: (_game, size) => _automapView(size),
    full: () => _automapFull(),
  });
}

widgets.register("automap", automap(), { source: "@loominate-if/world" });
