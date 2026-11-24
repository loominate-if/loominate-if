/**
 * The world model's standard actions (#77, ADR 0046): examine, take, drop,
 * open, close, lock, and unlock, on the menus of the things they suit. Each
 * is an ordinary action, so a game changes one with its rules, such as
 * `take.check.rule(…)`, and words them through the message table.
 */
import { action, message, messages, t, type ObjectRef, type Text } from "@loominate-if/core";
import { isBody } from "./actors.js";
import { countOf, isStack, oneOf, split } from "./stacks.js";
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

/** Opens something openable, unless it's locked. */
export const open = action<{ thing: ActingOn }>("open", {
  source: SOURCE,
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
