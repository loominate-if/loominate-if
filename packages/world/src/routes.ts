/**
 * Routes (#137, ADR 0111): a patrol, built on paced turns. A simulated NPC
 * walks to each place in turn, one step a turn through `go`, so a locked or
 * closed door stops them as it would anyone, and with `loop` goes round
 * again.
 */
import { object, StateError, type ObjectRef } from "@loominate-if/core";
import { mindFor } from "./actors.js";
import { stepToward } from "./agendas.js";
import { everyTurn, simulate, type Pacing } from "./npcs.js";
import { placeOf } from "./things.js";

/** Options for {@link route}. */
export type RouteOptions = Pacing & {
  /** Whether they go round again from the first place after the last. Otherwise they stay at the last. */
  readonly loop?: boolean;
};

/**
 * Sends an NPC round a route, in `story.ts`: they're simulated, with a turn
 * every so often on the game clock, and in each they take a step toward the
 * next place on it, through `go`. Once there, they head for the one after,
 * and with `loop`, after the last, the first again. Where they are on it is
 * game state.
 *
 * @example
 * ```ts
 * route(guard, [gatehouse, yard, wall], { every: minutes(5), loop: true });
 * ```
 *
 * @throws StateError if the route is empty, or the NPC is already paced.
 */
export function route(npc: ObjectRef, places: readonly ObjectRef[], options: RouteOptions): void {
  const mind = mindFor(npc, "route");
  if (places.length === 0) {
    throw new StateError(`route: ${JSON.stringify(mind.id)}'s route needs at least one place.`);
  }
  const at = object(`world:route:${mind.id}`, { next: 0 });
  simulate(npc, {
    every: options.every,
    ...(options.summary !== undefined && { summary: options.summary }),
  });
  /** The place after `i` on the route, or the end of it. */
  const after = (i: number): number =>
    i + 1 < places.length ? i + 1 : options.loop === true ? 0 : places.length;
  everyTurn(npc, "follows their route", ({ npc: who, body }) => {
    // Places they're already at are passed, once round at most, so each turn takes a step if one's left.
    for (let tried = 0; tried < places.length; tried++) {
      const target = places[at.next];
      if (!target) return;
      if (placeOf(body)?.id === target.id) {
        at.next = after(at.next);
        continue;
      }
      if (stepToward(who, target)) at.next = after(at.next);
      return;
    }
  });
}
