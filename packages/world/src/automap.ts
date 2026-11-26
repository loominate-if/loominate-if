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
} from "@loominate-if/presentation";
import { currentPlayerBody } from "./actors.js";
import { exitsOf } from "./exits.js";
import { _worldMap, type WorldMap } from "./map-layout.js";
import { visitsTo } from "./rooms.js";
import { placeOf, type Place } from "./things.js";

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
    if (!on.has(room.id) || !on.has(exit.to.id)) continue;
    const pair = [room.id, exit.to.id].sort().join("\u0000");
    if (drawn.has(pair)) continue;
    drawn.add(pair);
    const back = exits.find((e) => e.room.id === exit.to.id && e.exit.to.id === room.id);
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
      ({ room, exit }) => room.id === here.id && visited.has(exit.to.id) && exit.to.id !== here.id,
    )
    .map(({ exit }) =>
      message("automap.nearby", { room: exit.to, direction: exit.direction.name }),
    );
  return message("automap.summary", { room: here, nearby });
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
  // A room in the window, or just outside it, so a way can run off the edge toward it.
  const near = (x: number, y: number): boolean =>
    x >= -1 && y >= -1 && x <= size.columns && y <= size.rows;
  const shown: AutomapRoom[] = map.rooms.flatMap((r) => {
    const cell = map.layout.cells.get(r.id);
    if (!cell || !visited.has(r.id)) return [];
    const x = cell.x - left;
    const y = cell.y - top;
    if (!near(x, y)) return [];
    return [{ id: r.id, label: r.name, x, y, ...(r.id === here.id && { current: true as const }) }];
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
    ways: exitsOf(room).map((exit) => ({
      label: message("automap.way", {
        direction: exit.direction.name,
        ...(visited.has(exit.to.id) && { room: exit.to }),
      }),
      ...(visited.has(exit.to.id) && { to: exit.to.id }),
    })),
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
