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
  NameTaken,
  StateError,
  type Handle,
  type StateId,
  type Text,
} from "@loominate-if/core";
import { type CalendarQuery, matchesAt } from "./calendar.js";
import { clock, dayOffset, minuteOfDayAt, parseTime } from "./clock.js";
import "./listing.js"; // list.join, which joins a group's clauses

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

/** A delay of `n` days of game time: `n` times 24 hours. */
export function days(n: number): Delay {
  return { minutes: count("days", n) * 24 * 60 };
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

/**
 * A fuse's or daemon's part in a joined sentence when it fires more than
 * once in one jump of the clock, such as "the church bells rang".
 */
export type Clause = (repeated: Repeated) => string | Text;

/** How a group's joined sentence reads, given its clauses, for {@link sentence}. */
export type SentenceWording = (joined: {
  /** The clauses joined into a list by `list.join`: "the bells rang and an owl hooted". */
  readonly list: string;
  /** Each clause, in the order its fuse or daemon first spoke. */
  readonly clauses: readonly string[];
}) => string | Text;

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
  /**
   * Whether what it says stands out, in a paragraph of its own. Otherwise
   * it's atmosphere, which runs together with other fuses' and daemons' in
   * one paragraph. Defaults to `false`.
   */
  readonly standsOut?: boolean;
  /**
   * The group whose sentence it joins when it fires more than once in one
   * jump of the clock, with its `clause`, as `"outside"`. See {@link sentence}.
   * A joined sentence is atmosphere, even if this stands out.
   */
  readonly joins?: string;
  /** Its part in its group's sentence: "the church bells rang". */
  readonly clause?: Clause;
  /** The package that defines it, for the inspector, as in `source: "@my-scope/weather"`. Defaults to the game. */
  readonly source?: string;
};

/** How {@link daemon} takes its timing. */
export type DaemonOptions = {
  /** How often it fires, as in `minutes(5)` or `moves(1)`. Give this, or `at`. */
  readonly every?: Delay;
  /**
   * The time of day it fires, `"HH:MM"` on a 24-hour clock, every day or on
   * the days `on` says. Give this, or `every`. A function is asked each
   * time, for a time kept in state, such as a door's closing time.
   */
  readonly at?: string | (() => string);
  /**
   * With `at`, the days it fires on: weekdays, as `["tuesday", "thursday"]`,
   * or any calendar check, as `{ season: "summer" }` or `{ holiday: "harvest" }`.
   * Every day, if it doesn't say.
   */
  readonly on?: string | readonly string[] | CalendarQuery;
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
  /**
   * Whether what it says stands out, in a paragraph of its own. Otherwise
   * it's atmosphere, which runs together with other fuses' and daemons' in
   * one paragraph. Defaults to `false`.
   */
  readonly standsOut?: boolean;
  /**
   * The group whose sentence it joins when it fires more than once in one
   * jump of the clock, with its `clause`, as `"outside"`. See {@link sentence}.
   * A joined sentence is atmosphere, even if this stands out.
   */
  readonly joins?: string;
  /** Its part in its group's sentence: "the church bells rang". */
  readonly clause?: Clause;
  /** The package that defines it, for the inspector, as in `source: "@my-scope/weather"`. Defaults to the game. */
  readonly source?: string;
};

type Timer = {
  readonly id: StateId;
  readonly order: number;
  readonly unit: "minutes" | "moves";
  readonly delay: number;
  /** For a daemon at a time of day: when, and on which days. */
  readonly at:
    | { readonly text: string; readonly minuteOfDay: number; readonly on?: CalendarQuery }
    | undefined;
  readonly repeats: boolean;
  readonly interrupts: boolean;
  readonly priority: number;
  readonly summary: Summary | undefined;
  readonly standsOut: boolean;
  readonly joins: { readonly group: string; readonly clause: Clause } | undefined;
  readonly fire: Firing;
  readonly source: string;
  readonly state: Handle<{ running: boolean; due: number | null; ended: Ended | null }>;
};

/** How a fuse or daemon last stopped running: a fuse fired or was cancelled, or a daemon was stopped. */
export type Ended = "fired" | "cancelled" | "stopped";

/** Every fuse and daemon, in the order they were defined, which breaks ties. */
const timers: Timer[] = [];

function define(
  kind: "fuse" | "daemon",
  id: StateId,
  delay: Delay | undefined,
  options: {
    readonly at?: string | (() => string);
    readonly on?: string | readonly string[] | CalendarQuery;
    readonly running?: boolean;
    readonly interrupts?: boolean;
    readonly priority?: number;
    readonly summary?: Summary;
    readonly standsOut?: boolean;
    readonly joins?: string;
    readonly clause?: Clause;
    readonly source?: string;
  },
  fire: Firing,
): Timer {
  const running = options.running ?? false;
  const where = `${kind} ${JSON.stringify(id)}`;
  if (timers.some((t) => t.id === id)) {
    throw new NameTaken(`${where}: another fuse or daemon has this ID. Give each its own.`);
  }
  const priority = options.priority ?? 0;
  if (!Number.isFinite(priority)) {
    throw new StateError(`${where}: priority ${String(priority)} isn't a number.`);
  }
  if ((options.joins === undefined) !== (options.clause === undefined)) {
    throw new StateError(
      `${where}: give both \`joins\`, the group whose sentence it joins, and \`clause\`, its part in it, or neither.`,
    );
  }
  if (typeof fire !== "function") {
    throw new StateError(`${where}: give it a function to run when it fires.`);
  }
  if ((delay === undefined) === (options.at === undefined)) {
    throw new StateError(
      `${where}: give it \`every\`, as in every: minutes(15), or \`at\`, a time of day, as in at: "08:00", but not both.`,
    );
  }
  if (options.on !== undefined && options.at === undefined) {
    throw new StateError(
      `${where}: \`on\` says which days it fires at its \`at\` time; give it \`at\` too.`,
    );
  }
  const spec = options.at;
  if (typeof spec === "string") parseTime(where, spec);
  const on = options.on;
  const atText = (): string => (typeof spec === "function" ? spec() : (spec ?? ""));
  const at =
    spec === undefined
      ? undefined
      : {
          get text() {
            return atText();
          },
          get minuteOfDay() {
            const { hour, minute } = parseTime(where, atText());
            return hour * 60 + minute;
          },
          ...(on !== undefined && {
            on:
              typeof on === "string" || Array.isArray(on)
                ? { weekday: on as string | readonly string[] }
                : (on as CalendarQuery),
          }),
        };
  const unit = delay === undefined || "minutes" in delay ? "minutes" : "moves";
  const n =
    delay === undefined ? 0 : count(where, "minutes" in delay ? delay.minutes : delay.moves);
  const timer: Timer = {
    id,
    order: timers.length,
    unit,
    delay: n,
    at,
    repeats: kind === "daemon",
    interrupts: options.interrupts ?? false,
    priority,
    summary: options.summary,
    standsOut: options.standsOut ?? false,
    joins:
      options.joins !== undefined && options.clause !== undefined
        ? { group: options.joins, clause: options.clause }
        : undefined,
    fire,
    source: options.source ?? "game",
    // Begun running, it's due its delay after the game begins.
    // A daemon at a time of day works out its first firing when it's first needed, since the calendar may come later.
    state: object(`world:${kind}:${id}`, {
      running,
      due: running && at === undefined ? n : (null as number | null),
      ended: null as Ended | null,
    }),
  };
  timers.push(timer);
  return timer;
}

const now = (unit: Timer["unit"]): number => (unit === "minutes" ? clock.minutes : clock.moves);

/** The most days a daemon at a time of day looks ahead for a day it fires on. */
const LOOK_AHEAD = 4000;

/** When a daemon at a time of day next fires after `after`, or at it, with `inclusive`. */
function nextAt(t: Timer, after: number, inclusive: boolean): number {
  const at = t.at;
  if (!at) return after + t.delay;
  const startOfDay = (offset: number) => offset * 24 * 60 - minuteOfDayAt(0);
  const minuteOfDay = at.minuteOfDay;
  for (let d = dayOffset(Math.max(after, 0)); d < dayOffset(Math.max(after, 0)) + LOOK_AHEAD; d++) {
    const m = startOfDay(d) + minuteOfDay;
    if (m < after || (m === after && !inclusive)) continue;
    if (!at.on || matchesAt(at.on, m, `daemon ${JSON.stringify(t.id)} on`)) return m;
  }
  throw new StateError(
    `daemon ${JSON.stringify(t.id)}: no day in the next ${String(LOOK_AHEAD)} matches its \`on\`, so it would never fire.`,
  );
}

/**
 * When it's due: as stored, or, for a daemon at a time of day begun running
 * and not yet fired, its next time from now, so one added to a game later
 * doesn't fire for every day it missed.
 */
const dueOf = (t: Timer): number | null =>
  t.state.due ?? (t.state.running && t.at ? nextAt(t, clock.minutes, true) : null);

function handle(t: Timer): Scheduled {
  return {
    id: t.id,
    unit: t.unit,
    get isRunning() {
      return t.state.running;
    },
    get firesAt() {
      return t.state.running ? (dueOf(t) ?? undefined) : undefined;
    },
    start() {
      t.state.running = true;
      t.state.due = t.at ? nextAt(t, clock.minutes, false) : now(t.unit) + t.delay;
      t.state.ended = null;
    },
  };
}

const halt = (t: Timer, ended: Ended): void => {
  t.state.running = false;
  t.state.due = null;
  t.state.ended = ended;
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
    Object.defineProperties(
      { cancel: () => halt(t, "cancelled") },
      Object.getOwnPropertyDescriptors(handle(t)),
    ),
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
    Object.defineProperties(
      { stop: () => halt(t, "stopped") },
      Object.getOwnPropertyDescriptors(handle(t)),
    ),
  ) as Daemon;
}

/**
 * The running timer counted in `unit` due soonest, by `upTo`: of those due
 * at the same moment, the highest priority, then the first defined.
 */
function nextDue(unit: Timer["unit"], upTo: number): Timer | undefined {
  let best: Timer | undefined;
  let bestDue = Infinity;
  for (const t of timers) {
    if (t.unit !== unit || !t.state.running) continue;
    const due = dueOf(t);
    if (due === null || due > upTo) continue;
    if (!best || due < bestDue || (due === bestDue && t.priority > best.priority)) {
      best = t;
      bestDue = due;
    }
  }
  return best;
}

/**
 * How many times each fuse and daemon has fired since the game loaded: not
 * state, so only differences within one move mean anything.
 */
const fired = new Map<StateId, number>();

/** How many times the fuse or daemon `id` has fired since the game loaded, to tell if it fires during a wait. @internal */
export function timesFired(id: StateId): number {
  return fired.get(id) ?? 0;
}

/** The fuse or daemon with this ID, if there is one. @internal */
export function scheduledById(id: StateId): Scheduled | undefined {
  const t = timers.find((x) => x.id === id);
  return t ? handle(t) : undefined;
}

/** What's told after any fuse or daemon fires, such as scenes checking their conditions. */
const afterFiring: (() => void)[] = [];

/** Calls `listener` after any fuse or daemon fires. @internal */
export function onFired(listener: () => void): void {
  afterFiring.push(listener);
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
  fired.set(t.id, (fired.get(t.id) ?? 0) + 1);
  const due = dueOf(t) ?? now(t.unit);
  if (t.repeats) t.state.due = t.at ? nextAt(t, due, false) : due + t.delay;
  else halt(t, "fired");
  const outer = firing;
  firing = t.id;
  let said: ReturnType<Firing>;
  try {
    said = t.fire();
  } finally {
    firing = outer;
  }
  for (const listener of afterFiring) listener();
  const text = typeof said === "function" ? said() : said;
  if (typeof text === "string" && text !== "") {
    const told = { id: t.id, text, at: now(t.unit) };
    if (held) held.push(told);
    else tell(text, t.id, t.standsOut);
  }
  return t.interrupts;
}

/** Records what a fuse or daemon said, marked if it stands out. */
const tell = (text: string, source: StateId, standsOut: boolean): void => {
  emit("scheduled", { text, source, ...(standsOut && { standsOut: true }) });
};

const sentences = new Map<string, SentenceWording>();

/**
 * Says how a group's joined sentence reads. Fuses and daemons join a group
 * with `joins` and a `clause`. Without a wording, a group's sentence is its
 * clauses joined, and capitalised.
 *
 * @example
 * ```ts
 * sentence("outside", ({ list }) => `Outside, ${list} through the night.`);
 * ```
 *
 * @throws StateError if the group already has a wording.
 */
export function sentence(group: string, wording: SentenceWording): void {
  if (sentences.has(group)) {
    throw new NameTaken(
      `sentence ${JSON.stringify(group)}: this group's sentence already has a wording. Give it one.`,
    );
  }
  sentences.set(group, wording);
}

const capitalised = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
const words = (said: string | Text): string => (typeof said === "function" ? said() : said);

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
  const byTimer = new Map<StateId, (typeof told)[number][]>();
  told.forEach((e, i) => {
    if (i !== interruption) byTimer.set(e.id, [...(byTimer.get(e.id) ?? []), e]);
  });
  // What each repeated timer says instead of its lines: a clause for its group's sentence, or a summary.
  const clauses = new Map<string, string[]>();
  const groupOf = new Map<StateId, string>();
  const summaries = new Map<StateId, string>();
  for (const [id, group] of byTimer) {
    if (group.length < 2) continue;
    const t = timers.find((x) => x.id === id);
    const lines = group.map((e) => e.text);
    const repeated: Repeated = {
      count: group.length,
      from: group[0]?.at ?? 0,
      to: group.at(-1)?.at ?? 0,
      lines,
    };
    if (t?.joins) {
      const clause = words(t.joins.clause(repeated));
      if (clause !== "") {
        clauses.set(t.joins.group, [...(clauses.get(t.joins.group) ?? []), clause]);
        groupOf.set(id, t.joins.group);
        continue;
      }
    }
    const said = t?.summary
      ? t.summary(repeated)
      : message("schedule.repeated", { source: id, lines, count: group.length });
    const text = said === undefined ? "" : words(said);
    if (text !== "") summaries.set(id, text);
  }
  const standsOut = (id: StateId): boolean => timers.find((x) => x.id === id)?.standsOut ?? false;
  const done = new Set<string>();
  told.forEach((e, i) => {
    if (i === interruption) {
      tell(e.text, e.id, true); // why the jump ended
      return;
    }
    const group = groupOf.get(e.id);
    if (group !== undefined) {
      // A group's sentence goes where its first member first spoke.
      if (done.has(`group:${group}`)) return;
      done.add(`group:${group}`);
      const list = clauses.get(group) ?? [];
      const wording = sentences.get(group);
      const joined = message("list.join", { items: list });
      const text = wording
        ? words(wording({ list: joined, clauses: list }))
        : `${capitalised(joined)}.`;
      tell(text, e.id, false); // joined sentences are atmosphere
      return;
    }
    const summary = summaries.get(e.id);
    if (summary === undefined) {
      tell(e.text, e.id, standsOut(e.id));
    } else if (!done.has(e.id)) {
      done.add(e.id);
      tell(summary, e.id, standsOut(e.id));
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
  const due = t ? dueOf(t) : null;
  if (!t || due === null) return undefined;
  return { at: due, id: t.id, fire: () => fire(t) };
}

/** Fires every timer counted in moves that's due now, in order. @internal */
export function fireMoves(): void {
  for (let t = nextDue("moves", clock.moves); t; t = nextDue("moves", clock.moves)) {
    fire(t);
  }
}

/** A fuse or daemon as the inspector lists it. @internal */
export type _ScheduledInfo = Scheduled & {
  readonly kind: "fuse" | "daemon";
  readonly delay: number;
  /** For a daemon at a time of day: its time, and which days, described. */
  readonly at: string | undefined;
  readonly on: string | undefined;
  readonly priority: number;
  readonly interrupts: boolean;
  readonly standsOut: boolean;
  readonly joins: string | undefined;
  readonly source: string;
  readonly ended: Ended | undefined;
};

/** Every fuse and daemon, in the order they were defined, for the inspector. @internal */
export function _scheduled(): readonly _ScheduledInfo[] {
  return timers.map((t) => {
    const h = handle(t);
    return {
      id: t.id,
      unit: t.unit,
      isRunning: h.isRunning,
      firesAt: h.firesAt,
      start: h.start,
      kind: t.repeats ? "daemon" : "fuse",
      delay: t.delay,
      at: t.at?.text,
      on: t.at?.on === undefined ? undefined : describeOn(t.at.on),
      priority: t.priority,
      interrupts: t.interrupts,
      standsOut: t.standsOut,
      joins: t.joins?.group,
      source: t.source,
      ended: t.state.ended ?? undefined,
    };
  });
}

/** A calendar check, described for the inspector: "tuesday, thursday", or "season summer". */
function describeOn(q: CalendarQuery): string {
  const part = (v: string | readonly string[] | undefined) =>
    v === undefined ? [] : typeof v === "string" ? [v] : [...v];
  return [
    ...part(q.weekday),
    ...part(q.month).map((m) => `in ${m}`),
    ...part(q.season).map((x) => `in ${x}`),
    ...part(q.holiday).map((h) => `on ${h}`),
  ].join(", ");
}
