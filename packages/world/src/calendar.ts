/**
 * The calendar (#88, ADR 0057): days, weekdays, months, years, seasons, and
 * holidays on the game clock.
 *
 * A game's calendar is the real one by default, started from a date, or
 * one it chooses with {@link useCalendar}: {@link countedDays} for "Day 1,
 * Day 2", or {@link defineCalendar} for one of its own, with its own months,
 * week, leap years, and seasons. They all answer the same questions, so
 * schedules and holidays work the same on any of them.
 *
 * Everything is worked out from the clock, which is state; the calendar
 * itself is authored, like passages, so it isn't. Nothing reads the
 * computer's date.
 */
import { message, messages, StateError } from "@loominate-if/core";
import { checkPart, clock, dayAt, dayOffset, partAt, startDate } from "./clock.js";

declare module "@loominate-if/core" {
  interface Messages {
    /**
     * The date, as `dateText()` gives it: "Wednesday, 31 October 1923", or
     * "Day 3" on a calendar of counted days. Names are as the calendar
     * gives them; what a calendar doesn't have is undefined.
     */
    "calendar.date": {
      readonly day: number;
      readonly weekday?: string;
      readonly month?: string;
      readonly date?: number;
      readonly year?: number;
    };
  }
}

const SOURCE = "@loominate-if/world";

messages.register(
  "calendar.date",
  ({ day, weekday, month, date, year }) => {
    if (month !== undefined && date !== undefined) {
      const rest = `${String(date)} ${month}${year === undefined ? "" : ` ${String(year)}`}`;
      return weekday === undefined ? rest : `${weekday}, ${rest}`;
    }
    return weekday === undefined ? `Day ${String(day)}` : `${weekday}, day ${String(day)}`;
  },
  { source: SOURCE },
);

/** A name as a calendar gives it, and how it's matched: lowercase. */
type Named = { readonly id: string; readonly name: string };
const named = (name: string): Named => ({ id: name.toLowerCase(), name });

/** Where a day falls on a calendar. */
type Placed = {
  readonly weekday?: Named;
  readonly month?: Named;
  readonly monthIndex?: number;
  readonly date?: number;
  readonly year?: number;
  readonly season?: string;
};

/** A calendar, as a game chooses it with {@link useCalendar}: made by {@link gregorian}, {@link countedDays}, or {@link defineCalendar}. */
export type Calendar = {
  /** What kind it is. */
  readonly kind: "gregorian" | "counted" | "custom";
};

/** How a calendar works, kept apart from the handle games hold. */
type Workings = {
  readonly kind: Calendar["kind"];
  readonly _week: readonly Named[];
  readonly _months: readonly Named[];
  /** Where the game's first day falls, as a day number of the calendar's own. */
  _startOf(date: string | DateSpec | undefined): number;
  /** Where a day number of the calendar's own falls. */
  _place(day: number): Placed;
  /** How many days a month has in a year. */
  _monthDays(monthIndex: number, year: number): number;
};

const workings = new WeakMap<Calendar, Workings>();
/** A calendar handle for `w`. */
const made = (w: Workings): Calendar => {
  const handle: Calendar = Object.freeze({ kind: w.kind });
  workings.set(handle, w);
  return handle;
};

/** A date to start on, on a calendar with months: a year, a month by name or number from 1, and a date. */
export type DateSpec = {
  readonly year: number;
  readonly month: string | number;
  readonly date: number;
};

/** Seasons by the months they're in, as `{ winter: ["december", "january", "february"] }`. */
export type SeasonsByMonth = { readonly [season: string]: readonly string[] };

const GREGORIAN_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
].map(named);
const GREGORIAN_WEEK = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
].map(named);

/** Northern meteorological seasons: spring is March to May, and so on. */
const NORTHERN: SeasonsByMonth = {
  winter: ["december", "january", "february"],
  spring: ["march", "april", "may"],
  summer: ["june", "july", "august"],
  autumn: ["september", "october", "november"],
};
/** The same, south of the equator. */
const SOUTHERN: SeasonsByMonth = {
  summer: NORTHERN.winter ?? [],
  autumn: NORTHERN.spring ?? [],
  winter: NORTHERN.summer ?? [],
  spring: NORTHERN.autumn ?? [],
};

/** Each month's season, by month ID, checking the names. */
function seasonsOf(
  where: string,
  months: readonly Named[],
  seasons: SeasonsByMonth | undefined,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [season, list] of Object.entries(seasons ?? {})) {
    for (const m of list) {
      const id = m.toLowerCase();
      if (!months.some((x) => x.id === id)) {
        throw new StateError(
          `${where}: season ${JSON.stringify(season)} names ${JSON.stringify(m)}, which isn't one of the calendar's months.`,
        );
      }
      out.set(id, season);
    }
  }
  return out;
}

const parseDate = (where: string, text: string): DateSpec => {
  const match = /^(-?\d+)-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (!match) {
    throw new StateError(
      `${where}: ${JSON.stringify(text)} isn't a date. Write it as "YYYY-MM-DD", such as "1923-10-31".`,
    );
  }
  return { year: Number(match[1]), month: Number(match[2]), date: Number(match[3]) };
};

/** A month's index from its name or number from 1, checking it. */
const monthIndex = (where: string, months: readonly Named[], month: string | number): number => {
  const i =
    typeof month === "number" ? month - 1 : months.findIndex((m) => m.id === month.toLowerCase());
  if (i < 0 || i >= months.length || !Number.isInteger(i)) {
    throw new StateError(
      `${where}: ${JSON.stringify(month)} isn't one of the calendar's months: ${months.map((m) => m.name).join(", ")}.`,
    );
  }
  return i;
};

// Days since 1970-01-01 in the proleptic Gregorian calendar, and back (H. Hinnant's algorithms).
function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
function civilFromDays(z: number): { y: number; m: number; d: number } {
  const zz = z + 719468;
  const era = Math.floor(zz / 146097);
  const doe = zz - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}
const isGregorianLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** Where a day falls on a calendar with months, leaving out what it hasn't got. */
function placed(
  weekday: Named | undefined,
  month: Named | undefined,
  seasons: ReadonlyMap<string, string>,
  rest: { readonly monthIndex: number; readonly date: number; readonly year: number },
): Placed {
  const season = month ? seasons.get(month.id) : undefined;
  return {
    ...rest,
    ...(weekday && { weekday }),
    ...(month && { month }),
    ...(season !== undefined && { season }),
  };
}

/** Options for the real calendar. */
export type GregorianOptions = {
  /**
   * The seasons: `"northern"` (the default, meteorological: spring is March
   * to May), `"southern"`, or months of the game's own for each.
   */
  readonly seasons?: "northern" | "southern" | SeasonsByMonth;
};

/** The real calendar: real weekdays, months, and leap years, started from a date given to `startClock`. */
export function gregorian(options: GregorianOptions = {}): Calendar {
  const seasons = seasonsOf(
    "gregorian",
    GREGORIAN_MONTHS,
    options.seasons === "southern"
      ? SOUTHERN
      : options.seasons === "northern" || options.seasons === undefined
        ? NORTHERN
        : options.seasons,
  );
  const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const monthDays = (i: number, y: number): number =>
    i === 1 && isGregorianLeap(y) ? 29 : (days[i] ?? 0);
  return made({
    kind: "gregorian",
    _week: GREGORIAN_WEEK,
    _months: GREGORIAN_MONTHS,
    _startOf(date) {
      const spec = typeof date === "string" ? parseDate("startClock date", date) : date;
      if (!spec) return daysFromCivil(2000, 1, 1);
      const i = monthIndex("startClock date", GREGORIAN_MONTHS, spec.month);
      if (!Number.isInteger(spec.date) || spec.date < 1 || spec.date > monthDays(i, spec.year)) {
        throw new StateError(
          `startClock date: ${GREGORIAN_MONTHS[i]?.name ?? ""} ${String(spec.year)} has no day ${String(spec.date)}.`,
        );
      }
      return daysFromCivil(spec.year, i + 1, spec.date);
    },
    _place(day) {
      const { y, m, d } = civilFromDays(day);
      return placed(GREGORIAN_WEEK[mod(day + 4, 7)], GREGORIAN_MONTHS[m - 1], seasons, {
        monthIndex: m - 1,
        date: d,
        year: y,
      }); // 1970-01-01 was a Thursday
    },
    _monthDays: monthDays,
  });
}

/** Options for a calendar of counted days. */
export type CountedDaysOptions = {
  /** The names of the days of the week, if it has one, starting with the game's first day. */
  readonly week?: readonly string[];
  /** Seasons that follow each other, each so many days long, over and over, from the first day. */
  readonly seasons?: readonly { readonly name: string; readonly days: number }[];
};

/** A calendar of counted days: "Day 1", "Day 2", with a week and seasons if the game gives them. */
export function countedDays(options: CountedDaysOptions = {}): Calendar {
  const week = (options.week ?? []).map(named);
  const seasons = options.seasons ?? [];
  for (const s of seasons) {
    if (!Number.isInteger(s.days) || s.days < 1) {
      throw new StateError(
        `countedDays: season ${JSON.stringify(s.name)} must last a whole number of days, 1 or more.`,
      );
    }
  }
  const cycle = seasons.reduce((n, s) => n + s.days, 0);
  return made({
    kind: "counted",
    _week: week,
    _months: [],
    _startOf: () => 0,
    _place(day) {
      let into = cycle === 0 ? 0 : mod(day, cycle);
      let season: string | undefined;
      for (const s of seasons) {
        if (into < s.days) {
          season = s.name;
          break;
        }
        into -= s.days;
      }
      return {
        ...(week.length > 0 && { weekday: week[mod(day, week.length)] }),
        ...(season !== undefined && { season }),
      };
    },
    _monthDays: () => 0,
  });
}

/** A calendar of the game's own, for {@link defineCalendar}. */
export type CalendarDefinition = {
  /** The months, in order, with how many days each has. */
  readonly months: readonly { readonly name: string; readonly days: number }[];
  /** The days of the week, in order. */
  readonly week: readonly string[];
  /** The weekday of the first day of year 1. Defaults to the first in `week`. */
  readonly firstWeekday?: string;
  /** A leap day: in years `when` says yes to, `month` has `days` more days. */
  readonly leap?: {
    readonly month: string;
    readonly days: number;
    readonly when: (year: number) => boolean;
  };
  /** The seasons, by the months they're in. */
  readonly seasons?: SeasonsByMonth;
};

/** A calendar of the game's own: its own months, week, leap years, and seasons. Years count from 1. */
export function defineCalendar(definition: CalendarDefinition): Calendar {
  const where = "defineCalendar";
  if (definition.months.length === 0 || definition.week.length === 0) {
    throw new StateError(`${where}: give it at least one month and one day of the week.`);
  }
  const months = definition.months.map((m) => named(m.name));
  for (const m of definition.months) {
    if (!Number.isInteger(m.days) || m.days < 1) {
      throw new StateError(
        `${where}: month ${JSON.stringify(m.name)} must have a whole number of days, 1 or more.`,
      );
    }
  }
  const week = definition.week.map(named);
  const firstWeekday =
    definition.firstWeekday === undefined
      ? 0
      : week.findIndex((w) => w.id === definition.firstWeekday?.toLowerCase());
  if (firstWeekday < 0) {
    throw new StateError(
      `${where}: firstWeekday ${JSON.stringify(definition.firstWeekday)} isn't one of the week's days.`,
    );
  }
  const leap = definition.leap;
  const leapMonth = leap ? monthIndex(`${where} leap`, months, leap.month) : -1;
  const seasons = seasonsOf(where, months, definition.seasons);
  const monthDays = (i: number, year: number): number =>
    (definition.months[i]?.days ?? 0) +
    (i === leapMonth && leap?.when(year) === true ? leap.days : 0);
  const yearDays = (year: number): number =>
    definition.months.reduce((n, _m, i) => n + monthDays(i, year), 0);
  /** The day number of the first day of `year`, counting year 1's first day as 0. */
  const yearStart = (year: number): number => {
    let n = 0;
    if (year >= 1) for (let y = 1; y < year; y++) n += yearDays(y);
    else for (let y = 0; y >= year; y--) n -= yearDays(y);
    return n;
  };
  return made({
    kind: "custom",
    _week: week,
    _months: months,
    _startOf(date) {
      const spec = typeof date === "string" ? parseDate("startClock date", date) : date;
      if (!spec) return 0;
      const i = monthIndex("startClock date", months, spec.month);
      if (!Number.isInteger(spec.date) || spec.date < 1 || spec.date > monthDays(i, spec.year)) {
        throw new StateError(
          `startClock date: ${months[i]?.name ?? ""} ${String(spec.year)} has no day ${String(spec.date)}.`,
        );
      }
      let n = yearStart(spec.year);
      for (let m = 0; m < i; m++) n += monthDays(m, spec.year);
      return n + spec.date - 1;
    },
    _place(day) {
      let year = 1;
      let into = day;
      while (into < 0) {
        year -= 1;
        into += yearDays(year);
      }
      while (into >= yearDays(year)) {
        into -= yearDays(year);
        year += 1;
      }
      let i = 0;
      while (into >= monthDays(i, year)) {
        into -= monthDays(i, year);
        i += 1;
      }
      return placed(week[mod(day + firstWeekday, week.length)], months[i], seasons, {
        monthIndex: i,
        date: into + 1,
        year,
      });
    },
    _monthDays: monthDays,
  });
}

let chosen: Workings = workings.get(gregorian()) as Workings;

/** Chooses the game's calendar. Call it once, in `story.ts`. The real calendar is the default. */
export function useCalendar(calendar: Calendar): void {
  const w = workings.get(calendar);
  if (!w) {
    throw new StateError(
      "useCalendar: give it a calendar from gregorian(), countedDays(), or defineCalendar().",
    );
  }
  chosen = w;
  firstDay = undefined;
}

/** The calendar's day number for the game's first day, worked out once it's needed. */
let firstDay: number | undefined;
const dayNumber = (offset: number): number => {
  firstDay ??= chosen._startOf(startDate());
  return firstDay + offset;
};

/** Where the day `minutes` into the game falls, or today's. */
const placeOf = (minutes = clock.minutes): Placed => chosen._place(dayNumber(dayOffset(minutes)));

/** A holiday's rule: a date each year, the nth weekday of a month, or a day of the game. */
export type HolidayRule =
  | { readonly month: string; readonly date: number }
  | {
      readonly month: string;
      readonly weekday: string;
      /** Which one in the month: 1 for the first, 2 for the second, …, or -1 for the last. */
      readonly nth: number;
    }
  | { readonly day: number };

const holidays = new Map<string, HolidayRule>();

/**
 * Names a holiday, as plain data: a date each year, the nth weekday of a
 * month, or a day of the game, on a calendar of counted days.
 *
 * @example
 * ```ts
 * holiday("midsummer", { month: "june", date: 21 });
 * holiday("harvest", { month: "september", weekday: "monday", nth: 1 });
 * ```
 *
 * @throws StateError if another holiday has the name.
 */
export function holiday(name: string, rule: HolidayRule): void {
  if (holidays.has(name)) {
    throw new StateError(
      `holiday ${JSON.stringify(name)}: another holiday has this name. Give each its own.`,
    );
  }
  holidays.set(name, rule);
}

const checkName = (where: string, kind: string, list: readonly Named[], name: string): string => {
  const id = name.toLowerCase();
  if (!list.some((x) => x.id === id)) {
    throw new StateError(
      `${where}: ${JSON.stringify(name)} isn't one of the calendar's ${kind}: ${list.map((x) => x.name).join(", ") || "it has none"}.`,
    );
  }
  return id;
};

/** Whether the day `minutes` into the game is the holiday `name`. */
function isHolidayAt(name: string, minutes: number): boolean {
  const rule = holidays.get(name);
  if (!rule) {
    throw new StateError(
      `calendar: there's no holiday ${JSON.stringify(name)}. Name it with holiday() when the game loads.`,
    );
  }
  const where = `holiday ${JSON.stringify(name)}`;
  if ("day" in rule) return dayAt(minutes) === rule.day;
  const p = placeOf(minutes);
  const month = checkName(where, "months", chosen._months, rule.month);
  if (p.month?.id !== month || p.date === undefined) return false;
  if ("date" in rule) return p.date === rule.date;
  const weekday = checkName(where, "weekdays", chosen._week, rule.weekday);
  if (p.weekday?.id !== weekday) return false;
  if (rule.nth > 0) return Math.ceil(p.date / chosen._week.length) === rule.nth;
  const days = chosen._monthDays(p.monthIndex ?? 0, p.year ?? 0);
  return p.date + chosen._week.length > days; // the last of its weekday in the month
}

/** What {@link CalendarView.is} checks: each one given must match; a list matches any of its names. */
export type CalendarQuery = {
  /** Parts of the day, as {@link dayParts} names them: "morning", "night". */
  readonly part?: string | readonly string[];
  readonly weekday?: string | readonly string[];
  readonly month?: string | readonly string[];
  readonly season?: string | readonly string[];
  readonly holiday?: string | readonly string[];
};

/** The calendar, as of the clock now. */
export type CalendarView = {
  /** Which kind of calendar the game uses. */
  readonly kind: Calendar["kind"];
  /** The day of the game, counting from the day it began on, as `clock.day`. */
  readonly day: number;
  /** The weekday, lowercase, as "tuesday", if the calendar has a week. */
  readonly weekday: string | undefined;
  /** The month, lowercase, as "october", if the calendar has months. */
  readonly month: string | undefined;
  /** The day of the month, if the calendar has months. */
  readonly date: number | undefined;
  /** The year, if the calendar has months. */
  readonly year: number | undefined;
  /** The season, as the calendar names it, if it has seasons. */
  readonly season: string | undefined;
  /** The holidays today is, by name. */
  readonly holidays: readonly string[];
  /**
   * Whether today matches: each part given must, and a list matches any of
   * its names. Names are checked against the calendar, so a typo is an error.
   *
   * @example
   * ```ts
   * calendar.is({ weekday: ["tuesday", "thursday"] })
   * ```
   */
  is(query: CalendarQuery): boolean;
};

const list = (x: string | readonly string[] | undefined): readonly string[] | undefined =>
  x === undefined ? undefined : typeof x === "string" ? [x] : x;

/** Whether the day `minutes` into the game matches `query`. @internal */
export function matchesAt(query: CalendarQuery, minutes: number, where = "calendar.is"): boolean {
  const p = placeOf(minutes);
  const weekdays = list(query.weekday)?.map((w) => checkName(where, "weekdays", chosen._week, w));
  if (weekdays && !weekdays.includes(p.weekday?.id ?? "")) return false;
  const months = list(query.month)?.map((m) => checkName(where, "months", chosen._months, m));
  if (months && !months.includes(p.month?.id ?? "")) return false;
  const seasons = list(query.season);
  if (seasons && !seasons.includes(p.season ?? "")) return false;
  const dayPart = list(query.part)?.map((x) => checkPart(where, x));
  if (dayPart && !dayPart.includes(partAt(minutes))) return false;
  const named = list(query.holiday);
  if (named && !named.some((h) => isHolidayAt(h, minutes))) return false;
  return true;
}

/** The weekday's name, as the calendar gives it, `minutes` into the game, if it has a week. @internal */
export function weekdayNameAt(minutes: number): string | undefined {
  return placeOf(minutes).weekday?.name;
}

/** The game's calendar, as of the clock now. */
export const calendar: CalendarView = Object.freeze({
  get kind() {
    return chosen.kind;
  },
  get day() {
    return clock.day;
  },
  get weekday() {
    return placeOf().weekday?.id;
  },
  get month() {
    return placeOf().month?.id;
  },
  get date() {
    return placeOf().date;
  },
  get year() {
    return placeOf().year;
  },
  get season() {
    return placeOf().season;
  },
  get holidays() {
    return [...holidays.keys()].filter((h) => isHolidayAt(h, clock.minutes));
  },
  is: (query: CalendarQuery) => matchesAt(query, clock.minutes),
});

/** The date, worded through the `calendar.date` message: "Wednesday, 31 October 1923". */
export function dateText(): string {
  const p = placeOf();
  return message("calendar.date", {
    day: clock.day,
    ...(p.weekday && { weekday: p.weekday.name }),
    ...(p.month && { month: p.month.name }),
    ...(p.date !== undefined && { date: p.date }),
    ...(p.year !== undefined && { year: p.year }),
  });
}
