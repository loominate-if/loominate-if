/**
 * The world model's messages (#71, ADR 0039), in core's message table, so a
 * game can reword them or give them a voice. Each is a `t` template or a
 * function of what it's about, which `{the door}` and friends name.
 */
import { messages, t, type ObjectRef } from "@loominate-if/core";
import { directionNamed } from "./directions.js";

/** A direction, by name, such as `north` or a game's own `fore`. */
type Way = { readonly direction: string };

declare module "@loominate-if/core" {
  interface Messages {
    /** Why a locked door blocks the way: "The cellar door is locked." */
    "door.locked": { readonly door: ObjectRef };
    /** Why a closed door blocks the way: "The cellar door is closed." */
    "door.closed": { readonly door: ObjectRef };
    /** An actor coming into sight: "Mira arrives from outside." `from` is a direction's from-phrase, if it's known. */
    "actor.arrives": { readonly actor: ObjectRef; readonly from?: string };
    /** An actor leaving: "Mira leaves upstairs." `toward` is a direction's phrase, if it's known. */
    "actor.leaves": { readonly actor: ObjectRef; readonly toward?: string };
    /** An exit's link: "North", or "North, to the library" once the room's been visited. */
    "exit.label": {
      readonly direction: string;
      readonly room: ObjectRef;
      readonly visited: boolean;
    };
    /** A direction's name on an exit: "North". */
    "direction.label": Way;
    /** Going that way: "to the north", "upstairs". */
    "direction.toward": Way;
    /** Coming from that way: "from the north", "from above". */
    "direction.from": Way;
    /** What a screen reader hears for the auto-map: "Map: you're in the taproom. Visited nearby: the kitchen to the east." */
    "automap.summary": { readonly room: ObjectRef; readonly nearby: readonly string[] };
    /** A visited room next to the player's, in the auto-map's summary: "the kitchen to the east", "the landing upstairs". */
    "automap.nearby": { readonly room: ObjectRef; readonly direction: string };
  }
}

const SOURCE = "@loominate-if/world";
const register: typeof messages.register = (key, text) => {
  messages.register(key, text, { source: SOURCE });
};

register("door.locked", t`{The subj door} {is} locked.`);
register("door.closed", t`{The subj door} {is} closed.`);
register(
  "actor.arrives",
  ({ actor, from }) => `${t`{The subj actor} {arrives}`({ actor })}${from ? ` ${from}` : ""}.`,
);
register(
  "actor.leaves",
  ({ actor, toward }) => `${t`{The subj actor} {leaves}`({ actor })}${toward ? ` ${toward}` : ""}.`,
);
register("exit.label", ({ direction, room, visited }) =>
  visited ? `${direction}, ${t`to {the room}`({ room })}` : direction,
);
register("direction.label", ({ direction }) => directionNamed(direction)?.label ?? direction);
register("direction.toward", ({ direction }) => directionNamed(direction)?.toward ?? direction);
register("direction.from", ({ direction }) => directionNamed(direction)?.from ?? direction);
register("automap.summary", ({ room, nearby }) =>
  [
    `Map: you're in ${t`{the room}`({ room })}.`,
    nearby.length > 0
      ? `Visited nearby: ${nearby.join(", ")}.`
      : "You haven't been anywhere next to it.",
  ].join(" "),
);
register(
  "automap.nearby",
  ({ room, direction }) =>
    `${t`{the room}`({ room })} ${directionNamed(direction)?.toward ?? direction}`,
);
