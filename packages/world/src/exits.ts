/**
 * Exits, doors, and obstacles (#64, ADR 0034).
 *
 * A room's exits are declared with {@link connect} once every room exists,
 * since rooms refer to each other. They're state, kept on a world-owned
 * object per room, so they can change during play. An exit can go `via` a
 * door or another obstacle, which says why it blocks the way. A passage's
 * `{exits}` shows the player's room's exits as links.
 */
import {
  actLink,
  mixin,
  object,
  message,
  StateError,
  type Handle,
  type LinkNode,
  type ObjectRef,
  type StateId,
} from "@loominate-if/core";
import { currentPlayerBody } from "./actors.js";
import {
  _excuseYourself,
  _lockedReason,
  _objectsToLeaving,
  conversation,
} from "./conversations.js";
import { directionNamed, directions, type Direction, type DirectionName } from "./directions.js";
import { closedReason } from "./hours.js";
import { journeyLink } from "./journeys.js";
import { arrivalPassage, visitsTo } from "./rooms.js";
import { isPlace, openable, placeOf, thingFor, type Place, type Thing } from "./things.js";

/** An exit as {@link connect} takes it: where it goes, and what's in the way. */
export type ExitSpec = {
  /** The room it leads to. */
  readonly to: ObjectRef;
  /** A door or other obstacle on the way, which can block it. */
  readonly via?: ObjectRef;
  /** How long the way takes, in minutes, for the game clock. */
  readonly minutes?: number;
  /**
   * A journey, by the name `journey()` gave it, which the way can be
   * stopped partway through, as a subway ride by a bomb on the tracks.
   */
  readonly journey?: string;
  /**
   * Hidden from the player, as a secret passage (#431): the compass, the
   * `{exits}` links, and the auto-map leave it out, and characters seen
   * taking it aren't said to go that way. Characters the game moves still
   * use it. Reveal it with `setExit`, giving the exit without `hidden`.
   */
  readonly hidden?: boolean;
};

/** A room's exits, by direction: a room, or an {@link ExitSpec}. */
export type ExitsDefinition = { readonly [K in DirectionName]?: ObjectRef | ExitSpec };

/** One of a room's exits, as {@link exitsOf} lists them. */
export type Exit = {
  /** Which way it goes. */
  readonly direction: Direction;
  /** The room it leads to. */
  readonly to: Place;
  /** The door or obstacle on the way, if any. */
  readonly via?: Thing;
  /** How long the way takes, in minutes, if it says. */
  readonly minutes?: number;
  /** The journey it is, if it can be stopped partway. */
  readonly journey?: string;
  /** True if it's hidden from the player until revealed. */
  readonly hidden?: true;
};

/** An exit as stored. */
type StoredExit = {
  to: ObjectRef;
  via?: ObjectRef;
  minutes?: number;
  journey?: string;
  hidden?: true;
};
type ExitRecord = Handle<{ exits: Record<string, StoredExit> }>;

/** Each connected room's exits, by the room's ID. */
const records = new Map<StateId, ExitRecord>();

/** Something that can block an exit, saying why. */
type Blocker = { blocks?(traveler: ObjectRef): string | undefined };

/**
 * Something that can stand in the way of an exit, such as a rockfall or a
 * guard. Give it a `blocks` method of its own, returning why the way is
 * blocked, or `undefined` when it isn't.
 *
 * @example
 * ```ts
 * export const rubble = thing("rubble", {
 *   ...obstacle,
 *   name: "heap of rubble",
 *   isCleared: false,
 *   blocks() {
 *     return this.isCleared ? undefined : "Rubble blocks the tunnel.";
 *   },
 * });
 * ```
 */
export const obstacle = mixin({
  /** Why it blocks the way for `traveler`, or `undefined` if it doesn't. */
  blocks(traveler: ObjectRef): string | undefined {
    void traveler;
    return undefined;
  },
});

/**
 * A door: it opens and closes, and blocks the way while it's closed. Spread
 * {@link lockable} in too for a door that locks. Both rooms' exits name the
 * same door with `via`, so it's in scope from both, and opening it from one
 * side opens it for both.
 *
 * @example
 * ```ts
 * export const cellarDoor = thing("cellarDoor", { ...door, ...lockable, name: "cellar door" });
 * ```
 */
export const door = mixin({
  ...openable,
  /** "The cellar door is locked." or "… is closed.", or `undefined` when it's open. */
  blocks(traveler: ObjectRef): string | undefined {
    void traveler;
    const self = this as unknown as ObjectRef & { isOpen: boolean; isLocked?: boolean };
    if (self.isLocked === true) return message("door.locked", { door: self });
    if (!self.isOpen) return message("door.closed", { door: self });
    return undefined;
  },
});

/** Checks and stores one exit. */
function stored(exit: ObjectRef | ExitSpec, where: string): StoredExit {
  const spec: ExitSpec = "to" in exit ? exit : { to: exit };
  if (!isPlace(spec.to)) {
    throw new StateError(
      `${where}: ${JSON.stringify(spec.to.id)} isn't a place. Define it with place().`,
    );
  }
  if (spec.via !== undefined && !thingFor(spec.via)) {
    throw new StateError(
      `${where}: ${JSON.stringify(spec.via.id)} isn't a thing. Define it with thing(), spreading in door or obstacle.`,
    );
  }
  if (spec.minutes !== undefined && !(Number.isFinite(spec.minutes) && spec.minutes >= 0)) {
    throw new StateError(`${where}: minutes must be a number of minutes, 0 or more.`);
  }
  return {
    to: thingFor(spec.to) as Thing,
    ...(spec.via !== undefined && { via: thingFor(spec.via) as Thing }),
    ...(spec.minutes !== undefined && { minutes: spec.minutes }),
    ...(spec.journey !== undefined && { journey: spec.journey }),
    ...(spec.hidden === true && { hidden: true as const }),
  };
}

/**
 * Declares a room's exits, in `story.ts`, once every room is defined. Exits
 * are one-way: connect both rooms for a way there and back.
 *
 * @example
 * ```ts
 * connect(hall, { north: library, down: { to: cellar, via: cellarDoor } });
 * connect(library, { south: hall });
 * connect(cellar, { up: { to: hall, via: cellarDoor } });
 * ```
 *
 * @throws StateError if `from` isn't a place or is already connected, a
 * direction isn't registered, or an exit doesn't lead to a place.
 */
export function connect(from: ObjectRef, exits: ExitsDefinition): void {
  const where = `connect ${JSON.stringify(from.id)}`;
  if (!isPlace(from)) {
    throw new StateError(`${where}: it isn't a place. Define it with place().`);
  }
  if (records.has(from.id)) {
    throw new StateError(
      `${where}: its exits are already declared. Connect each room once, and change exits during play with setExit().`,
    );
  }
  const out: Record<string, StoredExit> = {};
  for (const [name, exit] of Object.entries(exits) as [
    string,
    ObjectRef | ExitSpec | undefined,
  ][]) {
    if (exit === undefined) continue;
    if (!directionNamed(name)) {
      throw new StateError(
        `${where}: there's no direction ${JSON.stringify(name)}. Register it with direction().`,
      );
    }
    out[name] = stored(exit, `${where} ${name}`);
  }
  records.set(from.id, object(`world:exits:${from.id}`, { exits: out }));
}

/**
 * Changes one of a room's exits during play, or removes it with `null`,
 * such as when a tunnel collapses. The room must have been connected in
 * `story.ts`, even with no exits: `connect(cave, {})`.
 *
 * @throws StateError if the room was never connected, the direction isn't
 * registered, or the exit doesn't lead to a place.
 */
export function setExit(
  from: ObjectRef,
  name: DirectionName,
  exit: ObjectRef | ExitSpec | null,
): void {
  const where = `setExit ${JSON.stringify(from.id)} ${name}`;
  const record = records.get(from.id);
  if (!record) {
    throw new StateError(
      `${where}: the room was never connected. Call connect(${from.id}, {…}) in story.ts, even with no exits.`,
    );
  }
  if (!directionNamed(name)) {
    throw new StateError(
      `${where}: there's no direction ${JSON.stringify(name)}. Register it with direction().`,
    );
  }
  const others = Object.entries(record.exits).filter(([d]) => d !== name);
  record.exits = Object.fromEntries(
    exit === null ? others : [...others, [name, stored(exit, where)]],
  );
}

/**
 * `room`'s exits, in the order directions are registered, hidden ones
 * too: filter out `hidden` for the ways the player knows.
 */
export function exitsOf(room: ObjectRef): Exit[] {
  const stored = records.get(room.id)?.exits;
  if (!stored) return [];
  return directions().flatMap((d): Exit[] => {
    const e = stored[d.name];
    if (!e) return [];
    const to = thingFor(e.to) as Place;
    const via = e.via ? thingFor(e.via) : undefined;
    return [
      {
        direction: d,
        to,
        ...(via !== undefined && { via }),
        ...(e.minutes !== undefined && { minutes: e.minutes }),
        ...(e.journey !== undefined && { journey: e.journey }),
        ...(e.hidden === true && { hidden: true as const }),
      },
    ];
  });
}

/** Every connected room, sorted by ID. @internal */
export function connectedRooms(): Place[] {
  return [...records.keys()].sort().flatMap((id) => {
    const t = thingFor({ id });
    return t ? [t as Place] : [];
  });
}

/**
 * Why `exit` is blocked for `traveler`, or `undefined` if the way is clear:
 * its door's or obstacle's opening hours, then its own reason.
 */
export function blockedReason(exit: Exit, traveler: ObjectRef): string | undefined {
  const via = exit.via as (Thing & Blocker) | undefined;
  if (!via) return undefined;
  return closedReason(via, exit.to) ?? via.blocks?.(traveler);
}

/** The doors and obstacles on `room`'s exits, which can be sensed from it. @internal */
export function waysOut(room: ObjectRef): Thing[] {
  const out = new Map<StateId, Thing>();
  for (const e of exitsOf(room)) if (e.via) out.set(e.via.id, e.via);
  return [...out.values()];
}

/**
 * The links `{exits}` shows: one for each of the player's room's exits,
 * leading to the passage that describes where it goes. A blocked exit is
 * shown disabled, with its door's or obstacle's reason. An exit to a room
 * the player has visited names the room.
 *
 * @throws StateError if an exit leads to a room no passage describes.
 */
export function exitLinks(args: Readonly<Record<string, never>> = {}): LinkNode[] {
  void args; // `{exits}` takes no arguments; directives pass them as an object.
  return [...ways(), ...extraLinks.flatMap((more) => more())];
}

/** Links other modules add after the exits, as following someone the player saw leave. */
const extraLinks: (() => LinkNode[])[] = [];

/** Adds links that `{exits}` shows after the exits. @internal */
export function _addExitLinks(links: () => LinkNode[]): void {
  extraLinks.push(links);
}

/** The links for the ways out of the player's room. */
function ways(): LinkNode[] {
  const body = currentPlayerBody();
  const here = body ? placeOf(body) : undefined;
  if (!body || !here) return [];
  const locked = conversation.active ? _lockedReason() : undefined;
  const objects = conversation.active && _objectsToLeaving();
  return exitsOf(here)
    .filter((e) => e.hidden !== true)
    .map((e): LinkNode => {
      const target = arrivalPassage(e.to);
      if (target === undefined) {
        throw new StateError(
          `{exits}: the ${e.direction.name} exit from ${JSON.stringify(here.id)} leads to ${JSON.stringify(e.to.id)}, which no passage describes. Tag one [room: …] for it.`,
        );
      }
      const label = message("exit.label", {
        direction: message("direction.label", { direction: e.direction.name }),
        room: e.to,
        visited: visitsTo(e.to) > 0,
      });
      // A journey is taken as an action, so it can be stopped partway and end somewhere else.
      // A locked conversation holds the player (#117): a hard lock disables every
      // way out, and a soft one meets the first try with an objection.
      if (locked !== undefined) {
        return {
          type: "link",
          label,
          target,
          guard: {
            open: false,
            condition: "the conversation isn't locked",
            mode: "disabled-with-reason" as const,
            reason: locked,
          },
        };
      }
      if (objects && blockedReason(e, body) === undefined) {
        return {
          type: "link",
          label,
          target,
          guard: actLink({ call: _excuseYourself({ way: e.direction.name }) }),
        };
      }
      if (e.journey !== undefined) {
        return { type: "link", label, target, guard: journeyLink(e.direction.name) };
      }
      const reason = blockedReason(e, body);
      return {
        type: "link",
        label,
        target,
        ...(reason !== undefined && {
          guard: {
            open: false,
            condition: `nothing blocks the way ${e.direction.name} (${e.via?.id ?? ""})`,
            mode: "disabled-with-reason" as const,
            reason,
          },
        }),
      };
    });
}
