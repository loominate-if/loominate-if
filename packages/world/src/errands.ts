/**
 * Splitting up (#139, ADR 0112): a companion sent off on an errand of their
 * own. They go there a step a turn, acting unseen, and see what's there, as
 * anyone arriving does; a thing that says `found: fact` teaches them it.
 * Then they come back, or wait there. When they're with the player again,
 * they tell what they learned on the way, as their own dialogue, before
 * what they know is shared.
 */
import {
  action,
  emit,
  message,
  messages,
  object,
  StateError,
  t,
  type ObjectRef,
} from "@loominate-if/core";
import { bodyOf, currentPlayerBody, currentPlayerMind, mindFor } from "./actors.js";
import { stepToward, _canReach } from "./agendas.js";
import {
  _companionMinds,
  _setCompanionState,
  _whenCompanionMade,
  companionState,
} from "./companions.js";
import { type Fact } from "./knowledge.js";
import { _noReachFor } from "./acting.js";
import { _actsUnseen, everyTurn } from "./npcs.js";
import { happen } from "./perception.js";
import { isPlace, placeOf } from "./things.js";

declare module "@loominate-if/core" {
  interface Messages {
    /** A companion setting off: "Mira sets off for the library." */
    "errand.setsOff": { readonly companion: ObjectRef; readonly place: ObjectRef };
    /** Back from an errand with nothing new: "“Nothing worth telling,” Mira says." */
    "errand.nothing": { readonly companion: ObjectRef };
    /** Why a companion can't go somewhere: "Mira can't get there from here." */
    "errand.noWay": { readonly companion: ObjectRef };
  }
}
const SOURCE = "@loominate-if/world";
const register: typeof messages.register = (key, text, options) =>
  messages.register(key, text, options ?? { source: SOURCE });
register("errand.setsOff", ({ companion, place }) =>
  t`{The subj companion} {sets} off for {the place}.`({ companion, place }),
);
register("errand.nothing", ({ companion }) =>
  t`“Nothing worth telling,” {the subj companion} {says}.`({ companion }),
);
register("errand.noWay", ({ companion }) =>
  t`{The subj companion} can't get there from here.`({ companion }),
);

/** What a companion does once they've got there: come back to the player, or wait there. */
export type ErrandEnd = "return" | "wait";

/** Each errand under way, by mind ID: where to, what then, and whether they've got there. */
const state = object("world:errands", {
  of: {} as Record<
    string,
    {
      readonly to: string;
      readonly then: ErrandEnd;
      readonly arrived: boolean;
      /** The facts they knew when they set off, so they tell only what they learned. */
      readonly knew: readonly string[];
    }
  >,
});

/** An errand as plain data, copied out of state, so it can be read after state changes. */
const errandIn = (mind: string) => {
  const e = state.of[mind];
  return e && { to: e.to, then: e.then, arrived: e.arrived, knew: [...e.knew] };
};

/** Places a companion can be asked to search, in the order marked. */
const searchablePlaces: ObjectRef[] = [];

/**
 * Sends a companion off on an errand of their own, during play: they set
 * off for `to`, a step a turn, even unseen, seeing what's there as they
 * go; then, with `then: "return"`, the default, they come back to the
 * player, and with `"wait"` they wait there. Back with the player, they
 * tell what they learned on the way, as their own words, and it's shared.
 * Their state is `independent` until then.
 *
 * @example
 * ```ts
 * sendOff(mira, { to: library, then: "return" });
 * ```
 *
 * @throws StateError for an NPC who isn't a companion, or a `to` that isn't a place.
 */
export function sendOff(
  npc: ObjectRef,
  options: { readonly to: ObjectRef; readonly then?: ErrandEnd },
): void {
  const mind = mindFor(npc, "sendOff");
  if (companionState(mind) === undefined) {
    throw new StateError(
      `sendOff: ${JSON.stringify(mind.id)} isn't a companion. Make them one with companion(npc) in story.ts.`,
    );
  }
  if (!isPlace(options.to)) {
    throw new StateError(
      `sendOff: ${JSON.stringify(options.to.id)} isn't a place to send them to.`,
    );
  }
  state.of = {
    ...state.of,
    [mind.id]: {
      to: options.to.id,
      then: options.then ?? "return",
      arrived: false,
      knew: mind.knownFacts().map((f) => f.id),
    },
  };
  _setCompanionState(mind, "independent");
  const body = bodyOf(mind);
  if (body)
    happen(body, { seen: message("errand.setsOff", { companion: body, place: options.to }) });
}

/** Where a companion's errand takes them, if they're on one. */
export function errandOf(
  npc: ObjectRef,
): { readonly to: string; readonly then: ErrandEnd } | undefined {
  const e = state.of[mindFor(npc, "errandOf").id];
  return e && { to: e.to, then: e.then };
}

/**
 * Marks places a companion can be asked to search, in `story.ts`: "Ask Mira
 * to search the library" is offered on a companion's menu for each, but
 * the one they're in. Searching is an errand there and back.
 */
export function searchable(...places: readonly ObjectRef[]): void {
  for (const p of places) {
    if (!isPlace(p)) throw new StateError(`searchable: ${JSON.stringify(p.id)} isn't a place.`);
    if (!searchablePlaces.some((x) => x.id === p.id)) searchablePlaces.push(p);
  }
}

// On an errand, they act even unseen.
_actsUnseen((mind) => state.of[mind.id] !== undefined);

/** Ends an errand with the player: they tell what they learned on it, then it's shared as usual. */
function reunite(mind: string, body: ObjectRef): void {
  const errand = errandIn(mind);
  if (!errand) return;
  const player = currentPlayerMind();
  const told: Fact[] = mindFor({ id: mind }, "errand")
    .knownFacts()
    .filter((f) => !errand.knew.includes(f.id) && !(player?.knows(f) ?? false));
  // Their own words, as dialogue, so the story log reads them as theirs.
  emit(
    "action-result",
    {
      text:
        told.length === 0
          ? message("errand.nothing", { companion: body })
          : told.map((f) => `“${f.text}”`).join(" "),
    },
    ["topic", `speaker:${body.id}`],
  );
  for (const f of told) player?.learn(f, { from: body });
  const { [mind]: _done, ...rest } = state.of;
  void _done;
  state.of = rest;
  _setCompanionState({ id: mind }, errand.then === "return" ? "accompanying" : "waiting");
}

// Each companion's errand, in their turn: there, then back or waiting, and told when they meet.
_whenCompanionMade((npc) => {
  const mind = mindFor(npc, "companion").id;
  everyTurn(npc, "goes on their errand", ({ npc: who, body }) => {
    const errand = errandIn(mind);
    if (!errand) return;
    const player = currentPlayerBody();
    const withPlayer = (): boolean =>
      player !== undefined && placeOf(body)?.id === placeOf(player)?.id;
    if (!errand.arrived) {
      // Not yet there: a step toward it. Met on the way doesn't end it.
      if (!stepToward(who, { id: errand.to })) return;
      state.of = { ...state.of, [mind]: { ...errand, arrived: true } };
      // Arriving is this turn's step; they set back next turn. Found there by the player, they tell it now.
      if (withPlayer()) reunite(mind, body);
      return;
    }
    if (errand.then === "return" && player && !withPlayer()) stepToward(who, player);
    if (withPlayer()) reunite(mind, body);
  });
});

/** A companion searching a place, when asked: the NPC's own action, an errand there and back. */
export const search = action<{ place: ObjectRef }>("companion:search", {
  source: SOURCE,
  check: ({ place, body }) =>
    body && !_canReach(body, place) ? message("errand.noWay", { companion: body }) : undefined,
  run: ({ place, body }) => {
    if (body) sendOff(body, { to: place, then: "return" });
  },
});
// A place is searched by going there, not reached for from here.
_noReachFor(search);

/** The places a companion can be asked to search, in the order marked. @internal */
export function _searchablePlaces(): readonly ObjectRef[] {
  return searchablePlaces;
}

/** The companions on errands now, by mind ID. @internal */
export function _onErrand(): readonly string[] {
  return _companionMinds().filter((m) => state.of[m] !== undefined);
}
