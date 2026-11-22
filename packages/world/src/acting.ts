/**
 * The world model's part in actions (#76, ADR 0044): who acts, and what
 * every action needs, as rules on core's `everyAction` rulebooks.
 *
 * The player's mind acts, through its body, so actions record both. An
 * action needs a body to act with, and its things in reach; otherwise it
 * isn't offered.
 */
import { everyAction, message, messages, t, useActor, type ObjectRef } from "@loominate-if/core";
import { currentPlayerBody, currentPlayerMind } from "./actors.js";
import { canReach } from "./scope.js";
import { thingFor } from "./things.js";

declare module "@loominate-if/core" {
  interface Messages {
    /** Why an action isn't offered when the player's mind has no body. */
    "action.noBody": Record<never, never>;
    /** Why an action isn't offered when one of its things is out of reach. */
    "action.outOfReach": { readonly thing: ObjectRef };
  }
}

const SOURCE = "@loominate-if/world";
messages.register("action.noBody", "You have no body to act with.", { source: SOURCE });
messages.register("action.outOfReach", t`{The subj thing} {is} out of reach.`, { source: SOURCE });

// The player's mind acts, through its body.
useActor(() => {
  const mind = currentPlayerMind();
  if (!mind) return undefined;
  const body = currentPlayerBody();
  return { actor: mind, ...(body && { body }) };
});

everyAction.verify.rule(
  "needs a body",
  (c) => (c.actor !== undefined && c.body === undefined ? message("action.noBody") : undefined),
  { source: SOURCE },
);

everyAction.verify.rule(
  "things in reach",
  (c) => {
    if (c.body === undefined) return undefined;
    for (const [key, value] of Object.entries(c)) {
      if (key === "actor" || key === "body" || key === "action") continue;
      const thing =
        typeof value === "object" && value !== null ? thingFor(value as ObjectRef) : undefined;
      if (thing && !canReach(c.body, thing)) return message("action.outOfReach", { thing });
    }
    return undefined;
  },
  { source: SOURCE, after: "needs a body" },
);
