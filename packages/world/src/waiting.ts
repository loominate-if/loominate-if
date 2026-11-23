/**
 * Waiting (#87, ADR 0054): standard actions that let time pass, for a
 * number of minutes or until something: a time of day, a fuse or daemon
 * firing, or a named condition. A wait is passive, so anything that asks
 * to interrupt stops it. An opt-in Wait menu in the header lists the
 * waits a game offers.
 */
import { action, message, messages, StateError } from "@loominate-if/core";
import { addToHeader, menuWidget, widgets, type MenuChoice } from "@loominate-if/presentation";
import { clock, parseTime, timeOfDay, type Advanced } from "./clock.js";
import { scheduledById, timesFired } from "./schedule.js";

declare module "@loominate-if/core" {
  interface Messages {
    /** A wait's label: "Wait 10 minutes". */
    "wait.label": { readonly minutes: number };
    /** A wait-until's label: "Wait until 6:00 am", given what it waits for, worded. */
    "waitUntil.label": { readonly what: string };
    /** After a wait that ran its course: "You wait 10 minutes." */
    "wait.done": { readonly minutes: number; readonly time: string };
    /** After a wait until a time of day, when it came: "You wait until 6:00 am." */
    "waitUntil.done": { readonly time: string };
    /** After a wait until a fuse or daemon fired, or a condition held: how long it took, "You wait fifteen minutes." */
    "waitUntil.came": { readonly minutes: number; readonly time: string };
    /** After a wait something interrupted: "Your wait ends at 3:00 am." */
    "wait.interrupted": { readonly time: string };
    /** After a wait-until that waited as long as it would: "You give up waiting at 7:00 am." */
    "waitUntil.gaveUp": { readonly time: string };
    /** Why waiting until a time isn't offered when it's that time now. */
    "waitUntil.now": { readonly what: string };
    /** Why waiting for a fuse or daemon isn't offered when it isn't running. */
    "waitUntil.notComing": { readonly what: string };
    /** Why waiting for a condition isn't offered when it already holds. */
    "waitUntil.holds": { readonly what: string };
    /** The Wait menu's button. */
    "wait.menu": Record<never, never>;
  }
}

const SOURCE = "@loominate-if/world";
const say: typeof messages.register = (key, text) => {
  messages.register(key, text, { source: SOURCE });
};
const minutesWords = (n: number): string =>
  n === 1 ? "a minute" : `${message("number.words", { count: n })} minutes`;
say("wait.label", ({ minutes }) =>
  minutes === 1 ? "Wait a minute" : `Wait ${String(minutes)} minutes`,
);
say("waitUntil.label", ({ what }) => `Wait until ${what}`);
say("wait.done", ({ minutes }) => `You wait ${minutesWords(minutes)}.`);
say("waitUntil.done", ({ time }) => `You wait until ${time}.`);
say("waitUntil.came", ({ minutes }) => `You wait ${minutesWords(minutes)}.`);
say("wait.interrupted", ({ time }) => `Your wait ends at ${time}.`);
say("waitUntil.gaveUp", ({ time }) => `You give up waiting at ${time}.`);
say("waitUntil.now", ({ what }) => `It's ${what} now.`);
say("waitUntil.notComing", () => "There's nothing to wait for.");
say("waitUntil.holds", () => "There's no need to wait.");
say("wait.menu", "Wait");

const conditions = new Map<string, () => boolean>();

/**
 * Names a condition a player can wait for, as in
 * `waitUntil({ condition: "shop opens" })`. Define it when the game loads,
 * as with fuses: an action's arguments go into replays, so they name the
 * condition rather than hold it.
 *
 * @example
 * ```ts
 * waitCondition("shop opens", () => shop.isOpen);
 * ```
 *
 * @throws StateError if another condition has the name.
 */
export function waitCondition(name: string, holds: () => boolean): void {
  if (conditions.has(name)) {
    throw new StateError(
      `waitCondition ${JSON.stringify(name)}: another condition has this name. Give each its own.`,
    );
  }
  conditions.set(name, holds);
}

const whole = (where: string, n: unknown): number => {
  if (!Number.isInteger(n) || (n as number) < 1) {
    throw new StateError(`${where}: ${String(n)} isn't a whole number of minutes, 1 or more.`);
  }
  return n as number;
};

/** What the last wait came to, from its action stage for its report. */
let last:
  { readonly advanced: Advanced; readonly until: "minutes" | "time" | "something" } | undefined;

const told = (): string => {
  const done = last;
  last = undefined;
  if (!done) return "";
  const time = timeOfDay();
  const minutes = done.advanced.minutes;
  if (done.advanced.reached === true) {
    // Waiting for a time, the time is the news; waiting for something, how long it took is.
    return done.until === "time"
      ? message("waitUntil.done", { time })
      : message("waitUntil.came", { minutes, time });
  }
  if (done.advanced.interrupted) return message("wait.interrupted", { time });
  return done.until === "minutes"
    ? message("wait.done", { minutes, time })
    : message("waitUntil.gaveUp", { time });
};

/** Waits a number of minutes, unless something interrupts. */
export const wait = action<{ readonly minutes: number }>("wait", {
  source: SOURCE,
  label: ({ minutes }) => message("wait.label", { minutes }),
  verify: ({ minutes }) => {
    whole("wait", minutes);
    return undefined;
  },
  run: ({ minutes }) => {
    last = { advanced: clock.advance(minutes), until: "minutes" };
  },
  report: told,
});

/** What {@link waitUntil} waits for: one of a time of day, a fuse or daemon firing, or a condition. */
export type WaitUntil = {
  /** A time of day, `"HH:MM"` on a 24-hour clock: the next time it comes, today or tomorrow. */
  readonly time?: string;
  /** The ID of a fuse or daemon: until it next fires. */
  readonly fires?: string;
  /** The name of a condition from {@link waitCondition}: until it holds. */
  readonly condition?: string;
  /** For `fires` and `condition`: the most minutes to wait before giving up. Defaults to a day. */
  readonly atMost?: number;
};

/** How a wait-until goes: how far it may wait, what it waits for, and how it's named. */
function planOf(w: WaitUntil): {
  readonly minutes: number;
  readonly what: string;
  readonly until?: () => boolean;
  readonly notOffered?: string;
} {
  const where = "waitUntil";
  const given = [w.time, w.fires, w.condition].filter((x) => x !== undefined).length;
  if (given !== 1) {
    throw new StateError(
      `${where}: give exactly one of \`time\`, \`fires\`, or \`condition\`, as in waitUntil({ time: "06:00" }).`,
    );
  }
  if (w.time !== undefined) {
    const { hour, minute } = parseTime(where, w.time);
    const what = message("clock.time", { day: clock.day, hour, minute });
    const minutes = (hour * 60 + minute - (clock.hour * 60 + clock.minute) + 24 * 60) % (24 * 60);
    return minutes === 0
      ? { minutes, what, notOffered: message("waitUntil.now", { what }) }
      : { minutes, what };
  }
  const atMost = w.atMost === undefined ? 24 * 60 : whole(`${where} atMost`, w.atMost);
  if (w.fires !== undefined) {
    const id = w.fires;
    const timer = scheduledById(id);
    if (!timer) {
      throw new StateError(
        `${where}: there's no fuse or daemon ${JSON.stringify(id)}. Check the ID it was defined with.`,
      );
    }
    if (!timer.isRunning)
      return {
        minutes: atMost,
        what: id,
        notOffered: message("waitUntil.notComing", { what: id }),
      };
    const before = timesFired(id);
    return { minutes: atMost, what: id, until: () => timesFired(id) > before };
  }
  const name = w.condition ?? "";
  const holds = conditions.get(name);
  if (!holds) {
    throw new StateError(
      `${where}: there's no condition ${JSON.stringify(name)}. Name it with waitCondition() when the game loads.`,
    );
  }
  if (holds())
    return { minutes: atMost, what: name, notOffered: message("waitUntil.holds", { what: name }) };
  return { minutes: atMost, what: name, until: holds };
}

/**
 * Waits until a time of day, a fuse or daemon fires, or a condition holds,
 * unless something interrupts first. It isn't offered when there's
 * nothing to wait for.
 */
export const waitUntil = action<WaitUntil>("waitUntil", {
  source: SOURCE,
  label: (w) => message("waitUntil.label", { what: planOf(w).what }),
  verify: (w) => planOf(w).notOffered,
  run: (w) => {
    const plan = planOf(w);
    const advanced = clock.advance(plan.minutes, plan.until ? { until: plan.until } : {});
    // Waiting until a time succeeds when it runs its course.
    const reached = plan.until === undefined && !advanced.interrupted;
    last = {
      advanced: reached ? { ...advanced, reached } : advanced,
      until: plan.until === undefined ? "time" : "something",
    };
  },
  report: told,
});

/**
 * Adds a Wait menu to the page's header, listing the waits a game offers,
 * each with the label given or its own. Call it once, in `story.ts`.
 *
 * @example
 * ```ts
 * waitMenu([
 *   { call: wait({ minutes: 10 }) },
 *   { call: waitUntil({ time: "06:00" }), label: "Wait until dawn" },
 * ]);
 * ```
 */
export function waitMenu(choices: readonly MenuChoice[] | (() => readonly MenuChoice[])): void {
  const list = typeof choices === "function" ? choices : () => choices;
  widgets.register("wait", menuWidget({ label: () => message("wait.menu"), choices: list }), {
    source: SOURCE,
  });
  addToHeader("wait");
}
