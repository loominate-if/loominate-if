/**
 * NPCs act through the same pipeline as the player (#106, ADR 0081), so
 * locks, keys, reach, and a game's own rules apply to them equally. What
 * they do is narrated to the player only if the player sees it, in the
 * third person; a refusal is never narrated, but returned for code such as
 * an agenda to react to.
 */
import {
  _storyRunning,
  action,
  hook,
  message,
  messages,
  object,
  perform,
  StateError,
  t,
  type ActionCall,
  type ActionOutcome,
  type ObjectRef,
} from "@loominate-if/core";
import { bodyOf, currentPlayerBody, isBody, mindFor, type Mind } from "./actors.js";
import { clock } from "./clock.js";
import { canHear, canSee } from "./scope.js";
import { blockedReason, exitsOf, type Exit } from "./exits.js";
import { happen } from "./perception.js";
import { move, placeOf } from "./things.js";

declare module "@loominate-if/core" {
  interface HookKinds {
    /** An NPC's turn, after the player's move, as `npc:butler`: the rules {@link everyTurn} adds. */
    [name: `npc:${string}`]: NpcTurn;
    /** What an NPC did while unseen, as `catchUp:butler`: the rules {@link catchUp} adds. */
    [name: `catchUp:${string}`]: CatchUp;
  }
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

/** What an NPC's turn rules are given. */
export type NpcTurn = {
  /** The NPC, as {@link everyTurn} was given it: act as them with `actAs(npc, …)`. */
  readonly npc: ObjectRef;
  /** Their mind. */
  readonly mind: Mind;
  /** The body they act through now. */
  readonly body: ObjectRef;
};

/** The NPCs with turn rules, by mind ID, as {@link everyTurn} was given each. */
const npcs = new Map<string, ObjectRef>();
/** NPCs simulated from the start, set as the game loads. */
const startingSimulated = new Set<string>();
const state = object("world:npcs", {
  /** Changes in play to which NPCs are simulated, by mind ID: true or false. */
  simulated: {} as Record<string, boolean>,
  /**
   * Each NPC's last turn, by mind ID: whether they got one after the last
   * move, and the clock's minutes and the move count when they last did.
   */
  last: {} as Record<
    string,
    { readonly turned: boolean; readonly minutes: number; readonly moves: number }
  >,
});

/** What an NPC's catch-up rules are given: the NPC, and how long they were unseen. */
export type CatchUp = NpcTurn & {
  /** Game minutes since their last turn, or since the game began. */
  readonly minutes: number;
  /** The player's moves since then. */
  readonly moves: number;
};

/**
 * Adds a rule working out what an observed-only NPC did while the player
 * couldn't perceive them. It runs once, just before their first turn after
 * a stretch without one, with how long that was. It changes state
 * directly, not through actions: nobody saw it, so nothing is narrated or
 * checked. A simulated NPC, who acts every move, never needs it. In the
 * inspector, it's the hook `catchUp:` and their ID.
 *
 * @example
 * ```ts
 * catchUp(butler, "tidied the hall", ({ npc, minutes }) => {
 *   if (minutes >= 30 && cake.location?.id === "hall") move(cake, npc);
 * });
 * ```
 */
export function catchUp(npc: ObjectRef, name: string, rule: (caught: CatchUp) => void): void {
  const mind = mindFor(npc, "catchUp");
  if (!npcs.has(mind.id)) npcs.set(mind.id, npc);
  hook(`catchUp:${mind.id}`).rule(name, rule);
}

/**
 * Adds a rule to an NPC's turn, which comes after each of the player's
 * moves, as long as the NPC gets one: by default, while the player can see
 * or hear them; with {@link simulate}, always. An NPC's rules run in the
 * order they're added, and NPCs take their turns in ID order. In the
 * inspector, each NPC's turn is the hook `npc:` and their ID.
 *
 * @example
 * ```ts
 * everyTurn(butler, "tidies the hall", ({ npc }) => {
 *   if (cake.location?.id === "hall") actAs(npc, take({ thing: cake }));
 * });
 * ```
 */
export function everyTurn(npc: ObjectRef, name: string, rule: (turn: NpcTurn) => void): void {
  const mind = mindFor(npc, "everyTurn");
  if (!npcs.has(mind.id)) npcs.set(mind.id, npc);
  hook(`npc:${mind.id}`).rule(name, rule);
}

/**
 * Makes an NPC simulated: they take a turn after every move, wherever they
 * are, acting offstage too. `simulate(npc, false)` makes them observed only
 * again. In `story.ts`, as the game loads, it's how they start.
 */
export function simulate(npc: ObjectRef, on = true): void {
  const mind = mindFor(npc, "simulate");
  if (!_storyRunning()) {
    if (on) startingSimulated.add(mind.id);
    else startingSimulated.delete(mind.id);
    return;
  }
  state.simulated = { ...state.simulated, [mind.id]: on };
}

/** Whether an NPC is simulated, acting wherever they are, rather than observed only. */
export function isSimulated(npc: ObjectRef): boolean {
  const id = mindFor(npc, "isSimulated").id;
  return Object.hasOwn(state.simulated, id)
    ? state.simulated[id] === true
    : startingSimulated.has(id);
}

/**
 * Whether an NPC gets a turn now: always, if simulated; otherwise only while
 * the player can see or hear their body. Never the player's own.
 */
export function getsTurn(npc: ObjectRef): boolean {
  const mind = mindFor(npc, "getsTurn");
  const body = bodyOf(mind);
  const player = currentPlayerBody();
  if (!body || body.id === player?.id) return false;
  if (isSimulated(mind)) return true;
  // Something else may have them act unseen, such as an agenda item they're pursuing.
  if (actsUnseen.some((reason) => reason(mind))) return true;
  return player !== undefined && (canSee(player, body) || canHear(player, body));
}

/** Reasons an NPC acts even while unseen, such as an active agenda item. */
const actsUnseen: ((mind: Mind) => boolean)[] = [];
/**
 * Adds a reason an NPC takes a turn even while the player can't perceive
 * them, as agendas do while an item is active. @internal
 */
export function _actsUnseen(reason: (mind: Mind) => boolean): void {
  actsUnseen.push(reason);
}

// After each of the player's moves, every NPC with a turn takes it, in ID order.
hook("turnEnd").rule(
  "npc turns",
  ({ move }) => {
    // A continue only acknowledges what was read, so it isn't a move (#311).
    if (move === "continue") return;
    for (const [id, npc] of [...npcs].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      const before = state.last[id];
      if (!getsTurn(npc)) {
        if (before?.turned !== false) {
          state.last = { ...state.last, [id]: { ...(before ?? now()), turned: false } };
        }
        continue;
      }
      const mind = mindFor(npc, "npc turns");
      const body = bodyOf(mind);
      if (!body) continue;
      // Back in view after a stretch without a turn: what they did meanwhile, first.
      if (before !== undefined && !before.turned) {
        hook(`catchUp:${id}`).run({
          npc,
          mind,
          body,
          minutes: clock.minutes - before.minutes,
          moves: clock.moves - before.moves,
        });
      }
      state.last = { ...state.last, [id]: { turned: true, ...now() } };
      hook(`npc:${id}`).run({ npc, mind, body });
    }
  },
  { source: SOURCE, after: "move counter" },
);

/** The clock's minutes and move count now. */
const now = (): { minutes: number; moves: number } => ({
  minutes: clock.minutes,
  moves: clock.moves,
});

// As the game begins, every NPC counts as last seen now, if the player can perceive them.
hook("gameStart").rule(
  "npcs seen at the start",
  () => {
    const last: typeof state.last = {};
    for (const [id, npc] of npcs) last[id] = { turned: getsTurn(npc), ...now() };
    state.last = last;
  },
  { source: SOURCE },
);
