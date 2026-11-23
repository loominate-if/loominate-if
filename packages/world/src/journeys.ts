/**
 * Journeys (#304, ADR 0062): ways between rooms that take long enough to be
 * stopped partway, as a subway ride stopped by a bomb on the tracks, while
 * lesser events, such as a phone call, are only told on the way.
 *
 * An exit names a journey, defined when the game loads. Its link is taken
 * as an action: the clock moves on first, then the player arrives, or, if
 * something the journey stops for interrupts it, ends up where the journey
 * says. Either way the story goes on to that place's passage with core's
 * `redirect`, in the same move, so the destination's passage is only
 * entered if they arrive.
 */
import {
  action,
  actLink,
  message,
  redirect,
  NameTaken,
  StateError,
  type LinkGuard,
  type ObjectRef,
} from "@loominate-if/core";
import { currentPlayerBody } from "./actors.js";
import { clock } from "./clock.js";
import { blockedReason, exitsOf, type Exit } from "./exits.js";
import { arrivalPassage } from "./rooms.js";
import { isPlace, move, placeOf, thingFor } from "./things.js";

/** How {@link journey} defines a journey. */
export type JourneyOptions = {
  /**
   * What stops it partway, given the ID of the fuse or daemon that asks:
   * `(by) => by === bomb.id`. Anything that interrupts stops it, unless it says.
   */
  readonly stopsFor?: (by: string) => boolean;
  /**
   * Where a stopped journey leaves the player, such as a tunnel: the story
   * goes on to its room's passage. Without it, they're back where they set
   * out, as if they never left.
   */
  readonly stopsAt?: ObjectRef;
};

const journeys = new Map<string, JourneyOptions>();

/**
 * Defines a journey, which exits name with `journey`. Call it in
 * `story.ts`, before the game starts.
 *
 * @example
 * ```ts
 * journey("subway", { stopsFor: (by) => by === bomb.id, stopsAt: tunnel });
 * connect(platform, { east: { to: downtown, minutes: 40, journey: "subway" } });
 * ```
 *
 * @throws StateError if another journey has the name, or `stopsAt` isn't a place.
 */
export function journey(name: string, options: JourneyOptions = {}): void {
  if (journeys.has(name)) {
    throw new NameTaken(
      `journey ${JSON.stringify(name)}: another journey has this name. Give each its own.`,
    );
  }
  if (options.stopsAt !== undefined && !isPlace(options.stopsAt)) {
    throw new StateError(
      `journey ${JSON.stringify(name)}: stopsAt ${JSON.stringify(options.stopsAt.id)} isn't a place. Define it with place().`,
    );
  }
  journeys.set(name, options);
}

/** The exit `way` from where the player is, if there is one. */
function exitFromHere(way: string): Exit | undefined {
  const body = currentPlayerBody();
  const here = body ? placeOf(body) : undefined;
  return here ? exitsOf(here).find((e) => e.direction.name === way) : undefined;
}

/** The journey an exit names, checking it's defined. */
function journeyOf(exit: Exit): JourneyOptions {
  const j = exit.journey === undefined ? undefined : journeys.get(exit.journey);
  if (!j) {
    throw new StateError(
      `the ${exit.direction.name} exit names the journey ${JSON.stringify(exit.journey)}, which isn't defined. Define it with journey() in story.ts.`,
    );
  }
  return j;
}

/** Goes on to the room passage for `place`, moving the player there. */
function arriveAt(place: ObjectRef): void {
  const passage = arrivalPassage(place);
  if (passage === undefined) {
    throw new StateError(
      `a journey leads to ${JSON.stringify(place.id)}, which no passage describes. Tag one [room: …] for it.`,
    );
  }
  const body = currentPlayerBody();
  if (body) move(body, place);
  redirect(passage);
}

/** Takes a journey exit, which can be stopped partway. @internal */
export const takeJourney = action<{ readonly way: string }>("world:journey", {
  source: "@loominate-if/world",
  label: ({ way }) => message("direction.label", { direction: way }),
  verify: ({ way }) => (exitFromHere(way) ? undefined : `There's no way ${way} from here.`),
  check: ({ way, body }) => {
    const exit = exitFromHere(way);
    return exit && body ? blockedReason(exit, body) : undefined;
  },
  run: ({ way }) => {
    const exit = exitFromHere(way);
    if (!exit) return;
    const j = journeyOf(exit);
    const advanced = clock.advance(exit.minutes ?? clock.travelMinutes, {
      ...(j.stopsFor && { stopsFor: j.stopsFor }),
    });
    if (!advanced.interrupted) arriveAt(exit.to);
    else if (j.stopsAt) arriveAt(thingFor(j.stopsAt) as ObjectRef);
    // Otherwise they're back where they set out: no move, and the page shows what stopped them.
  },
});

/** The guard of a journey exit's link: the journey, taken as an action. @internal */
export function journeyLink(way: string): LinkGuard {
  return actLink({ call: takeJourney({ way }) });
}
