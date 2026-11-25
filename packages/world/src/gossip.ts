/**
 * NPCs telling each other what they know (#390, ADR 0110): through the
 * standard `tell` action, taken as an NPC with `actAs`, and by gossip,
 * facts defined with `spreads: true` passing by themselves between NPCs
 * together who get a turn. The player sees them talk, but doesn't learn
 * what was said.
 */
import { emit, hook, message, messages, object, t, type ObjectRef } from "@loominate-if/core";
import { allBodies, currentPlayerBody, mindFor, mindOf } from "./actors.js";
import { clock } from "./clock.js";
import { _allFacts, factNamed, type Fact } from "./knowledge.js";
import { getsTurn, playerPerceives } from "./npcs.js";
import { happen } from "./perception.js";
import { placeOf } from "./things.js";

declare module "@loominate-if/core" {
  interface Messages {
    /** One NPC telling another something, seen by the player: "Marta whispers something to Tobias." */
    "gossip.seen": { readonly teller: ObjectRef; readonly hearer: ObjectRef };
    /** Why an NPC doesn't tell another a fact they don't know. */
    "gossip.unknown": { readonly teller: ObjectRef };
    /** Why an NPC doesn't tell someone who isn't with them. */
    "gossip.apart": { readonly hearer: ObjectRef };
    /** Why an NPC doesn't tell another about something that isn't a fact. */
    "gossip.notFact": Record<never, never>;
  }
}
const SOURCE = "@loominate-if/world";
const register: typeof messages.register = (key, text, options) =>
  messages.register(key, text, options ?? { source: SOURCE });
register("gossip.seen", ({ teller, hearer }) =>
  t`{The subj teller} {whispers} something to {the hearer}.`({ teller, hearer }),
);
register("gossip.unknown", ({ teller }) => t`{The subj teller} {doesn't} know that.`({ teller }));
register("gossip.apart", ({ hearer }) => t`{The subj hearer} {isn't} there.`({ hearer }));
register("gossip.notFact", () => "NPCs tell each other facts.");

/** Which pairs were last seen talking, by pair, at which move: once a move each, kept in state for undo. */
const state = object("world:gossip", { narrated: {} as Record<string, number> });

const pairKey = (a: ObjectRef, b: ObjectRef): string =>
  a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;

/** What the player sees of `teller` telling `hearer`: once a move for each pair, or nothing. */
function seenTelling(teller: ObjectRef, hearer: ObjectRef): string {
  const key = pairKey(teller, hearer);
  if (state.narrated[key] === clock.moves) return "";
  state.narrated = { ...state.narrated, [key]: clock.moves };
  return message("gossip.seen", { teller, hearer });
}

/** The fact an NPC's `tell` is about, by the fact or its ID. */
const factIn = (about: ObjectRef | string): Fact | undefined =>
  typeof about === "string"
    ? factNamed(about)
    : factNamed((about as { readonly id?: string }).id ?? "");

/** Why `teller` can't tell `hearer` about `about`, or `undefined`. @internal */
export function _npcTellProblem(
  teller: ObjectRef,
  hearer: ObjectRef,
  about: ObjectRef | string,
): string | undefined {
  const fact = factIn(about);
  if (!fact) return message("gossip.notFact", {});
  if (!mindFor(teller, "tell").knows(fact)) return message("gossip.unknown", { teller });
  if (placeOf(hearer)?.id !== placeOf(teller)?.id) return message("gossip.apart", { hearer });
  return undefined;
}

/** An NPC telling another a fact: the hearer learns it, from the teller. @internal */
export function _npcTell(teller: ObjectRef, hearer: ObjectRef, about: ObjectRef | string): void {
  const fact = factIn(about);
  const mind = mindOf(hearer);
  if (fact && mind && !mind.knows(fact)) mind.learn(fact, { from: teller });
}

/** What the player sees of an NPC's `tell`, as the action's `seen`. @internal */
export function _npcTellSeen(teller: ObjectRef, hearer: ObjectRef): string {
  return seenTelling(teller, hearer);
}

// After each move, spreading facts pass between NPCs together who both get a turn.
hook("turnEnd").rule(
  "gossip",
  ({ move }) => {
    if (move === "continue") return;
    const spreading = _allFacts().filter((f) => f.spreads === true);
    if (spreading.length === 0) return;
    const player = currentPlayerBody();
    const talking = allBodies()
      .filter((b) => b.id !== player?.id && mindOf(b) !== undefined && getsTurn(b))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const [i, a] of talking.entries()) {
      for (const b of talking.slice(i + 1)) {
        const here = placeOf(a);
        if (!here || placeOf(b)?.id !== here.id) continue;
        const minds = [mindOf(a), mindOf(b)];
        const [ma, mb] = minds;
        if (!ma || !mb) continue;
        let told = false;
        for (const fact of spreading) {
          for (const [teller, hearer, from, to] of [
            [ma, mb, a, b],
            [mb, ma, b, a],
          ] as const) {
            if (!teller.knows(fact) || hearer.knows(fact)) continue;
            hearer.learn(fact, { from });
            told = true;
            emit("npc", {
              npc: teller.id,
              what: "told",
              at: clock.minutes,
              perceived: playerPerceives(from) || playerPerceives(to),
              to: hearer.id,
              fact: fact.id,
            });
          }
        }
        if (told && (playerPerceives(a) || playerPerceives(b))) {
          const seen = seenTelling(a, b);
          if (seen !== "") happen(a, { seen });
        }
      }
    }
  },
  { source: SOURCE, after: "npc turns" },
);
