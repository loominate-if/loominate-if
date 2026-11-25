/**
 * Orders (#123, ADR 0100): the player asks an NPC to do something, as "Ask
 * Tom to pick the lock". An order is an action the player takes; the NPC
 * then does the action as themselves, with their own body, skills, and
 * inventory, through its verify and check. They can refuse, by a rule in
 * `obeying`, or fail, and either way their answer says why.
 */
import {
  _statusAs,
  action,
  emit,
  message,
  messages,
  rulebook,
  StateError,
  t,
  type Action,
  type ActionCall,
  type ObjectRef,
} from "@loominate-if/core";
import { _noReachFor } from "./acting.js";
import { allBodies, currentPlayerBody, isBody, mindOf, type Mind } from "./actors.js";
import { accompany, companionState, waitHere } from "./companions.js";
import { actAs } from "./npcs.js";
import { search } from "./errands.js";
import { give, type ActingOn } from "./standard.js";
import { isPlace, isWithin, placeOf } from "./things.js";

declare module "@loominate-if/core" {
  interface Messages {
    /** An order's label: "Ask Tom to pick the lock". `action` is the action's own label. */
    "order.label": { readonly who: ObjectRef; readonly action: string };
    /** The player's line when they give an order: "You ask Tom to pick the lock." */
    "order.asked": { readonly who: ObjectRef; readonly action: string };
    /** Refusing an order, by default, for an NPC who isn't a companion. */
    "order.refused": { readonly who: ObjectRef };
    /** An NPC who'd obey but can't: "Tom can't: The door is locked." */
    "order.cant": { readonly who: ObjectRef; readonly reason: string };
    /** Why an order isn't offered: they aren't here. */
    "order.notHere": { readonly who: ObjectRef };
    /** Why an order isn't offered: it's to the player. */
    "order.self": Record<never, never>;
    /** The standard order to wait: "Ask Mira to wait here". */
    "order.wait": { readonly who: ObjectRef };
    /** The standard order to come along: "Ask Mira to come along". */
    "order.come": { readonly who: ObjectRef };
    /** Asking someone for something they carry: "Ask Mira for the key". */
    "order.askFor": { readonly from: ObjectRef; readonly thing: ObjectRef };
    /** The player's line when they ask for something: "You ask Mira for the key." */
    "order.askedFor": { readonly from: ObjectRef; readonly thing: ObjectRef };
    /** The order to search a place: "Ask Mira to search the library". */
    "order.search": { readonly who: ObjectRef; readonly place: ObjectRef };
    /** Why a companion isn't asked to search where they are. */
    "order.thereAlready": { readonly who: ObjectRef };
    /** Why a companion isn't asked to wait or come along: they already are. */
    "order.already": { readonly who: ObjectRef };
  }
}
const SOURCE = "@loominate-if/world";
const lower = (s: string): string => `${s.charAt(0).toLowerCase()}${s.slice(1)}`;
const register: typeof messages.register = (key, text, options) =>
  messages.register(key, text, options ?? { source: SOURCE });
register("order.label", ({ who, action }) => t`Ask {the who} to ${lower(action)}`({ who }));
register("order.asked", ({ who, action }) => t`You ask {the who} to ${lower(action)}.`({ who }));
register("order.refused", ({ who }) =>
  t`{The subj who} {has} no reason to take orders from you.`({ who }),
);
register("order.cant", ({ who, reason }) => t`{The subj who} can't: ${reason}`({ who }));
register("order.notHere", ({ who }) => t`{The subj who} {isn't} here.`({ who }));
register("order.self", () => "You can't give yourself orders.");
register("order.wait", ({ who }) => t`Ask {the who} to wait here`({ who }));
register("order.come", ({ who }) => t`Ask {the who} to come along`({ who }));
register("order.askFor", ({ from, thing }) => t`Ask {the from} for {the thing}`({ from, thing }));
register("order.askedFor", ({ from, thing }) =>
  t`You ask {the from} for {the thing}.`({ from, thing }),
);
register("order.already", ({ who }) => t`{The subj who} already {is}.`({ who }));
register("order.thereAlready", ({ who }) => t`{The subj who} {is} already here.`({ who }));
register("order.search", ({ who, place }) =>
  t`Ask {the who} to search {the place}`({ who, place }),
);

/** What `obeying` rules are told: who's asked, their mind, and what they're asked to do. */
export type Ordered = {
  /** The NPC, by their body. */
  readonly who: ObjectRef;
  /** Their mind. */
  readonly mind: Mind;
  /** What they're asked to do. */
  readonly call: ActionCall<Readonly<Record<string, unknown>>>;
};

/**
 * Whether an NPC obeys an order: the first rule to give a refusal decides,
 * and it's what they say. By default companions obey and others refuse;
 * add rules for what a companion won't do.
 *
 * @example
 * ```ts
 * obeying.rule("Tom won't touch the vault", ({ who, call }) =>
 *   who.id === "tom" && call.args.thing === vaultDoor ? "Tom shakes his head. “Not the vault.”" : undefined,
 * );
 * ```
 */
export const obeying = rulebook<Ordered, string>("obeying", { kind: "decide" });
obeying.rule(
  "only companions take orders",
  ({ who }) => (companionState(who) === undefined ? message("order.refused", { who }) : undefined),
  { source: SOURCE },
);

/** Why the player can't give `who` an order now, or `undefined`. */
function cantAsk(who: ObjectRef): string | undefined {
  const player = currentPlayerBody();
  if (who.id === player?.id) return message("order.self", {});
  if (!isBody(who) || !mindOf(who)) return message("order.notHere", { who });
  if (!player || placeOf(who)?.id !== placeOf(player)?.id) return message("order.notHere", { who });
  return undefined;
}

/** The NPC acting: `as`, for checking and performing as them. */
const as = (who: ObjectRef) => {
  const mind = mindOf(who);
  return mind ? { actor: mind, body: who } : undefined;
};

const say = (text: string, who: ObjectRef, player = false): void => {
  const me = currentPlayerBody();
  emit(
    "action-result",
    { text },
    player
      ? ["topic", "player", ...(me ? [`speaker:${me.id}`] : [])]
      : ["topic", `speaker:${who.id}`],
  );
};

/** Carries out an order: the player asks; the NPC refuses, can't, or does it. */
function carryOut(
  who: ObjectRef,
  call: ActionCall<Readonly<Record<string, unknown>>>,
  asked: string,
): void {
  say(asked, who, true);
  const mind = mindOf(who);
  if (!mind) return;
  const refusal = obeying.run({ who, mind, call });
  if (refusal !== undefined && refusal !== "") {
    say(refusal, who);
    return;
  }
  const status = _statusAs(call, as(who));
  const reason = status.hidden ?? status.disabled;
  if (reason !== undefined) {
    say(message("order.cant", { who, reason }), who);
    return;
  }
  actAs(who, call);
}

/** Whether the order makes sense for them: their verify of the action, as them. */
const sensible = (
  who: ObjectRef,
  call: ActionCall<Readonly<Record<string, unknown>>>,
): string | undefined => _statusAs(call, as(who)).hidden;

/**
 * Makes an order from an action: "Ask Tom to pick the lock". Its things are
 * `who`, the NPC asked, and the action's own; the NPC does the action as
 * themselves. It's offered when they're here and the action makes sense for
 * them; asking takes a move, and they may refuse, by `obeying`, or fail,
 * and say why.
 *
 * @example
 * ```ts
 * export const askToPick = order(pickLock);
 * // [[Ask Tom to pick the lock]]{act askToPick({ who: tom, thing: lock })}
 * ```
 */
export function order<A extends Readonly<Record<string, unknown>>>(
  target: Action<A>,
  options: { readonly label?: (args: A & { readonly who: ObjectRef }) => string } = {},
): Action<A & { readonly who: ObjectRef }> {
  const callOf = (args: A & { readonly who: ObjectRef }) => {
    // Only the action's own things: not who's asked, nor the order's context.
    const {
      who: _who,
      action: _action,
      actor: _actor,
      body: _body,
      ...rest
    } = args as A & {
      readonly who: ObjectRef;
      readonly action?: unknown;
      readonly actor?: unknown;
      readonly body?: unknown;
    };
    void [_who, _action, _actor, _body];
    return target(rest as unknown as A) as unknown as ActionCall<Readonly<Record<string, unknown>>>;
  };
  const made = action<A & { readonly who: ObjectRef }>(`order:${target.actionName}`, {
    source: SOURCE,
    minutes: 1,
    label: (args) =>
      options.label?.(args) ??
      message("order.label", { who: args.who, action: target.label(callOf(args).args as A) }),
    verify: (c) => cantAsk(c.who) ?? sensible(c.who, callOf(c)),
    run: (c) => {
      const action = target.label(callOf(c).args as A);
      carryOut(c.who, callOf(c), message("order.asked", { who: c.who, action }));
    },
  });
  _noReachFor(made);
  return made;
}

// --- The standard orders ---

/** A companion staying where they are, when asked: the NPC's own action. */
export const stay = action<Record<never, never>>("companion:stay", {
  source: SOURCE,
  verify: ({ body }) =>
    body && companionState(body) === "waiting"
      ? message("order.already", { who: body })
      : undefined,
  run: ({ body }) => {
    if (body) waitHere(body);
  },
});

/** A companion coming along, when asked: the NPC's own action. */
export const comeAlong = action<Record<never, never>>("companion:come", {
  source: SOURCE,
  verify: ({ body }) =>
    body && companionState(body) === "accompanying"
      ? message("order.already", { who: body })
      : undefined,
  run: ({ body }) => {
    if (body) accompany(body);
  },
});

/** Someone else here, who can be asked things. */
const someoneHere = (t: ObjectRef): boolean => {
  const player = currentPlayerBody();
  return (
    isBody(t) &&
    t.id !== player?.id &&
    player !== undefined &&
    placeOf(t)?.id === placeOf(player)?.id
  );
};

/** A standard order on an NPC's menu, with no things of its own. */
const menuOrder = (
  name: string,
  target: ActionCall<Readonly<Record<string, unknown>>>,
  label: "order.wait" | "order.come",
) => {
  const made = action<{ thing: ActingOn }>(name, {
    source: SOURCE,
    minutes: 1,
    for: (t) => someoneHere(t) && companionState(t) !== undefined,
    label: ({ thing }) => message(label, { who: thing }),
    verify: ({ thing }) => cantAsk(thing) ?? sensible(thing, target),
    run: ({ thing }) => {
      carryOut(thing, target, `${message(label, { who: thing }).replace(/^Ask/, "You ask")}.`);
    },
  });
  _noReachFor(made);
  return made;
};

/** "Ask Mira to wait here", on a companion's menu. */
export const askToWait = menuOrder("order:wait", stay({}) as never, "order.wait");
/** "Ask Mira to come along", on a companion's menu. */
export const askToCome = menuOrder("order:come", comeAlong({}) as never, "order.come");

/**
 * "Ask Mira for the key": asks someone here for something they carry, on
 * the thing's menu. They give it through `give`, as themselves, so the
 * game's `giving` rules apply, or they refuse.
 */
export const askFor = action<{ thing: ActingOn; from: ActingOn }>("order:askFor", {
  source: SOURCE,
  minutes: 1,
  for: (t) => !isBody(t) && someoneHolding(t) !== undefined,
  with: { from: (t) => someoneHere(t) },
  label: ({ thing, from }) => message("order.askFor", { from, thing }),
  verify: ({ thing, from }) =>
    cantAsk(from) ?? (isWithin(thing, from) ? undefined : message("order.notHere", { who: thing })),
  run: ({ thing, from }) => {
    const player = currentPlayerBody();
    if (!player) return;
    carryOut(
      from,
      give({ thing, to: player as ActingOn }) as unknown as ActionCall<
        Readonly<Record<string, unknown>>
      >,
      message("order.askedFor", { from, thing }),
    );
  },
});
_noReachFor(askFor);

/** Who here, other than the player, carries `thing`, if anyone. */
function someoneHolding(thing: ObjectRef): ObjectRef | undefined {
  return allBodies().find((b) => someoneHere(b) && isWithin(thing, b));
}

/** Places a companion can be asked to search, in the order marked. */
const searchablePlaces = new Set<string>();

/**
 * Marks places a companion can be asked to search, in `story.ts`: a
 * companion's menu offers "Ask Mira to search the library" for each, but
 * the one they're in, wherever it is (#139). They go there and back, as
 * `sendOff` sends them, through `obeying`, so they can refuse.
 *
 * @example
 * ```ts
 * searchable(library, cellar);
 * ```
 *
 * @throws StateError for something that isn't a place.
 */
export function searchable(...places: readonly ObjectRef[]): void {
  for (const place of places) {
    if (!isPlace(place)) {
      throw new StateError(`searchable: ${JSON.stringify(place.id)} isn't a place.`);
    }
    if (searchablePlaces.has(place.id)) continue;
    searchablePlaces.add(place.id);
    // One order for each place, with the place fixed, since a menu fills
    // roles only from what's in sight, and the place to search isn't.
    const made = action<{ thing: ActingOn; place: ActingOn }>(`order:search:${place.id}`, {
      source: SOURCE,
      minutes: 1,
      for: (t) => someoneHere(t) && companionState(t) !== undefined,
      with: { place },
      label: ({ thing, place: p }) => message("order.search", { who: thing, place: p }),
      verify: ({ thing, place: p }) =>
        cantAsk(thing) ??
        (placeOf(thing)?.id === p.id ? message("order.thereAlready", { who: thing }) : undefined),
      run: ({ thing, place: p }) => {
        carryOut(
          thing,
          search({ place: p }) as unknown as ActionCall<Readonly<Record<string, unknown>>>,
          `${message("order.search", { who: thing, place: p }).replace(/^Ask/, "You ask")}.`,
        );
      },
    });
    _noReachFor(made);
  }
}
