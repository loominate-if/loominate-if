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
import type { DateSpec } from "./calendar.js";
import { exitsOf } from "./exits.js";
import { fireMoves, firingNow, holdNotices, nextInMinutes, tellHeld } from "./schedule.js";
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
   * The date the game begins on, for a calendar with months: `"1923-10-31"`,
   * or `{ year, month, date }` with the month by name. Defaults to 1 January
   * 2000 on the real calendar, or the first day of year 1 on one of the
   * game's own. See `useCalendar`.
   */
  readonly date?: string | DateSpec;
  /**
   * How many minutes going through an exit takes when the exit doesn't say.
   * Defaults to 0, so time passes only where an exit gives `minutes`.
   */
  readonly travelMinutes?: number;
};

/** Reads a time of day written `"HH:MM"` on a 24-hour clock. @internal */
export function parseTime(
  where: string,
  at: string,
): { readonly hour: number; readonly minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(at);
  const hour = Number(match?.[1]);
  const minute = Number(match?.[2]);
  if (!match || hour > 23 || minute > 59) {
    throw new StateError(
      `${where}: ${JSON.stringify(at)} isn't a time of day. Write it as "HH:MM" on a 24-hour clock, such as "08:00" or "21:30".`,
    );
  }
  return { hour, minute };
}

/** When the game begins: authored, so not state. */
let start: {
  minuteOfDay: number;
  day: number;
  travelMinutes: number;
  date?: string | DateSpec;
} = { minuteOfDay: 0, day: 1, travelMinutes: 0 };
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
  const { hour, minute } = parseTime("startClock", options.at ?? "00:00");
  const day = options.day ?? 1;
  if (!Number.isInteger(day)) {
    throw new StateError(`startClock: day ${String(day)} isn't a whole number.`);
  }
  const travel = options.travelMinutes ?? 0;
  if (!isMinutes(travel)) throw minutesError("startClock travelMinutes", travel);
  start = {
    minuteOfDay: hour * 60 + minute,
    day,
    travelMinutes: travel,
    ...(options.date !== undefined && { date: options.date }),
  };
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
  /** How many moves the player has made: links followed, actions taken, and travel, but not continues. Not undone moves. */
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
  advance(minutes: number, options?: AdvanceOptions): Advanced;
  /**
   * Stops the clock's jump at this moment, as waking someone who sleeps.
   * Call it from a fuse or daemon as it fires; whatever else is due at the
   * same minute still fires.
   *
   * @throws StateError if the clock isn't moving on.
   */
  interrupt(): void;
};

/** How many days after the game's first the day `minutes` into it is. @internal */
export function dayOffset(minutes: number): number {
  return Math.floor((start.minuteOfDay + minutes) / DAY);
}

/** The day number, as `clock.day` counts, of the day `minutes` into the game. @internal */
export function dayAt(minutes: number): number {
  return start.day + dayOffset(minutes);
}

/** The minute of the day, 0 to 1439, `minutes` into the game. @internal */
export function minuteOfDayAt(minutes: number): number {
  return (start.minuteOfDay + minutes) % DAY;
}

/** The date `startClock` was given, if any. @internal */
export function startDate(): string | DateSpec | undefined {
  return start.date;
}

/** How {@link Clock.advance} moves the clock on. */
export type AdvanceOptions = {
  /**
   * What may stop it partway, given the ID of the fuse or daemon that asks
   * to: `(by) => by === "bomb"` for a ride only an emergency stops, or
   * `() => false` for one nothing does. Defaults to anything. What it
   * doesn't stop for still fires, at its own time.
   */
  readonly stopsFor?: (by: string) => boolean;
  /**
   * What it waits for: checked each time a fuse or daemon fires, since only
   * that changes the world while time passes. When it holds, the advance
   * ends there, after what's due at that same minute.
   */
  readonly until?: () => boolean;
};

/** How far {@link Clock.advance} moved the clock, and whether something stopped it. */
export type Advanced = {
  /** The minutes that passed: all that were asked for, unless it was interrupted. */
  readonly minutes: number;
  /** Whether a fuse or daemon stopped it early. */
  readonly interrupted: boolean;
  /** The ID of the fuse or daemon that stopped it, if one did. */
  readonly by?: string;
  /** Whether it ended because its `until` held. */
  readonly reached?: boolean;
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
  advance(minutes: number, options: AdvanceOptions = {}): Advanced {
    if (!isMinutes(minutes)) throw minutesError("clock.advance", minutes);
    const stopsFor = options.stopsFor ?? (() => true);
    const from = state.elapsed;
    const target = from + minutes;
    const jump: Jump = {};
    jumps.push(jump);
    // What fuses and daemons say on the way is written up at the end, so repeats can be summed up.
    const holding = holdNotices();
    let done = false;
    try {
      // Step to each fuse and daemon due on the way, so each fires at its own time.
      for (let next = nextInMinutes(target); next; next = nextInMinutes(target)) {
        step(next.at);
        if (next.fire()) jump.by ??= next.id;
        // What this jump doesn't stop for fires, and is told, but time goes on.
        if (jump.by !== undefined && !stopsFor(jump.by)) delete jump.by;
        const reached = options.until?.() === true;
        // Interrupted, or what it waits for came: what's due at this same minute still fires, but no later.
        if (jump.by !== undefined || reached) {
          for (let now = nextInMinutes(state.elapsed); now; now = nextInMinutes(state.elapsed)) {
            now.fire();
          }
          done = true;
          return {
            minutes: state.elapsed - from,
            interrupted: jump.by !== undefined,
            ...(jump.by !== undefined && { by: jump.by }),
            ...(reached && { reached: true }),
          };
        }
      }
      step(target);
      done = true;
      return { minutes, interrupted: false };
    } finally {
      jumps.pop();
      if (holding) tellHeld(done ? jump.by : undefined);
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

/**
 * The time of day, worded through the message table, such as "9:45 pm":
 * now, or at `minutes` on the clock, such as a summary's `from`.
 */
export function timeOfDay(minutes?: number): string {
  if (minutes === undefined) {
    return message("clock.time", { day: clock.day, hour: clock.hour, minute: clock.minute });
  }
  if (!isMinutes(minutes)) throw minutesError("timeOfDay", minutes);
  const t = start.minuteOfDay + minutes;
  return message("clock.time", {
    day: start.day + Math.floor(t / DAY),
    hour: Math.floor((t % DAY) / 60),
    minute: t % 60,
  });
}

/**
 * Moves time on for the player's travel from `from` to `to`: the first
 * exit between them's `minutes`, or the clock's `travelMinutes`. Rooms not
 * joined by an exit take no time. Nothing stops it partway; what's due on
 * the way still fires. @internal
 */
export function travelled(from: Place, to: Place): void {
  const way = exitsOf(from).find((e) => e.to.id === to.id);
  // Travel isn't stopped partway: the player has already arrived (#304).
  if (way) clock.advance(way.minutes ?? clock.travelMinutes, { stopsFor: () => false });
}

// Actions' time, through core's actionTime hook.
hook("actionTime").rule(
  "game clock",
  ({ minutes, stopsFor }) => {
    clock.advance(minutes, stopsFor ? { stopsFor } : {});
  },
  { source: SOURCE },
);

// Every move counts, after it's made.
hook("turnEnd").rule(
  "move counter",
  ({ move }) => {
    // A continue only acknowledges what was read, so it isn't a move (#311).
    if (move === "continue") return;
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
  text: () => timeOfDay(),
  label: () => message("clock.label"),
  className: "loominate-clock",
});

widgets.register("clock", clockWidget, { source: SOURCE });
