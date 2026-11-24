/**
 * The world model's part in actions (#76, ADR 0044): who acts, and what
 * every action needs, as rules on core's `everyAction` rulebooks.
 *
 * The player's mind acts, through its body, so actions record both. An
 * action needs a body to act with, and its things in reach; otherwise it
 * isn't offered.
 */
import {
  _storyRunning,
  everyAction,
  message,
  messages,
  StateError,
  t,
  useActor,
  useCandidates,
  type Action,
  type ObjectRef,
} from "@loominate-if/core";
import { currentPlayerBody, currentPlayerMind } from "./actors.js";
import { canReach, inScope } from "./scope.js";
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

// Menus fill actions' other things from what the player can reach.
useCandidates(() => {
  const body = currentPlayerBody();
  return body ? inScope(body, "reach") : [];
});

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

/** Things that don't need to be in reach, by action name: what's talked about, or to. */
const unreached = new Map<string, ReadonlySet<string>>();

/**
 * Says an action's things, by name, needn't be in the actor's reach, as
 * what the player asks someone about, which can be anywhere. Every action's
 * things must be in reach otherwise, or it isn't offered. The action checks
 * them itself, if it needs to. Call it in `story.ts`.
 *
 * @example
 * ```ts
 * export const thinkAbout = action<{ thing: ObjectRef }>("thinkAbout", {
 *   verbs: ["think about {thing}"],
 *   report: ({ thing }) => t`You think about {the thing}.`({ thing }),
 * });
 * reachNotNeeded(thinkAbout, "thing");
 * ```
 *
 * @throws StateError during play, or if no thing is named.
 */
export function reachNotNeeded<A>(
  action: Action<A>,
  ...things: readonly (keyof A & string)[]
): void {
  if (_storyRunning()) {
    throw new StateError(
      `reachNotNeeded ${JSON.stringify(action.actionName)}: say which things needn't be in reach in story.ts, as the game loads.`,
    );
  }
  if (things.length === 0) {
    throw new StateError(
      `reachNotNeeded ${JSON.stringify(action.actionName)}: name the things that needn't be in reach, as reachNotNeeded(${action.actionName}, "thing").`,
    );
  }
  unreached.set(
    action.actionName,
    new Set([...(unreached.get(action.actionName) ?? []), ...things]),
  );
}

everyAction.verify.rule(
  "things in reach",
  (c) => {
    if (c.body === undefined) return undefined;
    const skip = unreached.get(c.action);
    for (const [key, value] of Object.entries(c)) {
      if (key === "actor" || key === "body" || key === "action" || skip?.has(key)) continue;
      const thing =
        typeof value === "object" && value !== null ? thingFor(value as ObjectRef) : undefined;
      if (thing && !canReach(c.body, thing)) return message("action.outOfReach", { thing });
    }
    return undefined;
  },
  { source: SOURCE, after: "needs a body" },
);
