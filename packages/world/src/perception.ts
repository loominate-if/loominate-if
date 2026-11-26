/**
 * Perception: what the player and other minds notice (#69, ADR 0037).
 *
 * Something that happens is seen by those who can see it, heard by those who
 * can hear it, and, if it's loud, heard from rooms a few exits away, with the
 * way it came. The player's mind is told, as `perception` events the page
 * shows after the passage text; every mind that notices can learn a fact from it.
 * Actors coming into and leaving the player's sight are narrated the same
 * way, without the author asking.
 */
import { emit, message, StateError, type ObjectRef } from "@loominate-if/core";
import { allBodies, currentPlayerBody, currentPlayerMind, isBody, mindsIn } from "./actors.js";
import { type Direction } from "./directions.js";
import { connectedRooms, exitsOf } from "./exits.js";
import { _lostSight, type Fact } from "./knowledge.js";
import { canHear, canSee, isInLight } from "./scope.js";
import { isWithin, onMove, placeOf, thingFor, type Place, type Thing } from "./things.js";

/** What {@link happen} tells those who notice. */
export type HappenOptions = {
  /** What those who can see it notice, such as "The cellar door slams shut." */
  readonly seen?: string;
  /**
   * What those who can hear it but not see it notice, such as "A door slams
   * nearby." Without it, only those who can see it notice.
   */
  readonly heard?: string;
  /**
   * What it sounds like from rooms up to {@link HappenOptions.carries} exits
   * away: text, or a function of the way the sound came, which is given a
   * direction's `from`, such as "from above", and returns the text.
   */
  readonly far?: string | ((from: string, way: Direction) => string);
  /** How many exits away it's heard, with {@link HappenOptions.far}. Defaults to 1. */
  readonly carries?: number;
  /** A fact every mind that notices it learns, sourced to the thing it happened to. */
  readonly reveals?: Fact;
};

/** How one body noticed something. */
type Noticed = { readonly sense: "see" | "hear"; readonly text: string };

/**
 * The rooms within `carries` exits of `room`, each with the exit it has
 * toward `room`, nearest first. A room is reached through an exit it has, so
 * one-way exits carry sound only the way they lead.
 */
function within(room: Place, carries: number): Map<string, Direction> {
  const reached = new Map<string, Direction>();
  let frontier = new Set([room.id]);
  const rooms = connectedRooms();
  for (let d = 0; d < carries && frontier.size > 0; d++) {
    const next = new Set<string>();
    for (const r of rooms) {
      if (r.id === room.id || reached.has(r.id)) continue;
      const exit = exitsOf(r).find((e) => frontier.has(e.to.id));
      if (exit) {
        reached.set(r.id, exit.direction);
        next.add(r.id);
      }
    }
    frontier = next;
  }
  return reached;
}

/**
 * Makes something perceptible: everyone who can see `source` notices
 * `seen`, everyone who can only hear it notices `heard`, and, with `far`,
 * everyone in a room up to `carries` exits away hears it from there. The
 * player is told; every mind that notices learns `reveals`, if it's given.
 *
 * @example
 * ```ts
 * happen(cellarDoor, {
 *   seen: "The cellar door slams shut.",
 *   heard: "A door slams.",
 *   far: (from) => `You hear a door slam ${from}.`,
 * });
 * ```
 *
 * @throws StateError if `source` isn't a thing, or `carries` isn't a whole number, 0 or more.
 */
export function happen(source: ObjectRef, options: HappenOptions): void {
  const where = `happen ${JSON.stringify(source.id)}`;
  const thing = thingFor(source);
  if (!thing) throw new StateError(`${where}: it isn't defined with thing() or place().`);
  const carries = options.carries ?? 1;
  if (!Number.isInteger(carries) || carries < 0) {
    throw new StateError(`${where}: carries must be a whole number of exits, 0 or more.`);
  }
  const room = placeOf(thing);
  const far = options.far !== undefined && room ? within(room, carries) : new Map();
  for (const body of allBodies()) {
    const noticed = notices(body, thing, options, far);
    if (noticed) tell(body, thing, noticed, options.reveals);
  }
}

/** How `body` notices what happens to `source`, if it does. */
function notices(
  body: Thing,
  source: Thing,
  options: HappenOptions,
  far: Map<string, Direction>,
): Noticed | undefined {
  if (options.seen !== undefined && canSee(body, source)) {
    return { sense: "see", text: options.seen };
  }
  if (canHear(body, source)) {
    if (options.heard !== undefined) return { sense: "hear", text: options.heard };
    return undefined;
  }
  const at = placeOf(body);
  const way = at ? far.get(at.id) : undefined;
  if (!way || options.far === undefined) return undefined;
  const text =
    typeof options.far === "string"
      ? options.far
      : options.far(message("direction.from", { direction: way.name }), way);
  return { sense: "hear", text };
}

/** What the player was told while it's being caught, or `undefined` while it isn't. */
let caught: string[] | undefined;

/**
 * Runs `fn`, catching what the player would be told by what they perceive,
 * and returns it as lines instead, as a paced NPC's turn does to say it as
 * its timer's line (#137). Everything else perceiving does still happens:
 * minds see and learn. @internal
 */
export function _catchPerceived(fn: () => void): string[] {
  const outer = caught;
  const lines: string[] = [];
  caught = lines;
  try {
    fn();
  } finally {
    caught = outer;
  }
  return lines;
}

/** Tells the player what they perceived, or catches it. */
function perceived(text: string, sense: "see" | "hear", source: string): void {
  if (caught) caught.push(text);
  else emit("perception", { text, sense, source });
}

/** Tells the minds in `body` what they noticed: the player is narrated to, and all may learn. */
function tell(body: Thing, source: Thing, noticed: Noticed, reveals: Fact | undefined): void {
  const playing = currentPlayerMind();
  for (const m of mindsIn(body)) {
    if (noticed.sense === "see") m.see(source);
    if (reveals) m.learn(reveals, { from: source });
    if (m.id === playing?.id) {
      perceived(noticed.text, noticed.sense, source.id);
    }
  }
}

/** What a body may say about its own comings and goings, in place of the defaults. */
type Narrated = {
  name: string;
  arrives?: (from: string | undefined) => string | undefined;
  leaves?: (toward: string | undefined) => string | undefined;
};

// Narrates bodies coming into and leaving the player's sight.
onMove((moved, from) => {
  if (!isBody(moved)) return;
  const player = currentPlayerBody();
  if (!player || moved.id === player.id || isWithin(player, moved)) return;
  const here = placeOf(player);
  const to = placeOf(moved);
  if (!here || from?.id === to?.id) return;
  const self = moved as Thing & Narrated;
  if (from?.id === here.id && isInLight(player)) {
    // The player watched them go, and doesn't know where to (#396).
    _lostSight(moved, mindsIn(player));
    // A hidden way isn't named, so it isn't given away (#431).
    const d = to
      ? exitsOf(here).find((e) => e.to.id === to.id && e.hidden !== true)?.direction
      : undefined;
    const way = d ? message("direction.toward", { direction: d.name }) : undefined;
    const text = self.leaves
      ? self.leaves(way)
      : message("actor.leaves", { actor: moved, ...(way !== undefined && { toward: way }) });
    if (text) perceived(text, "see", moved.id);
  } else if (to?.id === here.id) {
    // Everyone here who can see the newcomer sees it, and the player is told.
    for (const b of allBodies()) {
      if (b.id !== moved.id && canSee(b, moved)) for (const m of mindsIn(b)) m.see(moved);
    }
    if (!canSee(player, moved)) return;
    const d = from
      ? exitsOf(here).find((e) => e.to.id === from.id && e.hidden !== true)?.direction
      : undefined;
    const way = d ? message("direction.from", { direction: d.name }) : undefined;
    const text = self.arrives
      ? self.arrives(way)
      : message("actor.arrives", { actor: moved, ...(way !== undefined && { from: way }) });
    if (text) perceived(text, "see", moved.id);
  }
});
