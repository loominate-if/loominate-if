/**
 * The player's own notes on rooms (#397, ADR 0129), written on the full
 * map. They're the person playing's, not the character's, so they stay
 * when the game switches who the player is. Writing one is an action
 * outside the story (`turn: false`): it's saved, undone, and replayed like
 * any, but it isn't a turn, so no time passes and no one else acts.
 */
import {
  action,
  message,
  messages,
  object,
  StateError,
  t,
  type ObjectRef,
} from "@loominate-if/core";
import { reachNotNeeded } from "./acting.js";
import { currentPlayerBody } from "./actors.js";
import { visitsTo } from "./rooms.js";
import { isPlace, placeOf, thingFor } from "./things.js";

const SOURCE = "@loominate-if/world";

/** How long a note can be, in characters; longer ones are cut. */
export const MAP_NOTE_LENGTH = 500;

declare module "@loominate-if/core" {
  interface Messages {
    /** Writing a note, as the move is called for undo and the transcript: "Note on the kitchen". */
    "noteRoom.label": { readonly room: ObjectRef };
    /** Why a room can't be noted: "You haven't been there yet." */
    "noteRoom.unvisited": { readonly room: ObjectRef };
  }
}
messages.register("noteRoom.label", t`Note on {the room}`, { source: SOURCE });
messages.register("noteRoom.unvisited", "You haven't been there yet.", { source: SOURCE });

/** The notes, by room ID. */
const state = object("world:mapNotes", { notes: {} as Record<string, string> });

/** The player's note on `room`, if they've written one. @internal */
export function _mapNote(room: ObjectRef): string | undefined {
  return state.notes[room.id];
}

/**
 * Writes the player's note on a room they've been to, replacing any, or
 * removes it, given empty text. Notes are cut to {@link MAP_NOTE_LENGTH}
 * characters. It's outside the story, so it isn't a turn. The full map
 * takes it when the player writes a note; a game can too, as in an effect.
 *
 * @example
 * ```ts
 * perform(noteRoom({ room: kitchen, text: "Tobias hides the key under the bread bin." }));
 * ```
 */
export const noteRoom = action<{ readonly room: ObjectRef; readonly text: string }>("noteRoom", {
  source: SOURCE,
  turn: false,
  label: ({ room }) => message("noteRoom.label", { room }),
  verify: ({ room }) => {
    const here = currentPlayerBody();
    const at = here ? placeOf(here) : undefined;
    if (!isPlace(room)) {
      throw new StateError(
        `noteRoom: ${JSON.stringify(room.id)} isn't a place. Notes are on rooms.`,
      );
    }
    return at?.id === room.id || visitsTo(room) > 0
      ? undefined
      : message("noteRoom.unvisited", { room });
  },
  run: ({ room, text }) => {
    const note = text.trim().slice(0, MAP_NOTE_LENGTH);
    const others = Object.fromEntries(Object.entries(state.notes).filter(([id]) => id !== room.id));
    state.notes = note === "" ? others : { ...others, [room.id]: note };
  },
});

// A note can be on any room the player has been to, not just the one they're in.
reachNotNeeded(noteRoom, "room");

/** Writes or removes the note on the room with ID `id`, for the auto-map. @internal */
export function _noteCall(id: string, text: string): ReturnType<typeof noteRoom> {
  return noteRoom({ room: thingFor({ id }) ?? { id }, text });
}
