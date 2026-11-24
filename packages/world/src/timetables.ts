/**
 * Scheduled NPCs (#105, ADR 0085): a timetable of where an NPC is, from
 * what time, on which days. Where they are is worked out from the clock
 * whenever it matters, with no step-by-step simulation, so they're in the
 * right place after any jump in time. An agenda item they're busy with
 * holds them; afterwards they go where the timetable says by then.
 */
import { emit, hook, StateError, type ObjectRef } from "@loominate-if/core";
import { bodyOf, mindFor } from "./actors.js";
import { _busyWithAgenda } from "./agendas.js";
import { _isAccompanying } from "./companions.js";
import { playerPerceives } from "./npcs.js";
import { matchesAt, type CalendarQuery } from "./calendar.js";
import { clock, dayOffset, minuteOfDayAt, parseTime } from "./clock.js";
import { isPlace, move, placeOf, thingFor } from "./things.js";

/** One entry in a timetable: from a time of day, they're in a place, on the days it says. */
export type TimetableEntry = {
  /** From when, as "HH:MM" on a 24-hour clock. */
  readonly at: string;
  /** Where they are from then. */
  readonly in: ObjectRef;
  /** Which days, as the calendar's query: `{ weekday: ["tuesday", "thursday"] }`. Every day, if it doesn't say. */
  readonly on?: CalendarQuery;
};

type Entry = {
  readonly minuteOfDay: number;
  readonly in: ObjectRef;
  readonly on?: CalendarQuery;
  readonly order: number;
};

/** Each scheduled NPC's timetable, by mind ID, latest time of day first. */
const timetables = new Map<
  string,
  { readonly npc: ObjectRef; readonly entries: readonly Entry[] }
>();

/** How many days back a timetable looks for the entry they're in. */
const LOOK_BACK = 400;

/**
 * Gives an NPC a timetable, in `story.ts`. Where they are is the latest
 * entry that's begun, on a day its `on` matches, working back across days.
 * Among entries at the same time, the first listed that applies wins, so a
 * general entry can follow particular ones.
 *
 * @example
 * ```ts
 * schedule(baker, [
 *   { at: "05:30", in: bakery },
 *   { at: "13:00", in: market, on: { weekday: ["tuesday", "thursday"] } },
 *   { at: "13:00", in: bakery },
 *   { at: "20:00", in: home },
 * ]);
 * ```
 *
 * @throws StateError if an entry's time isn't "HH:MM", its place isn't a place, or the NPC already has a timetable.
 */
export function schedule(npc: ObjectRef, entries: readonly TimetableEntry[]): void {
  const mind = mindFor(npc, "schedule");
  const where = `schedule ${JSON.stringify(mind.id)}`;
  if (timetables.has(mind.id)) throw new StateError(`${where}: this NPC already has a timetable.`);
  if (entries.length === 0) throw new StateError(`${where}: give at least one entry.`);
  const parsed = entries.map((e, order): Entry => {
    if (!isPlace(e.in)) {
      throw new StateError(
        `${where}: ${JSON.stringify(e.in.id)} isn't a place. An entry says which place they're in.`,
      );
    }
    const { hour, minute } = parseTime(where, e.at);
    return { minuteOfDay: hour * 60 + minute, in: e.in, ...(e.on && { on: e.on }), order };
  });
  parsed.sort((a, b) => b.minuteOfDay - a.minuteOfDay || a.order - b.order);
  timetables.set(mind.id, { npc, entries: parsed });
}

/**
 * Where an NPC's timetable puts them at `minutes` into the game (now, if not
 * given), or `undefined` if they have no timetable or no entry has begun.
 */
export function whereScheduled(npc: ObjectRef, minutes = clock.minutes): ObjectRef | undefined {
  const table = timetables.get(mindFor(npc, "whereScheduled").id);
  if (!table) return undefined;
  const today = dayOffset(minutes);
  const startOfDay = (offset: number) => offset * 24 * 60 - minuteOfDayAt(0);
  for (let d = today; d > today - LOOK_BACK; d--) {
    for (const e of table.entries) {
      const m = startOfDay(d) + e.minuteOfDay;
      if (m > minutes) continue;
      if (!e.on || matchesAt(e.on, m, `schedule ${JSON.stringify(table.npc.id)} on`)) return e.in;
    }
  }
  return undefined;
}

/** A timetable entry as the inspector shows it: its time, place, and days. */
type ShownEntry = { readonly at: string; readonly in: string; readonly on?: string };
const shown = (e: Entry): ShownEntry => ({
  at: `${String(Math.floor(e.minuteOfDay / 60)).padStart(2, "0")}:${String(e.minuteOfDay % 60).padStart(2, "0")}`,
  in: e.in.id,
  ...(e.on && {
    on: Object.entries(e.on)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
      .join("; "),
  }),
});

/**
 * An NPC's timetable as the inspector shows it: the entry they're in now,
 * and the next one to begin, with when, or `undefined` if they have none. @internal
 */
export function _timetableOf(
  npc: ObjectRef,
):
  | { readonly now?: ShownEntry; readonly next?: ShownEntry & { readonly minutes: number } }
  | undefined {
  const table = timetables.get(mindFor(npc, "timetable").id);
  if (!table) return undefined;
  const minutes = clock.minutes;
  const startOfDay = (offset: number) => offset * 24 * 60 - minuteOfDayAt(0);
  const today = dayOffset(minutes);
  let now: ShownEntry | undefined;
  find: for (let d = today; d > today - LOOK_BACK; d--) {
    for (const e of table.entries) {
      const m = startOfDay(d) + e.minuteOfDay;
      if (m > minutes) continue;
      if (!e.on || matchesAt(e.on, m, "timetable")) {
        now = shown(e);
        break find;
      }
    }
  }
  // The next entry to begin: the earliest after now that applies on its day.
  const ascending = [...table.entries].sort(
    (a, b) => a.minuteOfDay - b.minuteOfDay || a.order - b.order,
  );
  for (let d = today; d < today + LOOK_BACK; d++) {
    for (const e of ascending) {
      const m = startOfDay(d) + e.minuteOfDay;
      if (m <= minutes) continue;
      if (!e.on || matchesAt(e.on, m, "timetable")) {
        return { ...(now && { now }), next: { ...shown(e), minutes: m } };
      }
    }
  }
  return now ? { now } : {};
}

/** Puts each scheduled NPC where their timetable says, unless an agenda item holds them. */
function place(narrated: boolean): void {
  for (const [, { npc }] of [...timetables].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const mind = mindFor(npc, "schedule");
    // An agenda item, or going along with the player as a companion, holds them.
    if (_busyWithAgenda(mind) || _isAccompanying(mind)) continue;
    const body = bodyOf(mind);
    const target = whereScheduled(npc);
    if (!body || !target || placeOf(body)?.id === target.id) continue;
    if (narrated) {
      const perceived = playerPerceives(body);
      move(body, target);
      emit("npc", {
        npc: mind.id,
        what: "moved",
        at: clock.minutes,
        perceived: perceived || playerPerceives(body),
        to: target.id,
      });
    } else {
      // At the start, they're simply there: nobody saw them arrive.
      const thing = thingFor(body) as { location: ObjectRef | null } | undefined;
      if (thing) thing.location = target;
    }
  }
}

const SOURCE = "@loominate-if/world";
hook("gameStart").rule(
  "scheduled npcs placed",
  () => {
    place(false);
  },
  { source: SOURCE },
);
// After each move, before NPCs take their turns, and whenever the clock jumps.
hook("turnEnd").rule(
  "scheduled npcs",
  () => {
    place(true);
  },
  { source: SOURCE, before: "npc turns" },
);
hook("clockAdvance").rule(
  "scheduled npcs",
  () => {
    place(true);
  },
  { source: SOURCE },
);
