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
  emit,
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
import { bodyOf, currentPlayerBody, isBody, mindFor, mindsIn, type Mind } from "./actors.js";
import { noteSights } from "./knowledge.js";
import { clock } from "./clock.js";
import { canHear, canSee } from "./scope.js";
import { blockedReason, exitsOf, type Exit } from "./exits.js";
import { _catchPerceived, happen } from "./perception.js";
import { daemon, type Delay, type Repeated, type Summary } from "./schedule.js";
import { move, placeOf } from "./things.js";

declare module "@loominate-if/core" {
  interface HookKinds {
    /** An NPC's turn, after the player's move, as `npc:butler`: the rules {@link everyTurn} adds. */
    [name: `npc:${string}`]: NpcTurn;
    /** What an NPC did while unseen, as `catchUp:butler`: the rules {@link catchUp} adds. */
    [name: `catchUp:${string}`]: CatchUp;
  }
  interface EventKinds {
    /**
     * Something an NPC did, for the inspector's timeline; the page never
     * shows it. `at` is the clock's minutes, and `perceived` whether the
     * player could see or hear them.
     */
    npc: {
      readonly npc: string;
      readonly what: "action" | "moved" | "caughtUp";
      readonly at: number;
      readonly perceived: boolean;
      /** For an action: its name, whether it was done, and why not. */
      readonly action?: string;
      readonly done?: boolean;
      readonly reason?: string;
      /** For a timetable move: where to. */
      readonly to?: string;
      /** For catching up: how long they were unseen. */
      readonly minutes?: number;
      readonly moves?: number;
    };
  }
  interface Messages {
    /** A line a paced NPC's turns said more than once in one jump of the clock: "The guard paces past, 6 times." */
    "npc.repeats": { readonly line: string; readonly count: number };
    /** Why `go` isn't taken: there's no way that way. */
    "go.noWay": { readonly way: string };
    /** Why `go` isn't taken by the player, who moves through the story's passages. */
    "go.player": Record<never, never>;
  }
}
const SOURCE = "@loominate-if/world";
messages.register(
  "npc.repeats",
  ({ line, count }) => `${line.replace(/[.!]$/, "")}, ${String(count)} times.`,
  { source: SOURCE },
);
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
  // Seen before or after: leaving the player's sight, or coming into it.
  const before = playerPerceives(body);
  const outcome = perform(call, { as: { actor, body } });
  const perceived = before || playerPerceives(body);
  if (outcome.done && outcome.seen !== undefined) happen(body, { seen: outcome.seen });
  emit("npc", {
    npc: actor.id,
    what: "action",
    at: clock.minutes,
    perceived,
    action: call.action.actionName,
    done: outcome.done,
    ...(outcome.reason !== undefined && { reason: outcome.reason }),
  });
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
    if (!exit || !body) return;
    move(body, exit.to);
    // They see where they've come to, as the player does (#139).
    noteSights(body, mindsIn(body));
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

/** How a simulated NPC's turns are paced on the game clock (#137). */
export type Pacing = {
  /** How often they take a turn: `minutes(5)`, or `moves(2)`. */
  readonly every: Delay;
  /**
   * What to say instead of what their turns said, when they take more
   * than one turn the player sees in one jump of the clock. By default,
   * each different line is said once, with how many times it happened.
   */
  readonly summary?: Summary;
};

/** Paced NPCs, by mind ID, set as the game loads. */
const paced = new Map<string, Pacing>();

/**
 * Makes an NPC simulated: they take a turn after every move, wherever they
 * are, acting offstage too. `simulate(npc, false)` makes them observed only
 * again. In `story.ts`, as the game loads, it's how they start.
 *
 * With a {@link Pacing}, as `simulate(guard, { every: minutes(5) })`, they
 * take a turn every so often on the game clock instead, so a long wait
 * gives them a turn at each time in it, as a daemon fires. Coming into the
 * player's view on a turn stops a jump of the clock there; what the player
 * sees of their turns in one jump is summed up. Pacing is set in
 * `story.ts`; in play, `simulate(npc, false)` and `simulate(npc)` switch
 * them off and on again, still paced.
 *
 * @example
 * ```ts
 * simulate(villain);
 * simulate(guard, { every: minutes(5) });
 * ```
 *
 * @throws StateError if pacing is given during play, or isn't a valid delay.
 */
export function simulate(npc: ObjectRef, on: boolean | Pacing = true): void {
  const mind = mindFor(npc, "simulate");
  if (typeof on === "object") {
    if (_storyRunning()) {
      throw new StateError(
        `simulate: ${JSON.stringify(mind.id)}'s turns are paced in story.ts, as the game loads, since each pace is a timer of its own. In play, simulate(npc) and simulate(npc, false) switch them on and off.`,
      );
    }
    if (paced.has(mind.id)) {
      throw new StateError(`simulate: ${JSON.stringify(mind.id)} is already paced.`);
    }
    if (!npcs.has(mind.id)) npcs.set(mind.id, npc);
    paced.set(mind.id, on);
    startingSimulated.add(mind.id);
    pace(mind.id, npc, on);
    return;
  }
  if (!_storyRunning()) {
    if (on) startingSimulated.add(mind.id);
    else startingSimulated.delete(mind.id);
    return;
  }
  state.simulated = { ...state.simulated, [mind.id]: on };
}

/** How an NPC's turns are paced, if they are. */
export function pacingOf(npc: ObjectRef): Pacing | undefined {
  return paced.get(mindFor(npc, "pacingOf").id);
}

/** Each line said once, in order, with how many times it was said, if more than once. */
const repeats: Summary = ({ lines }: Repeated) => {
  const counts = new Map<string, number>();
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
  return [...counts]
    .map(([line, count]) => (count === 1 ? line : message("npc.repeats", { line, count })))
    .join(" ");
};

/**
 * The daemon that gives a paced NPC their turns: each time it fires, they
 * take one, if they're still simulated, and what the player sees of it is
 * its line, so a long jump sums it up.
 */
function pace(id: string, npc: ObjectRef, pacing: Pacing): void {
  daemon(
    `world:pace:${id}`,
    {
      every: pacing.every,
      running: true,
      standsOut: true,
      summary: pacing.summary ?? repeats,
      source: SOURCE,
    },
    () => {
      if (!isSimulated(npc)) return undefined;
      const body = bodyOf(mindFor(npc, "paced turn"));
      if (!body || body.id === currentPlayerBody()?.id) return undefined;
      const seen = playerPerceives(body);
      const lines = _catchPerceived(() => {
        takeTurn(id, npc);
      });
      // Coming into view stops a wait there, as an interrupting fuse does.
      if (!seen && playerPerceives(body)) clock.interrupt();
      return lines.length === 0 ? undefined : lines.join(" ");
    },
  );
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

/** Whether the player can see or hear `body` now. @internal */
export function playerPerceives(body: ObjectRef): boolean {
  const player = currentPlayerBody();
  return (
    player !== undefined && player.id !== body.id && (canSee(player, body) || canHear(player, body))
  );
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
      // A paced NPC's turns come on the clock, not after each move.
      if (paced.has(id) && isSimulated(npc)) continue;
      takeTurn(id, npc);
    }
  },
  { source: SOURCE, after: "move counter" },
);

/** An NPC's turn: what they did meanwhile, if they've had none for a while, then their rules. */
function takeTurn(id: string, npc: ObjectRef): void {
  const before = state.last[id];
  const mind = mindFor(npc, "npc turns");
  const body = bodyOf(mind);
  if (!body) return;
  // Back in view after a stretch without a turn: what they did meanwhile, first.
  if (before !== undefined && !before.turned) {
    const minutes = clock.minutes - before.minutes;
    const moves = clock.moves - before.moves;
    if (hook(`catchUp:${id}`).rules().length > 0) {
      hook(`catchUp:${id}`).run({ npc, mind, body, minutes, moves });
      emit("npc", {
        npc: id,
        what: "caughtUp",
        at: clock.minutes,
        perceived: true,
        minutes,
        moves,
      });
    }
  }
  state.last = { ...state.last, [id]: { turned: true, ...now() } };
  hook(`npc:${id}`).run({ npc, mind, body });
}

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
