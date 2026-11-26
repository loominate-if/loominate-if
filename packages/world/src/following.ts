/**
 * Following (#122, ADR 0099): the player can follow an NPC they saw leave,
 * the way they went, as TADS's follow command did. While the player is
 * where they saw someone go, `{exits}` offers "Follow the butler". Leaving
 * the room, or the NPC coming back, forgets the trail.
 */
import {
  actLink,
  action,
  emit,
  message,
  messages,
  object,
  perform,
  redirect,
  t,
  type LinkNode,
  type ObjectRef,
} from "@loominate-if/core";
import { reachNotNeeded } from "./acting.js";
import { currentPlayerBody, isBody } from "./actors.js";
import { _addExitLinks, blockedReason, exitsOf, type Exit } from "./exits.js";
import { takeJourney } from "./journeys.js";
import { arrivalPassage } from "./rooms.js";
import { isInLight } from "./scope.js";
import { onMove, placeOf, thingFor } from "./things.js";

declare module "@loominate-if/core" {
  interface Messages {
    /** Following someone, as a link `{exits}` offers: "Follow the butler". */
    "follow.label": { readonly who: ObjectRef };
    /** Setting off after them, before the new room: "You follow the butler west." */
    "follow.done": { readonly who: ObjectRef; readonly way: string };
    /** Why following isn't offered: the player didn't see where they went. */
    "follow.unknown": { readonly who: ObjectRef };
    /** Why following isn't offered: they're right here. */
    "follow.here": { readonly who: ObjectRef };
    /** Why the player can't follow themselves. */
    "follow.self": Record<never, never>;
  }
}
const SOURCE = "@loominate-if/world";
messages.register("follow.label", ({ who }) => t`Follow {the who}`({ who }), { source: SOURCE });
messages.register("follow.done", ({ who, way }) => t`You follow {the who} ${way}.`({ who }), {
  source: SOURCE,
});
messages.register("follow.unknown", ({ who }) => t`You don't know where {the who} went.`({ who }), {
  source: SOURCE,
});
messages.register("follow.here", ({ who }) => t`{The subj who} {is} right here.`({ who }), {
  source: SOURCE,
});
messages.register("follow.self", () => "You can't follow yourself.", { source: SOURCE });

const state = object("world:following", {
  /** Which way each body was seen going, from the player's room, by body ID. */
  trails: {} as Record<string, { readonly from: string; readonly way: string }>,
});

// The player sees someone leave: they remember which way. They leave, or the
// other comes back: they forget.
onMove((moved, from) => {
  const player = currentPlayerBody();
  if (!player) return;
  if (moved.id === player.id) {
    if (Object.keys(state.trails).length > 0) state.trails = {};
    return;
  }
  if (!isBody(moved)) return;
  const here = placeOf(player);
  const to = placeOf(moved);
  if (!here) return;
  if (to?.id === here.id && Object.hasOwn(state.trails, moved.id)) {
    const { [moved.id]: _back, ...rest } = state.trails;
    void _back;
    state.trails = rest;
    return;
  }
  if (from?.id !== here.id || !to || !isInLight(player)) return;
  const exit = exitsOf(here).find((e) => e.to.id === to.id);
  // Someone who takes a hidden way can't be followed: the player doesn't know it's there (#431).
  if (exit && exit.hidden !== true) {
    state.trails = { ...state.trails, [moved.id]: { from: here.id, way: exit.direction.name } };
  }
});

/** The exit the player saw `who` take from where the player is, if they did. */
function trailOf(who: ObjectRef): Exit | undefined {
  const player = currentPlayerBody();
  const here = player ? placeOf(player) : undefined;
  const trail = state.trails[who.id];
  if (!here || !trail || trail.from !== here.id) return undefined;
  return exitsOf(here).find((e) => e.direction.name === trail.way);
}

/**
 * Follows someone the player saw leave, the way they went: through the
 * exit's passage, as the exit link does, so companions come along and a
 * locked door stops it, with why. `{exits}` offers it while the trail is
 * known.
 */
export const follow = action<{ who: ObjectRef }>("follow", {
  source: SOURCE,
  verbs: ["follow {who}", "go after {who}", "chase {who}"],
  label: ({ who }) => message("follow.label", { who }),
  verify: ({ who, body }) => {
    if (body && who.id === body.id) return message("follow.self", {});
    if (body && placeOf(who)?.id === placeOf(body)?.id) return message("follow.here", { who });
    return trailOf(who) ? undefined : message("follow.unknown", { who });
  },
  check: ({ who, body }) => {
    const exit = trailOf(who);
    return exit && body ? blockedReason(exit, body) : undefined;
  },
  run: ({ who }) => {
    const exit = trailOf(who);
    if (!exit) return;
    emit("action-result", { text: message("follow.done", { who, way: exit.direction.name }) }, [
      "lead",
    ]);
    // A journey is taken as its action; any other way goes to its room's passage.
    if (exit.journey !== undefined) {
      perform(takeJourney({ way: exit.direction.name }));
      return;
    }
    const passage = arrivalPassage(exit.to);
    if (passage !== undefined) redirect(passage);
  },
});
// Who's followed has gone: they're out of reach by definition.
reachNotNeeded(follow, "who");

// While the player is where they saw someone go, `{exits}` offers to follow them.
_addExitLinks((): LinkNode[] =>
  Object.keys(state.trails).flatMap((id) => {
    const who = thingFor({ id });
    if (!who || !trailOf(who)) return [];
    const label = message("follow.label", { who });
    return [{ type: "link", label, target: label, guard: actLink({ call: follow({ who }) }) }];
  }),
);
