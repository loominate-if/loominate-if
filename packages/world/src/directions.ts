/**
 * Directions: a registry, not a fixed eight (#64, ADR 0034).
 *
 * The compass points, up, down, in, and out are built in. A game adds its
 * own, such as a ship's fore and aft, with {@link direction} and by
 * extending the {@link Directions} interface, so exits naming a direction
 * nobody registered are a type error.
 */
import { StateError } from "@loominate-if/core";

/**
 * The directions exits can use, by name.
 *
 * @remarks
 * Extend this interface to add directions, using declaration merging, and
 * register each with {@link direction}:
 *
 * ```ts
 * declare module "@loominate-if/world" {
 *   interface Directions {
 *     fore: true;
 *     aft: true;
 *   }
 * }
 * direction("fore", { opposite: "aft" });
 * direction("aft", { opposite: "fore" });
 * ```
 */
export interface Directions {
  /** North. */
  north: true;
  /** Northeast. */
  northeast: true;
  /** East. */
  east: true;
  /** Southeast. */
  southeast: true;
  /** South. */
  south: true;
  /** Southwest. */
  southwest: true;
  /** West. */
  west: true;
  /** Northwest. */
  northwest: true;
  /** Up. */
  up: true;
  /** Down. */
  down: true;
  /** In. */
  in: true;
  /** Out. */
  out: true;
}

/** A direction's name, such as `north` or a game's own `fore`. */
export type DirectionName = keyof Directions & string;

/** What {@link direction} registers. */
export type DirectionOptions = {
  /** What the player sees, such as "North". Defaults to the name, capitalized. */
  readonly label?: string;
  /** The direction that leads back, such as `south` for `north`. */
  readonly opposite?: DirectionName;
  /**
   * How to say going this way, as in "Mira leaves to the north". Defaults to
   * "to the " and the name.
   */
  readonly toward?: string;
  /**
   * How to say coming from this way, as in "Mira arrives from the north" or
   * "You hear a door slam from above". Defaults to "from the " and the name.
   */
  readonly from?: string;
};

/** A registered direction. */
export type Direction = {
  /** Its name. */
  readonly name: DirectionName;
  /** What the player sees. */
  readonly label: string;
  /** The direction that leads back, if it has one. */
  readonly opposite?: DirectionName;
  /** How to say going this way: "to the north", "upstairs". */
  readonly toward: string;
  /** How to say coming from this way: "from the north", "from above". */
  readonly from: string;
};

/** Registered directions, in the order they were registered, which is the order exits are listed in. */
const registry = new Map<string, Direction>();

/**
 * Registers a direction exits can use. Directions are listed in the order
 * they're registered, after the built-in ones.
 *
 * @throws StateError if the direction is already registered.
 */
export function direction(name: DirectionName, options: DirectionOptions = {}): Direction {
  if (registry.has(name)) {
    throw new StateError(`direction ${JSON.stringify(name)} is already registered.`);
  }
  const d: Direction = {
    name,
    label: options.label ?? name.charAt(0).toUpperCase() + name.slice(1),
    ...(options.opposite !== undefined && { opposite: options.opposite }),
    toward: options.toward ?? `to the ${name}`,
    from: options.from ?? `from the ${name}`,
  };
  registry.set(name, d);
  return d;
}

const pairs: [DirectionName, DirectionName][] = [
  ["north", "south"],
  ["northeast", "southwest"],
  ["east", "west"],
  ["southeast", "northwest"],
  ["south", "north"],
  ["southwest", "northeast"],
  ["west", "east"],
  ["northwest", "southeast"],
  ["up", "down"],
  ["down", "up"],
  ["in", "out"],
  ["out", "in"],
];
/** How to say the ways that aren't compass points. */
const phrases: Partial<Record<DirectionName, { toward: string; from: string }>> = {
  up: { toward: "upstairs", from: "from above" },
  down: { toward: "downstairs", from: "from below" },
  in: { toward: "inside", from: "from inside" },
  out: { toward: "outside", from: "from outside" },
};
for (const [name, opposite] of pairs) direction(name, { opposite, ...phrases[name] });

/** The direction named `name`, if it's registered. */
export function directionNamed(name: string): Direction | undefined {
  return registry.get(name);
}

/** Every registered direction, in order. */
export function directions(): Direction[] {
  return [...registry.values()];
}
