/**
 * Knowledge sharing between the player and their companions (#124, ADR
 * 0101). Knowledge is each mind's own; a policy, the game's or a
 * companion's, says how it's shared: on reunion (the default), whenever
 * they're together, everything; while together, only what's learned while
 * they are; or only in conversation. A companion who knows facts the player
 * doesn't has a topic, "what they found", that tells them.
 */
import {
  _storyRunning,
  hook,
  message,
  messages,
  object,
  StateError,
  t,
  type ObjectRef,
} from "@loominate-if/core";
import { bodyOf, currentPlayerBody, currentPlayerMind, mindFor } from "./actors.js";
import {
  _companionMinds,
  _policyOf,
  _whenCompanionMade,
  type SharingPolicy,
} from "./companions.js";
import { _seenBy, _whenNoticed, type Fact, type MindKnowledge } from "./knowledge.js";
import { placeOf, thingFor } from "./things.js";
import { topic, topics } from "./topics.js";

declare module "@loominate-if/core" {
  interface Messages {
    /** A companion asked what they found, when they've nothing new: "“Nothing you don't know.”" */
    "companions.nothingFound": { readonly companion: ObjectRef };
  }
}
const SOURCE = "@loominate-if/world";
messages.register(
  "companions.nothingFound",
  ({ companion }) => t`“Nothing you don't know,” {the subj companion} {says}.`({ companion }),
  { source: SOURCE },
);

/** The game's policy, set as it loads. */
let policy: SharingPolicy = "reunion";

/**
 * Sets how the player and their companions share what they know, in
 * `story.ts`: `reunion` (the default), `together`, or `conversation`. A
 * companion's own `shares` overrides it.
 *
 * @throws StateError during play, or for a policy that isn't one of these.
 */
export function knowledgeSharing(to: SharingPolicy): void {
  if (_storyRunning()) {
    throw new StateError(
      "knowledgeSharing: set how knowledge is shared in story.ts, as the game loads.",
    );
  }
  if (!["reunion", "together", "conversation"].includes(to)) {
    throw new StateError(
      `knowledgeSharing: the policy is "reunion", "together", or "conversation", not ${JSON.stringify(to)}.`,
    );
  }
  policy = to;
}

/** A companion's policy: their own, or the game's. */
const policyOf = (mind: string): SharingPolicy => _policyOf(mind) ?? policy;

const state = object("world:sharing", {
  /**
   * For each companion, by mind ID, what the player or they learned or saw
   * while apart, as `fact:` or `thing:` and its ID: a `together` policy
   * doesn't share it.
   */
  apart: {} as Record<string, string[]>,
});

const together = (mind: string): boolean => {
  const player = currentPlayerBody();
  const body = bodyOf({ id: mind });
  return player !== undefined && body !== undefined && placeOf(body)?.id === placeOf(player)?.id;
};

// What either learns while apart from a companion is noted, for `together`.
_whenNoticed((m, kind, id) => {
  if (!_storyRunning()) return;
  const player = currentPlayerMind();
  // An actor's knowledge is reached through its body: the mind is what counts.
  const who = mindFor(m, "sharing").id;
  for (const mind of _companionMinds()) {
    if (policyOf(mind) !== "together") continue;
    if (who !== mind && who !== player?.id) continue;
    if (together(mind)) continue;
    const key = `${kind}:${id}`;
    const list = state.apart[mind] ?? [];
    if (!list.includes(key)) state.apart = { ...state.apart, [mind]: [...list, key] };
  }
});

/** Shares what `from` knows with `to`, but what's in `except`: facts, sourced to `source`, and things seen, as known of. */
function share(
  from: ObjectRef,
  to: MindKnowledge,
  source: ObjectRef,
  except: readonly string[],
): void {
  const knower = mindFor(from, "share");
  for (const f of knower.knownFacts()) {
    if (!to.knows(f) && !except.includes(`fact:${f.id}`)) to.learn(f, { from: source });
  }
  for (const id of _seenBy(knower)) {
    const thing = thingFor({ id });
    if (thing && !except.includes(`thing:${id}`) && !to.knowsAbout(thing)) to.learnAbout(thing);
  }
}

// After each move, the player and the companions they're with share what they know, by policy.
hook("turnEnd").rule(
  "companions share what they know",
  () => {
    const player = currentPlayerMind();
    const me = currentPlayerBody();
    if (!player || !me) return;
    for (const mind of _companionMinds()) {
      const kind = policyOf(mind);
      const body = bodyOf({ id: mind });
      if (kind === "conversation" || !body || !together(mind)) continue;
      const except = kind === "together" ? (state.apart[mind] ?? []) : [];
      share({ id: mind }, player, body, except);
      share(player, mindFor({ id: mind }, "share"), me, except);
    }
  },
  { source: SOURCE, after: "npc turns" },
);

/** The facts a companion knows that the player doesn't. */
const unknownTo = (mind: string): Fact[] => {
  const player = currentPlayerMind();
  return player
    ? mindFor({ id: mind }, "found")
        .knownFacts()
        .filter((f) => !player.knows(f))
    : [];
};

/** What a companion is asked about, to tell what they've found that the player doesn't know. */
export const { found } = topics({ found: "what they found" });

// Each companion can be asked what they found: they tell the facts the player doesn't know.
_whenCompanionMade((npc) => {
  const mind = mindFor(npc, "companion").id;
  topic(npc, {
    ask: found,
    when: () => unknownTo(mind).length > 0,
    says: ({ npc: body }) => {
      const facts = unknownTo(mind);
      const player = currentPlayerMind();
      for (const f of facts) player?.learn(f, { from: body });
      return facts.map((f) => `“${f.text}”`).join(" ");
    },
  });
  topic(npc, {
    ask: found,
    suggested: false,
    says: ({ npc: body }) => message("companions.nothingFound", { companion: body }),
  });
});
