/**
 * The world model's standard actions (#77, ADR 0046): examine, take, drop,
 * open, close, lock, and unlock, on the menus of the things they suit. Each
 * is an ordinary action, so a game changes one with its rules, such as
 * `take.check.rule(…)`, and words them through the message table.
 */
import {
  action,
  message,
  messages,
  rulebook,
  t,
  type ObjectRef,
  type Text,
} from "@loominate-if/core";
import { currentPlayerBody, isBody } from "./actors.js";
import { pluralOf } from "./listing.js";
import { amountOf, countOf, isStack, oneOf, split } from "./stacks.js";
import { isPlace, isWithin, move, placeOf, thingFor, type Thing } from "./things.js";

declare module "@loominate-if/core" {
  interface Messages {
    "examine.label": { readonly thing: ObjectRef };
    /** What examining something with no description says. */
    "examine.nothing": { readonly thing: ObjectRef };
    "take.label": { readonly thing: ObjectRef };
    "take.done": { readonly thing: ObjectRef };
    /** Why taking something you already have isn't offered. */
    "take.held": { readonly thing: ObjectRef };
    "drop.label": { readonly thing: ObjectRef };
    "drop.done": { readonly thing: ObjectRef };
    /** Why dropping something you don't have isn't offered. */
    "drop.notHeld": { readonly thing: ObjectRef };
    /** Taking a whole stack: "Take all 99 turnips". */
    "stack.takeAll": { readonly thing: ObjectRef; readonly count: number };
    /** Dropping a whole stack: "Drop all 99 turnips". */
    "stack.dropAll": { readonly thing: ObjectRef; readonly count: number };
    /** Taking one from a stack: "Take a turnip". `one` is "a turnip". */
    "stack.takeOne": { readonly thing: ObjectRef; readonly one: string };
    "stack.takeOne.done": { readonly thing: ObjectRef; readonly one: string };
    /** Dropping one from a stack: "Drop a turnip". */
    "stack.dropOne": { readonly thing: ObjectRef; readonly one: string };
    "stack.dropOne.done": { readonly thing: ObjectRef; readonly one: string };
    /** Taking some from a stack, choosing how many: "Take some turnips…". `plural` is "turnips". */
    "stack.takeSome": { readonly thing: ObjectRef; readonly plural: string };
    /** The button that takes them: "Take". */
    "stack.takeSome.confirm": { readonly thing: ObjectRef };
    /** What taking some reports. `some` is "ten turnips". */
    "stack.takeSome.done": {
      readonly thing: ObjectRef;
      readonly count: number;
      readonly some: string;
    };
    "stack.dropSome": { readonly thing: ObjectRef; readonly plural: string };
    "stack.dropSome.confirm": { readonly thing: ObjectRef };
    "stack.dropSome.done": {
      readonly thing: ObjectRef;
      readonly count: number;
      readonly some: string;
    };
    /** What a stack's take some and drop some ask: "How many?". */
    "stack.howMany": { readonly thing: ObjectRef };
    /** Giving something to someone: "Give the coin to the toll keeper". */
    "give.label": { readonly thing: ObjectRef; readonly to: ObjectRef };
    /** What happens when no rule in `giving` answers: "The toll keeper doesn't want the coin." */
    "give.declined": { readonly thing: ObjectRef; readonly to: ObjectRef };
    /** Showing something to someone: "Show the pass to the toll keeper". */
    "show.label": { readonly thing: ObjectRef; readonly to: ObjectRef };
    /** What happens when no rule in `showing` answers: "The toll keeper glances at the pass." */
    "show.unmoved": { readonly thing: ObjectRef; readonly to: ObjectRef };
    /** What onlookers see when someone other than the player takes something: "The butler takes the iron key." `actor` is their body. */
    "take.seen": { readonly actor: ObjectRef; readonly thing: ObjectRef };
    "drop.seen": { readonly actor: ObjectRef; readonly thing: ObjectRef };
    "open.seen": { readonly actor: ObjectRef; readonly thing: ObjectRef };
    "close.seen": { readonly actor: ObjectRef; readonly thing: ObjectRef };
    "lock.seen": { readonly actor: ObjectRef; readonly thing: ObjectRef };
    "unlock.seen": { readonly actor: ObjectRef; readonly thing: ObjectRef };
    "give.seen": { readonly actor: ObjectRef; readonly thing: ObjectRef; readonly to: ObjectRef };
    "show.seen": { readonly actor: ObjectRef; readonly thing: ObjectRef; readonly to: ObjectRef };
    "open.label": { readonly thing: ObjectRef };
    "open.done": { readonly thing: ObjectRef };
    "open.already": { readonly thing: ObjectRef };
    /** Why something locked can't be opened. */
    "open.locked": { readonly thing: ObjectRef };
    "close.label": { readonly thing: ObjectRef };
    "close.done": { readonly thing: ObjectRef };
    "close.already": { readonly thing: ObjectRef };
    "lock.label": { readonly thing: ObjectRef };
    "lock.done": { readonly thing: ObjectRef };
    "lock.already": { readonly thing: ObjectRef };
    /** Why something open can't be locked. */
    "lock.open": { readonly thing: ObjectRef };
    "unlock.label": { readonly thing: ObjectRef };
    "unlock.done": { readonly thing: ObjectRef };
    "unlock.notLocked": { readonly thing: ObjectRef };
    /** Why something can't be locked or unlocked without its key. */
    "lock.noKey": { readonly thing: ObjectRef; readonly key: ObjectRef };
  }
}

const SOURCE = "@loominate-if/world";
const say: typeof messages.register = (key, text) => {
  messages.register(key, text, { source: SOURCE });
};
say("examine.label", t`Examine {the thing}`);
say("examine.nothing", t`You see nothing special about {the thing}.`);
say("take.label", t`Take {the thing}`);
say("take.done", t`You take {the thing}.`);
say("take.held", t`You already have {the thing}.`);
say("drop.label", t`Drop {the thing}`);
say("drop.done", t`You drop {the thing}.`);
say("drop.notHeld", t`You don't have {the thing}.`);
say("stack.takeAll", t`Take all {a thing}`);
say("stack.dropAll", t`Drop all {a thing}`);
say("stack.takeOne", ({ one }) => `Take ${one}`);
say("stack.takeOne.done", ({ one }) => `You take ${one}.`);
say("stack.dropOne", ({ one }) => `Drop ${one}`);
say("stack.dropOne.done", ({ one }) => `You drop ${one}.`);
say("stack.takeSome", ({ plural }) => `Take some ${plural}…`);
say("stack.takeSome.confirm", "Take");
say("stack.takeSome.done", ({ some }) => `You take ${some}.`);
say("stack.dropSome", ({ plural }) => `Drop some ${plural}…`);
say("stack.dropSome.confirm", "Drop");
say("stack.dropSome.done", ({ some }) => `You drop ${some}.`);
say("stack.howMany", "How many?");
say("give.label", t`Give {the thing} to {the to}`);
say("give.declined", t`{The subj to} {does}n't want {the thing}.`);
say("show.label", t`Show {the thing} to {the to}`);
say("show.unmoved", t`{The subj to} {glances} at {the thing}.`);
say("take.seen", t`{The subj actor} {takes} {the thing}.`);
say("drop.seen", t`{The subj actor} {drops} {the thing}.`);
say("open.seen", t`{The subj actor} {opens} {the thing}.`);
say("close.seen", t`{The subj actor} {closes} {the thing}.`);
say("lock.seen", t`{The subj actor} {locks} {the thing}.`);
say("unlock.seen", t`{The subj actor} {unlocks} {the thing}.`);
say("give.seen", t`{The subj actor} {gives} {the thing} to {the to}.`);
say("show.seen", t`{The subj actor} {shows} {the to} {the thing}.`);
say("open.label", t`Open {the thing}`);
say("open.done", t`You open {the thing}.`);
say("open.already", t`{The subj thing} {is} already open.`);
say("open.locked", t`{The subj thing} {is} locked.`);
say("close.label", t`Close {the thing}`);
say("close.done", t`You close {the thing}.`);
say("close.already", t`{The subj thing} {is} already closed.`);
say("lock.label", t`Lock {the thing}`);
say("lock.done", t`You lock {the thing}.`);
say("lock.already", t`{The subj thing} {is} already locked.`);
say("lock.open", t`You'll have to close {the thing} first.`);
say("unlock.label", t`Unlock {the thing}`);
say("unlock.done", t`You unlock {the thing}.`);
say("unlock.notLocked", t`{The subj thing} {is}n't locked.`);
say("lock.noKey", t`You need {the key}.`);

/** A thing as the standard actions see it: what they read, when it has it. */
export type ActingOn = Thing & {
  readonly description?: string | Text;
  readonly isFixed?: boolean;
  readonly isOpen?: boolean;
  readonly isLocked?: boolean;
  readonly key?: ObjectRef | null;
  readonly blocks?: unknown;
  open?(): boolean;
  close?(): void;
  lock?(): boolean;
  unlock?(): void;
};

/** A thing the standard actions can act on: not a place. */
const asThing = (t: ObjectRef): ActingOn | undefined => {
  const found = thingFor(t);
  return found && !isPlace(found) ? (found as ActingOn) : undefined;
};

/**
 * Whether `t` can be picked up: not a place, a body, a door or obstacle,
 * or a thing marked `isFixed`.
 */
export function isPortable(t: ObjectRef): boolean {
  const f = asThing(t);
  return f !== undefined && !isBody(f) && f.isFixed !== true && f.blocks === undefined;
}
const isOpenable = (t: ObjectRef): boolean => typeof asThing(t)?.open === "function";
const isLockable = (t: ObjectRef): boolean => typeof asThing(t)?.unlock === "function";

/** Why the key is missing, if `thing` has one the body doesn't carry. */
const needsKey = (thing: ActingOn, body: ObjectRef | undefined): string | undefined => {
  const key = thing.key ?? undefined;
  if (key === undefined || (body && isWithin(key, body))) return undefined;
  return message("lock.noKey", { thing, key });
};

/** Examines a thing: says its `description`, or that there's nothing special about it. */
export const examine = action<{ thing: ActingOn }>("examine", {
  source: SOURCE,
  verbs: ["examine {thing}", "x {thing}", "look at {thing}", "inspect {thing}"],
  for: (t) => asThing(t) !== undefined,
  label: ({ thing }) => message("examine.label", { thing }),
  report: ({ thing }) => {
    const d = thing.description;
    if (d === undefined) return message("examine.nothing", { thing });
    return typeof d === "string" ? d : d();
  },
});

/** Takes a thing, into the actor's body. */
export const take = action<{ thing: ActingOn }>("take", {
  source: SOURCE,
  seen: ({ thing, body }) => (body ? message("take.seen", { actor: body, thing }) : ""),
  verbs: [
    "take {thing}",
    "get {thing}",
    "pick up {thing}",
    "pick {thing} up",
    "take all (of) {thing}",
  ],
  for: isPortable,
  label: ({ thing }) =>
    isStack(thing) && countOf(thing) > 1
      ? message("stack.takeAll", { thing, count: countOf(thing) })
      : message("take.label", { thing }),
  verify: ({ thing, body }) =>
    body && isWithin(thing, body) ? message("take.held", { thing }) : undefined,
  run: ({ thing, body }) => {
    if (body) move(thing, body);
  },
  report: ({ thing }) => message("take.done", { thing }),
});

/** Drops a thing the actor carries, where the actor is. */
export const drop = action<{ thing: ActingOn }>("drop", {
  source: SOURCE,
  seen: ({ thing, body }) => (body ? message("drop.seen", { actor: body, thing }) : ""),
  verbs: ["drop {thing}", "put down {thing}", "put {thing} down", "drop all (of) {thing}"],
  for: isPortable,
  label: ({ thing }) =>
    isStack(thing) && countOf(thing) > 1
      ? message("stack.dropAll", { thing, count: countOf(thing) })
      : message("drop.label", { thing }),
  verify: ({ thing, body }) =>
    body && isWithin(thing, body) ? undefined : message("drop.notHeld", { thing }),
  run: ({ thing, body }) => {
    const here = body && (thingFor(body)?.location ?? placeOf(body));
    if (here) move(thing, here);
  },
  report: ({ thing }) => message("drop.done", { thing }),
});

/** A stack of more than one, which one can be taken from or dropped from. */
const isSeveral = (t: ObjectRef): boolean => isPortable(t) && isStack(t) && countOf(t) > 1;

/** Takes one from a stack, as "Take a turnip", into the actor's body, where it joins any of its kind. */
export const takeOne = action<{ thing: ActingOn }>("takeOne", {
  source: SOURCE,
  verbs: ["take one {thing}", "take a {thing}", "get one {thing}"],
  for: isSeveral,
  label: ({ thing }) => message("stack.takeOne", { thing, one: oneOf(thing) }),
  verify: ({ thing, body }) =>
    body && isWithin(thing, body) ? message("take.held", { thing }) : undefined,
  run: ({ thing, body }) => {
    if (body) move(split(thing, 1), body);
  },
  report: ({ thing }) => message("stack.takeOne.done", { thing, one: oneOf(thing) }),
});

/** Drops one from a stack the actor carries, as "Drop a turnip", where the actor is. */
export const dropOne = action<{ thing: ActingOn }>("dropOne", {
  source: SOURCE,
  verbs: ["drop one {thing}", "drop a {thing}"],
  for: isSeveral,
  label: ({ thing }) => message("stack.dropOne", { thing, one: oneOf(thing) }),
  verify: ({ thing, body }) =>
    body && isWithin(thing, body) ? undefined : message("drop.notHeld", { thing }),
  run: ({ thing, body }) => {
    const here = body && (thingFor(body)?.location ?? placeOf(body));
    if (here) move(split(thing, 1), here);
  },
  report: ({ thing }) => message("stack.dropOne.done", { thing, one: oneOf(thing) }),
});

/** A stack of more than two, which the player can choose how many to take or drop from. */
const isMany = (t: ObjectRef): boolean => isPortable(t) && isStack(t) && countOf(t) > 2;

/** How many to take or drop: from one to the whole stack. */
const howMany = {
  label: ({ thing }: { readonly thing: ObjectRef }) => message("stack.howMany", { thing }),
  min: 1,
  max: ({ thing }: { readonly thing: ObjectRef }) => countOf(thing),
};

/** Takes some from a stack, as many as the player chooses, into the actor's body. */
export const takeSome = action<{ thing: ActingOn; count: number }>("takeSome", {
  source: SOURCE,
  verbs: ["take {count} {thing}", "get {count} {thing}", "pick up {count} {thing}"],
  for: isMany,
  label: ({ thing }) => message("stack.takeSome", { thing, plural: pluralOf(thing) }),
  asks: { count: howMany },
  confirm: ({ thing }) => message("stack.takeSome.confirm", { thing }),
  verify: ({ thing, body }) =>
    body && isWithin(thing, body) ? message("take.held", { thing }) : undefined,
  run: ({ thing, body, count }) => {
    if (body) move(split(thing, count), body);
  },
  report: ({ thing, count }) =>
    message("stack.takeSome.done", { thing, count, some: amountOf(thing, count) }),
});

/** Drops some from a stack the actor carries, as many as the player chooses, where the actor is. */
export const dropSome = action<{ thing: ActingOn; count: number }>("dropSome", {
  source: SOURCE,
  verbs: ["drop {count} {thing}", "put down {count} {thing}"],
  for: isMany,
  label: ({ thing }) => message("stack.dropSome", { thing, plural: pluralOf(thing) }),
  asks: { count: howMany },
  confirm: ({ thing }) => message("stack.dropSome.confirm", { thing }),
  verify: ({ thing, body }) =>
    body && isWithin(thing, body) ? undefined : message("drop.notHeld", { thing }),
  run: ({ thing, body, count }) => {
    const here = body && (thingFor(body)?.location ?? placeOf(body));
    if (here) move(split(thing, count), here);
  },
  report: ({ thing, count }) =>
    message("stack.dropSome.done", { thing, count, some: amountOf(thing, count) }),
});

/** How someone reacts to being given or shown something, as a rule in {@link giving} or {@link showing} answers. */
export type Reaction = {
  /** Whether they take it: for giving, it moves to them. */
  readonly takes: boolean;
  /** What the player is told. */
  readonly text: string | Text;
  /** Anything else that happens, as a door unlocking. */
  readonly then?: () => void;
};

/** A reaction where they take what they're given, with what the player is told, and anything else that happens. */
export function accept(text: string | Text, then?: () => void): Reaction {
  return { takes: true, text, ...(then && { then }) };
}

/** A reaction where they keep their hands to themselves, with what the player is told, and anything else that happens. */
export function react(text: string | Text, then?: () => void): Reaction {
  return { takes: false, text, ...(then && { then }) };
}

/** What a reaction rule is told: the thing, who it's given or shown to, and who's acting. */
export type Offer = {
  readonly thing: ObjectRef;
  readonly to: ObjectRef;
  readonly actor?: ObjectRef;
  readonly body?: ObjectRef;
};

/**
 * How someone reacts to being given something: the first rule to answer
 * decides, with {@link accept}, so they take it, or {@link react}. With no
 * answer, they decline, in the `give.declined` message.
 *
 * @example
 * ```ts
 * giving.rule("the keeper takes the toll", ({ thing, to }) =>
 *   to === keeper && thing === coin ? accept("The keeper bites the coin.") : undefined,
 * );
 * ```
 */
export const giving = rulebook<Offer, Reaction>("giving", { kind: "decide" });

/**
 * How someone reacts to being shown something: the first rule to answer
 * decides, with {@link react}. With no answer, they glance at it, in the
 * `show.unmoved` message.
 */
export const showing = rulebook<Offer, Reaction>("showing", { kind: "decide" });

/**
 * What answers giving and showing when no rule in {@link giving} or
 * {@link showing} does, before the default refusal: topic entries. A
 * separate step, so a game's own rules always come first. @internal
 */
export const _givingTopics = rulebook<Offer, Reaction>("giving: topics", { kind: "decide" });
/** As {@link _givingTopics}, for showing. @internal */
export const _showingTopics = rulebook<Offer, Reaction>("showing: topics", { kind: "decide" });

/** Someone the player can give things to or show them: a body, not the player's own. */
const isSomeone = (t: ObjectRef): boolean => isBody(t) && t.id !== currentPlayerBody()?.id;
/** Something the player carries, which can be given or shown. */
const isCarried = (t: ObjectRef): boolean => {
  const body = currentPlayerBody();
  return isPortable(t) && body !== undefined && isWithin(t, body);
};

/** A reaction, as text the action reports, after doing what it says. */
const answer = (reaction: Reaction, offer: Offer, give: boolean): void => {
  if (give && reaction.takes) move(offer.thing, offer.to);
  reaction.then?.();
  reacted = typeof reaction.text === "function" ? reaction.text() : reaction.text;
};
/** What the last give or show reported, for its report. */
let reacted = "";

/** Gives something the actor carries to someone present, who reacts through {@link giving}. */
export const give = action<{ thing: ActingOn; to: ActingOn }>("give", {
  source: SOURCE,
  seen: ({ thing, to, body }) => (body ? message("give.seen", { actor: body, thing, to }) : ""),
  verbs: [
    "give {thing} to {to}",
    "give {to} {thing}",
    "offer {thing} to {to}",
    "hand {thing} to {to}",
  ],
  for: isCarried,
  with: { to: isSomeone },
  label: ({ thing, to }) => message("give.label", { thing, to }),
  verify: ({ thing, body }) =>
    body && isWithin(thing, body) ? undefined : message("drop.notHeld", { thing }),
  run: (c) => {
    const offer: Offer = {
      thing: c.thing,
      to: c.to,
      ...(c.actor && { actor: c.actor }),
      ...(c.body && { body: c.body }),
    };
    answer(
      giving.run(offer) ??
        _givingTopics.run(offer) ??
        // The player can't refuse what they're given; an NPC declines unless a rule says otherwise.
        (c.to.id === currentPlayerBody()?.id
          ? accept("")
          : react(message("give.declined", { thing: c.thing, to: c.to }))),
      offer,
      true,
    );
  },
  report: () => reacted,
});

/** Shows something the actor carries to someone present, who reacts through {@link showing}. */
export const show = action<{ thing: ActingOn; to: ActingOn }>("show", {
  source: SOURCE,
  seen: ({ thing, to, body }) => (body ? message("show.seen", { actor: body, thing, to }) : ""),
  verbs: ["show {thing} to {to}", "show {to} {thing}"],
  for: isCarried,
  with: { to: isSomeone },
  label: ({ thing, to }) => message("show.label", { thing, to }),
  verify: ({ thing, body }) =>
    body && isWithin(thing, body) ? undefined : message("drop.notHeld", { thing }),
  run: (c) => {
    const offer: Offer = {
      thing: c.thing,
      to: c.to,
      ...(c.actor && { actor: c.actor }),
      ...(c.body && { body: c.body }),
    };
    answer(
      showing.run(offer) ??
        _showingTopics.run(offer) ??
        (c.to.id === currentPlayerBody()?.id
          ? react("")
          : react(message("show.unmoved", { thing: c.thing, to: c.to }))),
      offer,
      false,
    );
  },
  report: () => reacted,
});

/** Opens something openable, unless it's locked. */
export const open = action<{ thing: ActingOn }>("open", {
  source: SOURCE,
  seen: ({ thing, body }) => (body ? message("open.seen", { actor: body, thing }) : ""),
  verbs: ["open {thing}"],
  for: isOpenable,
  label: ({ thing }) => message("open.label", { thing }),
  verify: ({ thing }) => (thing.isOpen === true ? message("open.already", { thing }) : undefined),
  check: ({ thing }) => (thing.isLocked === true ? message("open.locked", { thing }) : undefined),
  run: ({ thing }) => {
    thing.open?.();
  },
  report: ({ thing }) => message("open.done", { thing }),
});

/** Closes something openable. */
export const close = action<{ thing: ActingOn }>("close", {
  source: SOURCE,
  seen: ({ thing, body }) => (body ? message("close.seen", { actor: body, thing }) : ""),
  verbs: ["close {thing}", "shut {thing}"],
  for: isOpenable,
  label: ({ thing }) => message("close.label", { thing }),
  verify: ({ thing }) => (thing.isOpen === true ? undefined : message("close.already", { thing })),
  run: ({ thing }) => {
    thing.close?.();
  },
  report: ({ thing }) => message("close.done", { thing }),
});

/** Locks something lockable, with its key if it has one; it must be closed. */
export const lock = action<{ thing: ActingOn }>("lock", {
  source: SOURCE,
  seen: ({ thing, body }) => (body ? message("lock.seen", { actor: body, thing }) : ""),
  verbs: ["lock {thing}"],
  for: isLockable,
  label: ({ thing }) => message("lock.label", { thing }),
  verify: ({ thing }) => (thing.isLocked === true ? message("lock.already", { thing }) : undefined),
  check: ({ thing, body }) =>
    thing.isOpen === true ? message("lock.open", { thing }) : needsKey(thing, body),
  run: ({ thing }) => {
    thing.lock?.();
  },
  report: ({ thing }) => message("lock.done", { thing }),
});

/** Unlocks something lockable, with its key if it has one. */
export const unlock = action<{ thing: ActingOn }>("unlock", {
  source: SOURCE,
  seen: ({ thing, body }) => (body ? message("unlock.seen", { actor: body, thing }) : ""),
  verbs: ["unlock {thing}"],
  for: isLockable,
  label: ({ thing }) => message("unlock.label", { thing }),
  verify: ({ thing }) =>
    thing.isLocked === true ? undefined : message("unlock.notLocked", { thing }),
  check: ({ thing, body }) => needsKey(thing, body),
  run: ({ thing }) => {
    thing.unlock?.();
  },
  report: ({ thing }) => message("unlock.done", { thing }),
});
