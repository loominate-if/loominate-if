/**
 * The world model's view of the story map (#426, ADR 0124): every room with
 * exits, by name, on the grid the auto-map uses, with each exit's direction
 * and door. Rooms moved off the cell their exits asked for say so, with how
 * to pin them, for the author.
 */
import { mapViews, type MapViewEdge, type MapViewNode } from "@loominate-if/core";
import { _worldMap } from "./map-layout.js";
import { roomPassageIds } from "./rooms.js";

const SOURCE = "@loominate-if/world";

mapViews.register(
  "rooms",
  {
    title: "Rooms",
    view: () => {
      const { rooms, exits, start, layout } = _worldMap();
      const nudged = new Set(layout.nudged);
      const nodes: MapViewNode[] = rooms.map((room) => {
        const passages = roomPassageIds(room);
        const cell = layout.cells.get(room.id);
        const tags = [
          ...passages.map((p) => `passage: ${p}`),
          ...(nudged.has(room.id) && cell
            ? [
                `nudged: another room has the cell its exits ask for. Pin it, as map: { x: ${String(cell.x)}, y: ${String(cell.y)} } where it is now, to keep it there or choose another cell`,
              ]
            : []),
        ];
        return {
          id: room.id,
          label: room.name,
          ...(tags.length > 0 && { tags }),
          ...(room.id === start?.id && { start: true as const }),
          ...(cell && { cell }),
        };
      });
      const edges: MapViewEdge[] = exits.map(({ room, exit }, i) => ({
        from: room.id,
        to: exit.to.id,
        kind: exit.direction.name,
        label: exit.via
          ? `${exit.direction.label}, through the ${exit.via.name}`
          : exit.direction.label,
        ...(exit.via !== undefined && { guarded: true as const }),
        ...(layout.bent.has(i) && { bent: true as const }),
      }));
      return { nodes, edges };
    },
  },
  { source: SOURCE },
);
