/**
 * Fuses and daemons (#85, ADR 0050): code that runs at a time to come. A
 * fuse fires once, after a delay; a daemon fires again and again, every so
 * often. A delay is counted in the clock's minutes or the player's moves.
 *
 * Code can't be saved, so each is defined when the game loads, with an ID,
 * and only its timing is state: whether it's running, and when it's due.
 * Undo, saves, and replays restore that, and the inspector can list it.
 * What one returns is shown to the player with the move's notices.
 */
import {
  emit,
  message,
  messages,
  object,
  StateError,
  type Handle,
  type StateId,
  type Text,
} from "@loominate-if/core";
import { clock } from "./clock.js";

declare module "@loominate-if/core" {
  interface Messages {
    /**
     * What a fuse or daemon without a `summary` says when it fires more than
     * once in one jump of the clock, given its lines. Empty, the default,
     * keeps each line.
     */
    "schedule.repeated": {
      readonly source: string;
      readonly lines: readonly string[];
      readonly count: number;
    };
  }
}

messages.register("schedule.repeated", "", { source: "@loominate-if/world" });

/** How long until a fuse or daemon fires: in the clock's minutes, or in the player's moves. */
export type Delay = { readonly minutes: number } | { readonly moves: number };

const count = (where: string, n: number): number => {
  if (!Number.isInteger(n) || n < 1) {
    throw new StateError(`${where}: ${String(n)} isn't a whole number, 1 or more.`);
  }
  return n;
};

/** A delay of `n` minutes on the game clock. */
export function minutes(n: number): Delay {
  return { minutes: count("minutes", n) };
}

/** A delay of `n` of the player's moves. */
export function moves(n: number): Delay {
  return { moves: count("moves", n) };
}

/** What a fuse or daemon does when it fires: it may return what the player is told. */
export type Firing = () => string | Text | undefined;

/** When a fuse or daemon fired more than once in one jump of the clock, for its `summary`. */
export type Repeated = {
  /** How many times it fired. */
  readonly count: number;
  /** The clock's `minutes` when it first fired. */
  readonly from: number;
  /** The clock's `minutes` when it last fired. */
  readonly to: number;
  /** What it said each time, in order. */
  readonly lines: readonly string[];
};

/**
 * What a fuse or daemon says instead of its lines when it fires more than
 * once in one jump of the clock, such as "The church bells rang throughout
 * the night." Nothing, or empty, keeps each line.
 */
export type Summary = (repeated: Repeated) => string | Text | undefined;

/** What fuses and daemons have in common. */
export type Scheduled = {
  /** Its ID, unique among fuses and daemons. */
  readonly id: StateId;
  /** Whether it's waiting to fire. */
  readonly isRunning: boolean;
  /**
   * When it fires next, if it's running: the clock's `minutes`, or for a
   * delay in moves, the move count, as `unit` says.
   */
  readonly firesAt: number | undefined;
  /** What its delay counts. */
  readonly unit: "minutes" | "moves";
  /** Starts it, counting its delay from now. Starting it while it's running starts it over. */
  start(): void;
};

/** A fuse: fires once, after its delay, unless it's cancelled first. */
export type Fuse = Scheduled & {
  /** Stops it from firing. It can be started again. */
  cancel(): void;
};

/** A daemon: fires every time its delay passes, until it's stopped. */
export type Daemon = Scheduled & {
  /** Stops it from firing again. It can be started again. */
  stop(): void;
};

/** How {@link fuse} takes its timing. */
export type FuseOptions = {
  /** How long after it starts it fires, as in `minutes(30)` or `moves(3)`. */
  readonly after: Delay;
  /** Whether it starts when the game begins. Defaults to `false`: start it with `start()`. */
  readonly running?: boolean;
  /**
   * Whether firing stops a jump of the clock there, as waking someone who
   * sleeps. Its code can decide instead, with `clock.interrupt()`.
   * Defaults to `false`.
   */
  readonly interrupts?: boolean;
  /**
   * Which fires first when several are due at the same moment: higher
   * first. Defaults to 0; equal ones go in the order they were defined.
   */
  readonly priority?: number;
  /**
   * What to say instead of its lines when it fires more than once in one
   * jump of the clock, as a long sleep: "The church bells rang throughout
   * the night." Without it, the `schedule.repeated` message decides, which
   * by default keeps each line.
   */
  readonly summary?: Summary;
};

/** How {@link daemon} takes its timing. */
export type DaemonOptions = {
  /** How often it fires, as in `minutes(5)` or `moves(1)`. */
  readonly every: Delay;
  /** Whether it starts when the game begins. Defaults to `false`: start it with `start()`. */
  readonly running?: boolean;
  /**
   * Whether firing stops a jump of the clock there, as waking someone who
   * sleeps. Its code can decide instead, with `clock.interrupt()`.
   * Defaults to `false`.
   */
  readonly interrupts?: boolean;
  /**
   * Which fires first when several are due at the same moment: higher
   * first. Defaults to 0; equal ones go in the order they were defined.
   */
  readonly priority?: number;
  /**
   * What to say instead of its lines when it fires more than once in one
   * jump of the clock, as a long sleep: "The church bells rang throughout
   * the night." Without it, the `schedule.repeated` message decides, which
   * by default keeps each line.
   */
  readonly summary?: Summary;
};

type Timer = {
  readonly id: StateId;
  readonly order: number;
  readonly unit: "minutes" | "moves";
  readonly delay: number;
  readonly repeats: boolean;
  readonly interrupts: boolean;
  readonly priority: number;
  readonly summary: Summary | undefined;
  readonly fire: Firing;
  readonly state: Handle<{ running: boolean; due: number | null }>;
};

/** Every fuse and daemon, in the order they were defined, which breaks ties. */
const timers: Timer[] = [];

function define(
  kind: "fuse" | "daemon",
  id: StateId,
  delay: Delay,
  options: {
    readonly running?: boolean;
    readonly interrupts?: boolean;
    readonly priority?: number;
    readonly summary?: Summary;
  },
  fire: Firing,
): Timer {
  const running = options.running ?? false;
  const where = `${kind} ${JSON.stringify(id)}`;
  if (timers.some((t) => t.id === id)) {
    throw new StateError(`${where}: another fuse or daemon has this ID. Give each its own.`);
  }
  const priority = options.priority ?? 0;
  if (!Number.isFinite(priority)) {
    throw new StateError(`${where}: priority ${String(priority)} isn't a number.`);
  }
  if (typeof fire !== "function") {
    throw new StateError(`${where}: give it a function to run when it fires.`);
  }
  const unit = "minutes" in delay ? "minutes" : "moves";
  const n = count(where, "minutes" in delay ? delay.minutes : delay.moves);
  const timer: Timer = {
    id,
    order: timers.length,
    unit,
    delay: n,
    repeats: kind === "daemon",
    interrupts: options.interrupts ?? false,
    priority,
    summary: options.summary,
    fire,
    // Begun running, it's due its delay after the game begins.
    state: object(`world:${kind}:${id}`, {
      running,
      due: running ? n : (null as number | null),
    }),
  };
  timers.push(timer);
  return timer;
}

const now = (unit: Timer["unit"]): number => (unit === "minutes" ? clock.minutes : clock.moves);

function handle(t: Timer): Scheduled {
  return {
    id: t.id,
    unit: t.unit,
    get isRunning() {
      return t.state.running;
    },
    get firesAt() {
      return t.state.running ? (t.state.due ?? undefined) : undefined;
    },
    start() {
      t.state.running = true;
      t.state.due = now(t.unit) + t.delay;
    },
  };
}

const halt = (t: Timer): void => {
  t.state.running = false;
  t.state.due = null;
};

/**
 * Defines a fuse: `fire` runs once, its `after` delay after it's started.
 * What it returns is shown to the player with the move's notices. Define
 * it in `story.ts` or a module it imports, so it exists when a save loads.
 *
 * @example
 * ```ts
 * export const collapse = fuse("collapse", { after: minutes(30) }, () => {
 *   bridge.isStanding = false;
 *   return "Somewhere behind you, timber gives way with a roar.";
 * });
 * // in a passage: {on enter: collapse.start()}
 * ```
 *
 * @throws StateError if another fuse or daemon has the ID, or the delay isn't valid.
 */
export function fuse(id: StateId, options: FuseOptions, fire: Firing): Fuse {
  const t = define("fuse", id, options.after, options, fire);
  return Object.freeze(
    Object.defineProperties({ cancel: () => halt(t) }, Object.getOwnPropertyDescriptors(handle(t))),
  ) as Fuse;
}

/**
 * Defines a daemon: `fire` runs every `every`, once it's started, until
 * it's stopped. What it returns is shown to the player with the move's
 * notices.
 *
 * @example
 * ```ts
 * export const drip = daemon("drip", { every: moves(3), running: true }, () => "Water drips.");
 * ```
 *
 * @throws StateError if another fuse or daemon has the ID, or the delay isn't valid.
 */
export function daemon(id: StateId, options: DaemonOptions, fire: Firing): Daemon {
  const t = define("daemon", id, options.every, options, fire);
  return Object.freeze(
    Object.defineProperties({ stop: () => halt(t) }, Object.getOwnPropertyDescriptors(handle(t))),
  ) as Daemon;
}

/**
 * The running timer counted in `unit` due soonest, by `upTo`: of those due
 * at the same moment, the highest priority, then the first defined.
 */
function nextDue(unit: Timer["unit"], upTo: number): Timer | undefined {
  let best: Timer | undefined;
  for (const t of timers) {
    const due = t.state.due;
    if (t.unit !== unit || !t.state.running || due === null || due > upTo) continue;
    const bestDue = best?.state.due ?? Infinity;
    if (!best || due < bestDue || (due === bestDue && t.priority > best.priority)) best = t;
  }
  return best;
}

/** The fuse or daemon firing now, if one is. */
let firing: StateId | undefined;

/** The fuse or daemon firing now, for `clock.interrupt()` to name. @internal */
export function firingNow(): StateId | undefined {
  return firing;
}

/**
 * Fires `t`, rescheduling a daemon first so its code can stop it, and tells
 * the player what it said. Returns whether it interrupts, by its option.
 */
function fire(t: Timer): boolean {
  const due = t.state.due ?? now(t.unit);
  if (t.repeats) t.state.due = due + t.delay;
  else halt(t);
  const outer = firing;
  firing = t.id;
  let said: ReturnType<Firing>;
  try {
    said = t.fire();
  } finally {
    firing = outer;
  }
  const text = typeof said === "function" ? said() : said;
  if (typeof text === "string" && text !== "") {
    const told = { id: t.id, text, at: now(t.unit) };
    if (held) held.push(told);
    else emit("scheduled", { text, source: t.id });
  }
  return t.interrupts;
}

/** What fuses and daemons said during the jump in progress, held to be written up at its end. */
let held: { readonly id: StateId; readonly text: string; readonly at: number }[] | undefined;

/**
 * Starts holding what fuses and daemons say, for a jump of the clock.
 * Returns whether this call started it: a jump inside another's firing
 * leaves the outer one to write everything up. @internal
 */
export function holdNotices(): boolean {
  if (held) return false;
  held = [];
  return true;
}

/**
 * Writes up what was held, in the order it was said, except that a fuse or
 * daemon that spoke more than once and sums it up says its summary where it
 * first spoke, instead of its lines. The line of what interrupted the jump
 * is never summed up: it's why the jump ended. @internal
 */
export function tellHeld(interruptedBy: StateId | undefined): void {
  const told = held ?? [];
  held = undefined;
  const interruption =
    interruptedBy === undefined ? -1 : told.findLastIndex((e) => e.id === interruptedBy);
  const groups = new Map<StateId, (typeof told)[number][]>();
  told.forEach((e, i) => {
    if (i !== interruption) groups.set(e.id, [...(groups.get(e.id) ?? []), e]);
  });
  const summaries = new Map<StateId, string>();
  for (const [id, group] of groups) {
    if (group.length < 2) continue;
    const lines = group.map((e) => e.text);
    const t = timers.find((x) => x.id === id);
    const said = t?.summary
      ? t.summary({
          count: group.length,
          from: group[0]?.at ?? 0,
          to: group.at(-1)?.at ?? 0,
          lines,
        })
      : message("schedule.repeated", { source: id, lines, count: group.length });
    const text = typeof said === "function" ? said() : said;
    if (text !== undefined && text !== "") summaries.set(id, text);
  }
  const summed = new Set<StateId>();
  told.forEach((e, i) => {
    const summary = i === interruption ? undefined : summaries.get(e.id);
    if (summary === undefined) {
      emit("scheduled", { text: e.text, source: e.id });
    } else if (!summed.has(e.id)) {
      summed.add(e.id);
      emit("scheduled", { text: summary, source: e.id });
    }
  });
}

/**
 * The next timer due in minutes by `upTo`, with when it's due, for the
 * clock to step to. @internal
 */
export function nextInMinutes(
  upTo: number,
): { readonly at: number; readonly id: StateId; readonly fire: () => boolean } | undefined {
  const t = nextDue("minutes", upTo);
  if (!t || t.state.due === null) return undefined;
  return { at: t.state.due, id: t.id, fire: () => fire(t) };
}

/** Fires every timer counted in moves that's due now, in order. @internal */
export function fireMoves(): void {
  for (let t = nextDue("moves", clock.moves); t; t = nextDue("moves", clock.moves)) {
    fire(t);
  }
}
