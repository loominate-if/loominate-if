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
} from "@loominate-if/presentation";
import { currentPlayerBody } from "./actors.js";
import { _worldMap } from "./map-layout.js";
import { visitsTo } from "./rooms.js";
import { placeOf } from "./things.js";

/** How the world model's auto-map is drawn, for {@link automap}. */
export type AutomapSettings = {
  /** Cells across, odd so the player's room is in the middle. Defaults to 5. */
  readonly columns?: number;
  /** Cells down, odd. Defaults to 3. */
  readonly rows?: number;
};

/** The visited rooms around the player, in a window of `columns` by `rows` cells. @internal */
export function _automapView(size: { columns: number; rows: number }): AutomapView | undefined {
  const body = currentPlayerBody();
  const here = body ? placeOf(body) : undefined;
  if (!here) return undefined;
  const { rooms, exits, layout } = _worldMap();
  const centre = layout.cells.get(here.id);
  if (!centre) return undefined;
  const left = centre.x - Math.floor(size.columns / 2);
  const top = centre.y - Math.floor(size.rows / 2);
  const visited = new Set(
    rooms.filter((r) => r.id === here.id || visitsTo(r) > 0).map((r) => r.id),
  );
  // A room in the window, or just outside it, so a way can run off the edge toward it.
  const near = (x: number, y: number): boolean =>
    x >= -1 && y >= -1 && x <= size.columns && y <= size.rows;
  const shown: AutomapRoom[] = rooms.flatMap((r) => {
    const cell = layout.cells.get(r.id);
    if (!cell || !visited.has(r.id)) return [];
    const x = cell.x - left;
    const y = cell.y - top;
    if (!near(x, y)) return [];
    return [{ id: r.id, label: r.name, x, y, ...(r.id === here.id && { current: true as const }) }];
  });
  const on = new Set(shown.map((r) => r.id));
  const links: AutomapLink[] = [];
  const drawn = new Set<string>();
  const short = (direction: string): string => message("compass.short", { direction });
  // Each pair once, from the room met first, so a ladder reads "Up / Down" from the bottom.
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
  const nearby = exits
    .filter(
      ({ room, exit }) => room.id === here.id && visited.has(exit.to.id) && exit.to.id !== here.id,
    )
    .map(({ exit }) =>
      message("automap.nearby", { room: exit.to, direction: exit.direction.name }),
    );
  return { summary: message("automap.summary", { room: here, nearby }), rooms: shown, links };
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
  });
}

widgets.register("automap", automap(), { source: "@loominate-if/world" });
