/**
 * Agendas (#107, ADR 0084): adv3Lite-style goals an NPC pursues across
 * turns, such as "find the player and deliver the warning". In the NPC's
 * turn, the highest-priority item that's active and ready takes one step,
 * until it says it's done. An NPC with such an item acts even while unseen.
 * Two helpers come with them: `stepToward`, one step along the shortest way
 * to someone or somewhere, and `say`, speech narrated to whoever hears it.
 */
import {
  _storyRunning,
  message,
  messages,
  NameTaken,
  object,
  StateError,
  t,
  type ObjectRef,
} from "@loominate-if/core";
import { bodyOf, currentPlayerBody, mindFor, type Mind } from "./actors.js";
import { exitsOf } from "./exits.js";
import { _actsUnseen, actAs, everyTurn, go, type NpcTurn } from "./npcs.js";
import { happen } from "./perception.js";
import { isPlace, placeOf } from "./things.js";

declare module "@loominate-if/core" {
  interface Messages {
    /** Speech an NPC is seen saying, with {@link say}: "The butler says, “Fire!”" `actor` is their body. */
    "say.seen": { readonly actor: ObjectRef; readonly text: string };
    /** Speech heard from an NPC who isn't seen: "Someone says, “Fire!”" */
    "say.heard": { readonly actor: ObjectRef; readonly text: string };
  }
}
const SOURCE = "@loominate-if/world";
messages.register("say.seen", ({ actor, text }) => t`{The subj actor} {says}, ${text}`({ actor }), {
  source: SOURCE,
});
messages.register("say.heard", ({ text }) => `Someone says, ${text}`, { source: SOURCE });

/** What an agenda item's `act` is given: the NPC's turn, and a way to say the goal is met. */
export type AgendaTurn = NpcTurn & {
  /** Marks the item done: it won't act again unless it's started again. */
  done(): void;
};

/** An agenda item, for {@link agenda}. */
export type AgendaItem = {
  /** Higher goes first, among items that are ready. Defaults to 0. */
  readonly priority?: number;
  /** Whether it can act now. Defaults to always. */
  readonly ready?: () => boolean;
  /** One step towards its goal, in the NPC's turn. Calls `done()` when the goal is met. */
  readonly act: (turn: AgendaTurn) => void;
  /** Whether it's active from the start. Defaults to true; false waits for {@link startAgenda}. */
  readonly starts?: boolean;
};

type Item = { readonly name: string; readonly order: number } & AgendaItem;
/** Each NPC's items, by mind ID, in the order they were added. */
const items = new Map<string, Item[]>();
/** Items started or stopped as the game loads, by key: how things start. */
const starting = new Map<string, boolean>();
const state = object("world:agendas", {
  /** Items started (true) or stopped (false) in play, by `mind ID|name`. */
  active: {} as Record<string, boolean>,
});
const keyOf = (mind: string, name: string): string => `${mind}|${name}`;

const itemFor = (where: string, npc: ObjectRef, name: string): { mind: Mind; item: Item } => {
  const mind = mindFor(npc, where);
  const item = items.get(mind.id)?.find((i) => i.name === name);
  if (!item) {
    throw new StateError(
      `${where}: ${JSON.stringify(mind.id)} has no agenda item ${JSON.stringify(name)}. Add it with agenda(npc, ${JSON.stringify(name)}, { act }).`,
    );
  }
  return { mind, item };
};

/** Whether an item is active now: as changed in play, as it started, or as it was defined. */
const isActive = (mind: string, item: Item): boolean => {
  const key = keyOf(mind, item.name);
  if (_storyRunning() && Object.hasOwn(state.active, key)) return state.active[key] === true;
  return starting.get(key) ?? item.starts ?? true;
};

/** The item that acts in an NPC's turn now: the highest-priority active, ready one. */
function next(mind: string): Item | undefined {
  return (items.get(mind) ?? [])
    .filter((item) => isActive(mind, item) && (item.ready?.() ?? true))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.order - b.order)[0];
}

/**
 * Gives an NPC an agenda item: a goal it pursues across turns. In the NPC's
 * turn, the highest-priority item that's active and ready takes one step,
 * by `act`, which calls `done()` when the goal is met. While an NPC has
 * such an item, they act even when unseen. Define items in `story.ts`.
 *
 * @example
 * ```ts
 * agenda(butler, "warn the player", {
 *   priority: 10,
 *   starts: false,
 *   act: ({ npc, done }) => {
 *     if (!stepToward(npc, you)) return;
 *     say(npc, "“The east wing is on fire!”");
 *     done();
 *   },
 * });
 * ```
 *
 * @throws NameTaken if the NPC already has an item with this name.
 */
export function agenda(npc: ObjectRef, name: string, item: AgendaItem): void {
  const mind = mindFor(npc, "agenda");
  const list = items.get(mind.id);
  if (list?.some((i) => i.name === name)) {
    throw new NameTaken(
      `agenda ${JSON.stringify(name)}: ${JSON.stringify(mind.id)} already has an item with this name.`,
    );
  }
  if (!list) {
    items.set(mind.id, []);
    // The NPC's turn: one step for the item that's next.
    everyTurn(npc, "agenda", (turn) => {
      const chosen = next(mind.id);
      if (!chosen) return;
      chosen.act({
        ...turn,
        done: () => {
          state.active = { ...state.active, [keyOf(mind.id, chosen.name)]: false };
        },
      });
    });
  }
  items.get(mind.id)?.push({ ...item, name, order: items.get(mind.id)?.length ?? 0 });
}

/** Makes an NPC's agenda item active, as an event giving them a goal. In `story.ts`, it's how it starts. */
export function startAgenda(npc: ObjectRef, name: string): void {
  setActive("startAgenda", npc, name, true);
}

/** Makes an NPC's agenda item inactive, until it's started again. */
export function stopAgenda(npc: ObjectRef, name: string): void {
  setActive("stopAgenda", npc, name, false);
}

function setActive(where: string, npc: ObjectRef, name: string, on: boolean): void {
  const { mind } = itemFor(where, npc, name);
  const key = keyOf(mind.id, name);
  if (!_storyRunning()) starting.set(key, on);
  else state.active = { ...state.active, [key]: on };
}

/** Whether an NPC's agenda item is active: started, and not yet done or stopped. */
export function isAgendaActive(npc: ObjectRef, name: string): boolean {
  const { mind, item } = itemFor("isAgendaActive", npc, name);
  return isActive(mind.id, item);
}

/** Whether an NPC is busy with an agenda item: one that's active and ready. @internal */
export function _busyWithAgenda(mind: ObjectRef): boolean {
  return next(mind.id) !== undefined;
}

// An NPC pursuing a goal acts even while unseen.
_actsUnseen((mind) => _busyWithAgenda(mind));

/**
 * Takes one step along the shortest way from where an NPC is to `target`, a
 * place, or the place a thing or person is in, through `go`, so a locked or
 * closed door stops them. Returns true once they're there, after the step
 * or already. Among ways as short as each other, it goes by direction order.
 */
export function stepToward(npc: ObjectRef, target: ObjectRef): boolean {
  const body = bodyOf(mindFor(npc, "stepToward"));
  const from = body ? placeOf(body) : undefined;
  const to = isPlace(target) ? target : placeOf(target);
  if (!body || !from || !to) return false;
  if (from.id === to.id) return true;
  const way = firstStep(from, to);
  if (way === undefined) return false;
  actAs(npc, go({ way }));
  return placeOf(body)?.id === to.id;
}

/** The first direction of a shortest way from `from` to `to`, by breadth-first search. */
function firstStep(from: ObjectRef, to: ObjectRef): string | undefined {
  const first = new Map<string, string>([[from.id, ""]]);
  const queue: ObjectRef[] = [from];
  for (let at = queue.shift(); at; at = queue.shift()) {
    for (const exit of exitsOf(at)) {
      if (first.has(exit.to.id)) continue;
      const step = first.get(at.id) || exit.direction.name;
      if (exit.to.id === to.id) return step;
      first.set(exit.to.id, step);
      queue.push(exit.to);
    }
  }
  return undefined;
}

/**
 * Has an NPC say something, narrated to whoever sees them, as "The butler
 * says, “The east wing is on fire!”", or only hears them, as "Someone says,
 * …". Write the speech with its quotation marks. Conversations come with
 * their own; this is for a line said in passing.
 *
 * @throws StateError if `npc` is the player, or has no body.
 */
export function say(npc: ObjectRef, text: string): void {
  const body = bodyOf(mindFor(npc, "say"));
  if (!body) throw new StateError(`say: ${JSON.stringify(npc.id)} has no body to speak with.`);
  if (body.id === currentPlayerBody()?.id) {
    throw new StateError("say: that's the player, who speaks through the story's text.");
  }
  happen(body, {
    seen: message("say.seen", { actor: body, text }),
    heard: message("say.heard", { actor: body, text }),
  });
}
