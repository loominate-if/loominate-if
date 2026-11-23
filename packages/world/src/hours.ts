/**
 * Opening hours (#89, ADR 0058): a door or other obstacle that's only open
 * at certain times, on certain days. Outside them it blocks its exit with
 * its reason, as a locked door does: "The bakery is closed until 9:00 am
 * tomorrow." The hours are state, so a game can change them during play.
 */
import { message, messages, mixin, StateError, t, type ObjectRef } from "@loominate-if/core";
import { matchesAt, weekdayNameAt, type CalendarQuery } from "./calendar.js";
import { clock, dayOffset, minuteOfDayAt, parseTime, timeOfDay, withinDay } from "./clock.js";
import { thingFor } from "./things.js";

declare module "@loominate-if/core" {
  interface Messages {
    /**
     * Why an exit is blocked outside its opening hours: "The bakery is
     * closed until 9:00 am tomorrow." `opens` is when it next opens, and
     * `when` the day, if not today: "tomorrow", or "on Monday". Without
     * `opens`, it isn't opening again soon.
     */
    "hours.closed": {
      readonly place: ObjectRef;
      readonly opens?: string;
      readonly when?: string;
    };
    /** The day it next opens, when that isn't today or tomorrow: "on Monday". */
    "hours.onDay": { readonly weekday: string };
  }
}

const SOURCE = "@loominate-if/world";
messages.register(
  "hours.closed",
  ({ place, opens, when }) =>
    opens === undefined
      ? t`{The subj place} {is} closed.`({ place })
      : t`{The subj place} {is} closed until ${opens}${when === undefined ? "" : ` ${when}`}.`({
          place,
        }),
  { source: SOURCE },
);
messages.register("hours.onDay", ({ weekday }) => `on ${weekday}`, { source: SOURCE });

/** When something is open, for {@link openingHours}. */
export type Hours = {
  /**
   * The place whose hours they are: the way into it is closed outside them.
   * The way out never is, so someone inside at closing time can leave.
   */
  readonly of: ObjectRef;
  /** When it opens, `"HH:MM"` on a 24-hour clock. */
  readonly open: string;
  /** When it closes. If it's earlier than `open`, it closes after midnight, on the next day. */
  readonly close: string;
  /**
   * The days it opens on: weekdays, as `["monday", "tuesday"]`, or any
   * calendar check, as `{ season: "summer" }`. Every day, if it doesn't say.
   */
  readonly on?: string | readonly string[] | CalendarQuery;
};

/**
 * Opening hours as a thing keeps them, in state: `of` is the place they're
 * for, and `on` a calendar check, or `null` for every day.
 */
export type StoredHours = { of: ObjectRef; open: string; close: string; on: CalendarQuery | null };
type Stored = StoredHours;

const toQuery = (on: Hours["on"]): CalendarQuery | null =>
  on === undefined
    ? null
    : typeof on === "string" || Array.isArray(on)
      ? { weekday: on as string | readonly string[] }
      : (on as CalendarQuery);

/**
 * Opening hours for a door or other obstacle on an exit: outside them, it
 * blocks the way into the place `of` names with why, before its own
 * `blocks` is asked. The way out is never closed by its hours. Spread it
 * into the thing, beside `door` or `obstacle`. Change `hours` during play
 * to change them.
 *
 * @example
 * ```ts
 * export const bakeryDoor = thing("bakeryDoor", {
 *   ...door,
 *   ...openingHours({ of: bakery, open: "09:00", close: "17:00", on: ["monday", "tuesday", "wednesday", "thursday", "friday"] }),
 *   name: "bakery door",
 * });
 * ```
 *
 * @throws StateError if a time isn't valid.
 */
export function openingHours(hours: Hours): { hours: StoredHours } {
  if (typeof (hours.of as ObjectRef | undefined)?.id !== "string") {
    throw new StateError(
      'openingHours: say whose hours they are with `of`, the place they close, as in openingHours({ of: bakery, open: "09:00", close: "17:00" }). The way into it closes outside them; the way out never does.',
    );
  }
  parseTime("openingHours open", hours.open);
  parseTime("openingHours close", hours.close);
  return mixin({
    hours: {
      of: hours.of,
      open: hours.open,
      close: hours.close,
      on: toQuery(hours.on),
    } as Stored,
  });
}

const minuteOf = (where: string, at: string): number => {
  const { hour, minute } = parseTime(where, at);
  return hour * 60 + minute;
};

/** The opening hours a thing has, if it has any. @internal */
export const hoursOf = (thing: ObjectRef): Stored | undefined => {
  const h = (thingFor(thing) as { hours?: Stored } | undefined)?.hours;
  return h && typeof h.open === "string" ? h : undefined;
};

/** Whether `h` is open `minutes` into the game. @internal */
export function openAt(h: Stored, minutes: number): boolean {
  const open = minuteOf("hours", h.open);
  const close = minuteOf("hours", h.close);
  const dayOk = (m: number) => h.on === null || matchesAt(h.on, m, "openingHours on");
  if (!withinDay(minutes, open, close)) return false;
  // Past midnight, it's still the evening's opening: check the day it opened on.
  const opened = open > close && minuteOfDayAt(minutes) < close ? minutes - 24 * 60 : minutes;
  return dayOk(opened);
}

/** Whether `thing` is open now: `true` if it has no opening hours. */
export function isOpenNow(thing: ObjectRef): boolean {
  const h = hoursOf(thing);
  return h === undefined || openAt(h, clock.minutes);
}

/** The most days ahead to look for an opening. */
const LOOK_AHEAD = 31;

/** When `h` next opens after now: its minute, if it does within a month. */
function nextOpening(h: Stored): number | undefined {
  const open = minuteOf("hours", h.open);
  const today = dayOffset(clock.minutes);
  for (let d = today; d <= today + LOOK_AHEAD; d++) {
    const m = d * 24 * 60 - minuteOfDayAt(0) + open;
    if (m <= clock.minutes) continue;
    if (h.on === null || matchesAt(h.on, m, "openingHours on")) return m;
  }
  return undefined;
}

/**
 * Why `thing`'s opening hours block the way into `to` now, or `undefined`
 * if they don't: it's open, has no hours, or the way leads out of the
 * place they're for, not into it. @internal
 */
export function closedReason(thing: ObjectRef, to: ObjectRef): string | undefined {
  const h = hoursOf(thing);
  if (!h || h.of.id !== to.id || openAt(h, clock.minutes)) return undefined;
  const place = h.of;
  const next = nextOpening(h);
  if (next === undefined) return message("hours.closed", { place });
  const days = dayOffset(next) - dayOffset(clock.minutes);
  const when =
    days === 0
      ? undefined
      : days === 1
        ? "tomorrow"
        : message("hours.onDay", { weekday: weekdayNameAt(next) ?? "" });
  return message("hours.closed", {
    place,
    opens: timeOfDay(next),
    ...(when !== undefined && { when }),
  });
}
