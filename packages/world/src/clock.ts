/**
 * The game clock (#84, ADR 0049): in-world time, in minutes, and a count of
 * the player's moves.
 *
 * Time passes only when something says so: an action's `minutes`, an exit's
 * `minutes` or the game's `travelMinutes` when the player travels, or
 * `clock.advance(…)` from any code, even partway through an action. Both
 * the time and the moves are state, so undo, saves, and replays see them;
 * nothing reads the wall clock.
 */
import { hook, message, messages, object, StateError } from "@loominate-if/core";
import { textWidget, widgets } from "@loominate-if/presentation";
import { exitsOf } from "./exits.js";
import { fireMoves, firingNow, nextInMinutes } from "./schedule.js";
import type { Place } from "./things.js";

declare module "@loominate-if/core" {
  interface Messages {
    /** The time of day, as the clock widget shows it, such as "9:45 pm". */
    "clock.time": { readonly day: number; readonly hour: number; readonly minute: number };
    /** What the clock widget is, for screen readers. */
    "clock.label": Record<never, never>;
  }
  interface HookKinds {
    /** After the game clock moves on, with the minutes before and after. */
    clockAdvance: { readonly from: number; readonly to: number };
  }
}

const SOURCE = "@loominate-if/world";
const DAY = 24 * 60;

messages.register(
  "clock.time",
  ({ hour, minute }) =>
    `${String(hour % 12 === 0 ? 12 : hour % 12)}:${String(minute).padStart(2, "0")} ${hour < 12 ? "am" : "pm"}`,
  { source: SOURCE },
);

messages.register("clock.label", "Time", { source: SOURCE });

/** How a game's clock starts, for {@link startClock}. */
export type ClockStart = {
  /** The time of day the game begins, as `"HH:MM"` on a 24-hour clock. Defaults to `"00:00"`. */
  readonly at?: string;
  /** The day the game begins on. Defaults to 1. */
  readonly day?: number;
  /**
   * How many minutes going through an exit takes when the exit doesn't say.
   * Defaults to 0, so time passes only where an exit gives `minutes`.
   */
  readonly travelMinutes?: number;
};

/** When the game begins: authored, so not state. */
let start = { minuteOfDay: 0, day: 1, travelMinutes: 0 };
let started = false;

const state = object("world:clock", {
  /** Minutes since the game began. */
  elapsed: 0,
  /** Moves the player has made. */
  moves: 0,
  /** Minutes each exit without its own takes, once the game changes it. */
  travelMinutes: null as number | null,
});

const minutesError = (where: string, n: unknown): StateError =>
  new StateError(
    `${where}: ${String(n)} isn't a number of minutes. Give a whole number, 0 or more.`,
  );
const isMinutes = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0;

/**
 * Sets when the game begins, and how long travel takes. Call it once, in
 * `story.ts`.
 *
 * @example
 * ```ts
 * startClock({ at: "21:30", travelMinutes: 1 });
 * ```
 *
 * @throws StateError if it's called twice, or a time or number isn't valid.
 */
export function startClock(options: ClockStart): void {
  if (started) {
    throw new StateError(
      "startClock: the clock has already been started. Call startClock() once, in story.ts; change the time during play with clock.advance().",
    );
  }
  const at = options.at ?? "00:00";
  const match = /^(\d{1,2}):(\d{2})$/.exec(at);
  const hour = Number(match?.[1]);
  const minute = Number(match?.[2]);
  if (!match || hour > 23 || minute > 59) {
    throw new StateError(
      `startClock: ${JSON.stringify(at)} isn't a time of day. Write it as "HH:MM" on a 24-hour clock, such as "08:00" or "21:30".`,
    );
  }
  const day = options.day ?? 1;
  if (!Number.isInteger(day)) {
    throw new StateError(`startClock: day ${String(day)} isn't a whole number.`);
  }
  const travel = options.travelMinutes ?? 0;
  if (!isMinutes(travel)) throw minutesError("startClock travelMinutes", travel);
  start = { minuteOfDay: hour * 60 + minute, day, travelMinutes: travel };
  started = true;
}

/** The game clock: what time it is, how many moves have been made, and a way to move time on. */
export type Clock = {
  /** Minutes since the game began. */
  readonly minutes: number;
  /** The day it is, counting from the day the game began on. */
  readonly day: number;
  /** The hour of the day, 0 to 23. */
  readonly hour: number;
  /** The minute of the hour, 0 to 59. */
  readonly minute: number;
  /** How many moves the player has made: links followed, actions taken, and travel. Not undone moves. */
  readonly moves: number;
  /** How many minutes going through an exit that doesn't say takes. Set it to change it during play. */
  travelMinutes: number;
  /**
   * Moves time on by `minutes`. Call it in an effect or an action stage,
   * including partway through an action. It stops at each fuse and daemon
   * due on the way, firing each at its own time, and stops early where one
   * interrupts. It returns how far it got.
   *
   * @throws StateError if `minutes` isn't a whole number, 0 or more.
   */
  advance(minutes: number): Advanced;
  /**
   * Stops the clock's jump at this moment, as waking someone who sleeps.
   * Call it from a fuse or daemon as it fires; whatever else is due at the
   * same minute still fires.
   *
   * @throws StateError if the clock isn't moving on.
   */
  interrupt(): void;
};

/** How far {@link Clock.advance} moved the clock, and whether something stopped it. */
export type Advanced = {
  /** The minutes that passed: all that were asked for, unless it was interrupted. */
  readonly minutes: number;
  /** Whether a fuse or daemon stopped it early. */
  readonly interrupted: boolean;
  /** The ID of the fuse or daemon that stopped it, if one did. */
  readonly by?: string;
};

/** A jump of the clock in progress, and what interrupted it, if anything did. */
type Jump = { by?: string };
/** The jumps in progress, innermost last: a fuse can move the clock on as it fires. */
const jumps: Jump[] = [];

const at = (): number => start.minuteOfDay + state.elapsed;

/** Moves the clock on to `to`, if it's later, running the clockAdvance hook. */
const step = (to: number): void => {
  const from = state.elapsed;
  if (to <= from) return;
  state.elapsed = to;
  hook("clockAdvance").run({ from, to });
};

/** The game clock. */
export const clock: Clock = Object.freeze({
  get minutes() {
    return state.elapsed;
  },
  get day() {
    return start.day + Math.floor(at() / DAY);
  },
  get hour() {
    return Math.floor((at() % DAY) / 60);
  },
  get minute() {
    return at() % 60;
  },
  get moves() {
    return state.moves;
  },
  get travelMinutes() {
    return state.travelMinutes ?? start.travelMinutes;
  },
  set travelMinutes(n: number) {
    if (!isMinutes(n)) throw minutesError("clock.travelMinutes", n);
    state.travelMinutes = n;
  },
  advance(minutes: number): Advanced {
    if (!isMinutes(minutes)) throw minutesError("clock.advance", minutes);
    const from = state.elapsed;
    const target = from + minutes;
    const jump: Jump = {};
    jumps.push(jump);
    try {
      // Step to each fuse and daemon due on the way, so each fires at its own time.
      for (let next = nextInMinutes(target); next; next = nextInMinutes(target)) {
        step(next.at);
        if (next.fire()) jump.by ??= next.id;
        // Interrupted: what's due at this same minute still fires, but no later.
        if (jump.by !== undefined) {
          for (let now = nextInMinutes(state.elapsed); now; now = nextInMinutes(state.elapsed)) {
            now.fire();
          }
          return { minutes: state.elapsed - from, interrupted: true, by: jump.by };
        }
      }
      step(target);
      return { minutes, interrupted: false };
    } finally {
      jumps.pop();
    }
  },
  interrupt() {
    const jump = jumps.at(-1);
    if (!jump) {
      throw new StateError(
        "clock.interrupt: the clock isn't moving on now. Call it from a fuse or daemon as it fires, to stop the jump there.",
      );
    }
    jump.by ??= firingNow() ?? "clock.interrupt";
  },
});

/** The time of day now, worded through the message table, such as "9:45 pm". */
export function timeOfDay(): string {
  return message("clock.time", { day: clock.day, hour: clock.hour, minute: clock.minute });
}

/**
 * Moves time on for the player's travel from `from` to `to`: the first
 * exit between them's `minutes`, or the clock's `travelMinutes`. Rooms not
 * joined by an exit take no time. @internal
 */
export function travelled(from: Place, to: Place): void {
  const way = exitsOf(from).find((e) => e.to.id === to.id);
  if (way) clock.advance(way.minutes ?? clock.travelMinutes);
}

// Actions' time, through core's actionTime hook.
hook("actionTime").rule(
  "game clock",
  ({ minutes }) => {
    clock.advance(minutes);
  },
  { source: SOURCE },
);

// Every move counts, after it's made.
hook("turnEnd").rule(
  "move counter",
  () => {
    state.moves += 1;
    fireMoves();
  },
  { source: SOURCE },
);

/**
 * The clock widget: the time of day, such as "9:45 pm". It isn't shown
 * unless the game adds it, as with `addToHeader("clock")`.
 */
export const clockWidget = textWidget({
  text: timeOfDay,
  label: () => message("clock.label"),
  className: "loominate-clock",
});

widgets.register("clock", clockWidget, { source: SOURCE });
