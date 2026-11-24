/**
 * Switching the player character (#125, ADR 0102): the player can control
 * another mind during play. Narration follows whoever they control, who is
 * "you"; the one they leave is an ordinary NPC again, spoken of by name.
 * `switchTo` moves the story to the room of the one now played; for games
 * that let the player switch freely, `takeControl` does it as a move.
 */
import {
  _storyRunning,
  action,
  emit,
  message,
  messages,
  redirect,
  StateError,
  t,
  type ObjectRef,
} from "@loominate-if/core";
import { reachNotNeeded } from "./acting.js";
import { bodyOf, currentPlayerBody, isBody, mindFor, mindOf, playAs } from "./actors.js";
import { conversation, endConversation } from "./conversations.js";
import { arrivalPassage } from "./rooms.js";
import { placeOf, type Thing } from "./things.js";

declare module "@loominate-if/core" {
  interface Messages {
    /** Switching to another character: "You are Mira now." `who` is their body, before the switch. */
    "switch.done": { readonly who: ObjectRef };
    /** Playing as someone, as a menu offers it: "Play as Mira". */
    "switch.label": { readonly who: ObjectRef };
    /** Why switching isn't offered: they aren't one the player can play. */
    "switch.notPlayable": { readonly who: ObjectRef };
    /** Why switching isn't offered: the player is them already. */
    "switch.already": Record<never, never>;
  }
}
const SOURCE = "@loominate-if/world";
messages.register("switch.done", ({ who }) => t`You are {the who} now.`({ who }), {
  source: SOURCE,
});
messages.register("switch.label", ({ who }) => t`Play as {the who}`({ who }), { source: SOURCE });
messages.register("switch.notPlayable", ({ who }) => t`You can't play as {the who}.`({ who }), {
  source: SOURCE,
});
messages.register("switch.already", () => "You're playing as them already.", { source: SOURCE });

/** The minds the player may switch to freely, by ID, as `playable` names them. */
const playables = new Set<string>();

/**
 * Says the player may switch to this character freely, with `takeControl`,
 * in `story.ts`. `switchTo` can switch to anyone, from code.
 *
 * @throws StateError during play.
 */
export function playable(npc: ObjectRef): void {
  const mind = mindFor(npc, "playable").id;
  if (_storyRunning()) {
    throw new StateError(
      `playable ${JSON.stringify(mind)}: say who's playable in story.ts, as the game loads.`,
    );
  }
  playables.add(mind);
}

/** Whether the player may switch to this character with `takeControl`. */
export function isPlayable(npc: ObjectRef): boolean {
  return playables.has(mindFor(npc, "isPlayable").id);
}

/**
 * Switches the player to another character, during a move, as in a passage
 * effect or an action: "You are Mira now.", and the story goes to the
 * passage of the room they're in. A conversation the player was in ends.
 * The character they leave is an ordinary NPC again, spoken of by their
 * body's name, so that needs to be a real name, not "you".
 *
 * @throws StateError if the body the player leaves is named "you", or the new character has no body.
 */
export function switchTo(npc: ObjectRef): void {
  const mind = mindFor(npc, "switchTo");
  const body = bodyOf(mind);
  if (!body) {
    throw new StateError(`switchTo ${JSON.stringify(mind.id)}: they have no body to play.`);
  }
  const leaving = currentPlayerBody();
  if (leaving?.id === body.id) return;
  if (leaving && /^you$/i.test((leaving as Thing).name)) {
    throw new StateError(
      `switchTo ${JSON.stringify(mind.id)}: the body the player leaves, ${JSON.stringify(leaving.id)}, is named "you", which it can't be once someone else is played. Give it a name, as actor("${leaving.id}", { body: { name: "Alex", … } }); the grammar still says "you" while it's played.`,
    );
  }
  // Said before the switch, while they're still someone else.
  const said = message("switch.done", { who: body });
  if (conversation.active) endConversation();
  playAs(mind);
  emit("action-result", { text: said }, ["lead", "switch"]);
  const here = placeOf(body);
  const passage = here ? arrivalPassage(here) : undefined;
  if (passage !== undefined) redirect(passage);
}

/**
 * Takes control of a playable character, as a move: "Play as Mira". It's on
 * their menu while they're here, and a passage's act link can offer it anywhere.
 */
export const takeControl = action<{ thing: ObjectRef }>("takeControl", {
  source: SOURCE,
  // Any thing can be asked: only a body with a playable mind, not the one played, is offered it.
  for: (t) => {
    const mind = isBody(t) ? mindOf(t) : undefined;
    return mind !== undefined && playables.has(mind.id) && t.id !== currentPlayerBody()?.id;
  },
  label: ({ thing }) => message("switch.label", { who: thing }),
  verify: ({ thing }) => {
    if (thing.id === currentPlayerBody()?.id) return message("switch.already", {});
    return isPlayable(thing) ? undefined : message("switch.notPlayable", { who: thing });
  },
  run: ({ thing }) => {
    switchTo(thing);
  },
});
reachNotNeeded(takeControl, "thing");
