/**
 * NPCs act through the same pipeline as the player (#106, ADR 0081), so
 * locks, keys, reach, and a game's own rules apply to them equally. What
 * they do is narrated to the player only if the player sees it, in the
 * third person; a refusal is never narrated, but returned for code such as
 * an agenda to react to.
 */
import {
  action,
  message,
  messages,
  perform,
  StateError,
  t,
  type ActionCall,
  type ActionOutcome,
  type ObjectRef,
} from "@loominate-if/core";
import { bodyOf, currentPlayerBody, isBody, mindFor } from "./actors.js";
import { blockedReason, exitsOf, type Exit } from "./exits.js";
import { happen } from "./perception.js";
import { move, placeOf } from "./things.js";

declare module "@loominate-if/core" {
  interface Messages {
    /** Why `go` isn't taken: there's no way that way. */
    "go.noWay": { readonly way: string };
    /** Why `go` isn't taken by the player, who moves through the story's passages. */
    "go.player": Record<never, never>;
  }
}
const SOURCE = "@loominate-if/world";
messages.register("go.noWay", ({ way }) => `There's no way ${way} from here.`, { source: SOURCE });
messages.register(
  "go.player",
  t`The player moves through the story's passages and exits; go is for other characters.`,
  { source: SOURCE },
);

/**
 * Has `who`, an actor, mind, or body other than the player, take an action,
 * through every stage, as the player would: every rule applies to them.
 * If it's done, whoever can see them is told what onlookers see, as "The
 * butler unlocks the cellar door."; a refusal isn't narrated, but returned.
 * Their action takes none of the game's time.
 *
 * @example
 * ```ts
 * const tried = actAs(butler, unlock({ thing: cellarDoor }));
 * if (!tried.done) butler.isStuck = true; // tried.reason says why
 * ```
 *
 * @throws StateError if `who` has no body to act through, or is the player.
 */
// A call of any action: an action's type is invariant in its arguments, so no narrower type takes them all.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function actAs(who: ObjectRef, call: ActionCall<any>): ActionOutcome {
  const actor = mindFor(who, "actAs");
  const body = bodyOf(actor) ?? (isBody(who) ? who : undefined);
  if (!body) {
    throw new StateError(`actAs: ${JSON.stringify(who.id)} has no body to act through.`);
  }
  if (body.id === currentPlayerBody()?.id) {
    throw new StateError(
      `actAs: ${JSON.stringify(who.id)} is the player. The player acts through links and menus, or core's perform().`,
    );
  }
  const outcome = perform(call, { as: { actor, body } });
  if (outcome.done && outcome.seen !== undefined) happen(body, { seen: outcome.seen });
  return outcome;
}

/** The way out of where `body` is, by its direction's name, if there is one. */
const wayFrom = (body: ObjectRef, way: string): Exit | undefined => {
  const here = placeOf(body);
  return here ? exitsOf(here).find((e) => e.direction.name === way) : undefined;
};

/**
 * Goes through one of the room's exits, as an NPC does with
 * `actAs(butler, go({ way: "north" }))`. A locked or closed door stops them,
 * with why, as it would the player. Coming and going is narrated to whoever
 * sees it, as any actor's movement is. The player moves through the story's
 * passages and exits instead.
 */
export const go = action<{ way: string }>("go", {
  source: SOURCE,
  verbs: ["go {way}", "walk {way}", "head {way}"],
  verify: ({ way, body }) => {
    if (!body) return undefined;
    if (body.id === currentPlayerBody()?.id) return message("go.player");
    return wayFrom(body, way) ? undefined : message("go.noWay", { way });
  },
  check: ({ way, body }) => {
    const exit = body ? wayFrom(body, way) : undefined;
    return exit && body ? blockedReason(exit, body) : undefined;
  },
  run: ({ way, body }) => {
    const exit = body ? wayFrom(body, way) : undefined;
    if (exit && body) move(body, exit.to);
  },
});
