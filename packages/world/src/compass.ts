/**
 * The world model's compass (#81, ADR 0063): presentation's compass,
 * showing the ways out of the player's room, with locked and closed ways
 * disabled with their door's reason, and taking them as the `{exits}`
 * links do. A game places it, as with `addToHeader("compass")`.
 */
import { message, messages } from "@loominate-if/core";
import {
  compassWidget,
  widgets,
  type CompassWay,
  type WidgetDefinition,
  type CompassData,
  type WidgetHost,
} from "@loominate-if/presentation";
import { currentPlayerBody } from "./actors.js";
import { blockedReason, exitsOf, type Exit } from "./exits.js";
import { takeJourney } from "./journeys.js";
import { arrivalPassage, visitsTo } from "./rooms.js";
import { placeOf } from "./things.js";

declare module "@loominate-if/core" {
  interface Messages {
    /** A way's short label on the compass: "N", "NE", "Up". */
    "compass.short": { readonly direction: string };
  }
}

const SHORT: Readonly<Record<string, string>> = {
  north: "N",
  northeast: "NE",
  east: "E",
  southeast: "SE",
  south: "S",
  southwest: "SW",
  west: "W",
  northwest: "NW",
};
messages.register(
  "compass.short",
  ({ direction }) => SHORT[direction] ?? message("direction.label", { direction }),
  { source: "@loominate-if/world" },
);

/** How the world model's compass shows ways, for {@link compass}. */
export type CompassSettings = {
  /**
   * Which ways name where they lead: `"visited"` (the default) once the
   * player has been there, `"all"`, or `"none"`.
   */
  readonly names?: "visited" | "all" | "none";
  /** Which keys take a way: `"numpad"` (the default), `"vi"`, `"both"`, or `"none"`. */
  readonly keys?: "numpad" | "vi" | "both" | "none";
};

/** The exits out of the player's room, if they're in one. */
const exitsHere = (): readonly Exit[] => {
  const body = currentPlayerBody();
  const here = body ? placeOf(body) : undefined;
  // A hidden exit isn't a way the player knows of (#431).
  return here ? exitsOf(here).filter((e) => e.hidden !== true) : [];
};

/**
 * A compass widget showing the ways out of the player's room. The world
 * model registers one as `compass`, with the defaults; replace it to change
 * them, as `widgets.replace("compass", compass({ keys: "vi" }))`, and place
 * it with `addToHeader("compass")` or in a layout of your own.
 */
export function compass(settings: CompassSettings = {}): WidgetDefinition<CompassData> {
  const names = settings.names ?? "visited";
  return compassWidget({
    ...(settings.keys !== undefined && { keys: settings.keys }),
    ways: () => _compassWays(names),
    take: _takeWay,
  });
}

/** The ways out of the player's room, as the compass shows them. @internal */
export function _compassWays(names: "visited" | "all" | "none" = "visited"): CompassWay[] {
  const body = currentPlayerBody();
  return exitsHere().map((e): CompassWay => {
    const direction = e.direction.name;
    const named = names === "all" || (names === "visited" && visitsTo(e.to) > 0);
    const title = message("exit.label", {
      direction: message("direction.label", { direction }),
      room: e.to,
      visited: named,
    });
    const reason = body ? blockedReason(e, body) : undefined;
    return {
      direction,
      label: message("compass.short", { direction }),
      title,
      available: reason === undefined && arrivalPassage(e.to) !== undefined,
      ...(reason !== undefined && { reason }),
    };
  });
}

/**
 * Takes the way in `direction` through the page, as the `{exits}` links
 * do: a journey as its action, anything else as a move to its room's
 * passage. @internal
 */
export function _takeWay(host: WidgetHost, direction: string): void {
  const exit = exitsHere().find((e) => e.direction.name === direction);
  if (!exit) return;
  const label = message("direction.label", { direction });
  if (exit.journey !== undefined) {
    host.act(takeJourney({ way: direction }), label);
    return;
  }
  const passage = arrivalPassage(exit.to);
  if (passage !== undefined) host.goTo(passage, label);
}

widgets.register("compass", compass(), { source: "@loominate-if/world" });
