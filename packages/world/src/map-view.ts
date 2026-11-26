/**
 * The world model's view of the story map (#426, ADR 0124): every room with
 * exits, by name, laid out by compass, with each exit's direction and door,
 * read from the begun game.
 */
import { mapViews, type MapViewEdge, type MapViewNode } from "@loominate-if/core";
import { playerBody } from "./actors.js";
import { connectedRooms, exitsOf } from "./exits.js";
import { gridLayout } from "./map-grid.js";
import { roomPassageIds } from "./rooms.js";
import { placeOf, type Place } from "./things.js";

const SOURCE = "@loominate-if/world";

/** The room the player is in when the game begins, if there's a player yet. */
function startRoom(): Place | undefined {
  try {
    const body = playerBody();
    return body ? placeOf(body) : undefined;
  } catch {
    // No startAs() in the game: there's no player, so no start room.
    return undefined;
  }
}

mapViews.register(
  "rooms",
  {
    title: "Rooms",
    view: () => {
      const connected = connectedRooms();
      const exits = connected.flatMap((room) => exitsOf(room).map((exit) => ({ room, exit })));
      // Rooms exits lead to but that have none of their own are rooms too.
      const rooms = new Map<string, Place>(connected.map((r) => [r.id, r]));
      for (const { exit } of exits) if (!rooms.has(exit.to.id)) rooms.set(exit.to.id, exit.to);
      const start = startRoom();
      const layout = gridLayout(
        [...rooms.keys()],
        exits.map(({ room, exit }) => ({
          from: room.id,
          to: exit.to.id,
          direction: exit.direction.name,
        })),
        start?.id,
      );
      // In the order a player meets them: the start, then along the exits, then the rest.
      const ordered = new Map<string, Place>();
      const roots = [...(start && rooms.has(start.id) ? [start] : []), ...rooms.values()];
      for (const root of roots) {
        const queue = [root];
        for (let at = queue.shift(); at !== undefined; at = queue.shift()) {
          if (ordered.has(at.id)) continue;
          ordered.set(at.id, at);
          for (const { room, exit } of exits) if (room.id === at.id) queue.push(exit.to);
        }
      }
      const nodes: MapViewNode[] = [...ordered.values()].map((room) => {
        const passages = roomPassageIds(room);
        const cell = layout.cells.get(room.id);
        return {
          id: room.id,
          label: room.name,
          ...(passages.length > 0 && { tags: passages.map((p) => `passage: ${p}`) }),
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
