# 0057. The calendar

- **Status:** Accepted, 2026-11-23
- **Issue:** [#88](https://github.com/loominate-if/loominate-if/issues/88)
- **Design:** [Time and scheduling](../DESIGN.md#time-and-scheduling), [ADR 0049](0049-game-clock.md), [ADR 0050](0050-fuses-and-daemons.md)

## Context

A calendar layer on the clock should provide days, weekdays, seasons, years, and holidays, so schedules can say "Tuesdays and Thursdays". Games differ: some are set on real dates, some count days ("Day 1"), and some have calendars of their own.

## Decision

- **Three kinds, one view.** A calendar maps the clock's days to dates. All three answer the same questions through `calendar` (`weekday`, `month`, `date`, `year`, `season`, `holidays`, `is(…)`) and `dateText()`, so schedules and holidays work the same on any of them.
  - **The real calendar,** by default. `startClock({ date: "1923-10-31" })` starts it, and it defaults to 1 January 2000. It's computed with plain day arithmetic, since game logic never uses `Date`. Seasons are northern meteorological by default; `gregorian({ seasons })` gives southern ones, or months of the game's own.
  - **`countedDays({ week, seasons })`:** "Day 1, Day 2", with a week and seasons if given. Seasons cycle, so many days each. There are no months or years.
  - **`defineCalendar({ months, week, firstWeekday, leap, seasons })`:** months and their lengths, a week of any length, a leap day by a rule on the year, and seasons by month. Years count from 1, and `startClock({ date: { year, month, date } })` starts it.
  - A game chooses one with `useCalendar(…)`. The calendar is authored, not state; everything is worked out from the clock.
- **Names:** weekdays and months are matched in lowercase. `calendar.is` and holiday rules check names against the calendar, so a typo is an error, not a silent `false`.
- **Holidays** are plain data: `holiday(name, { month, date })`, `{ month, weekday, nth }` (with -1 for the last), or `{ day }` for a day of the game.
- **Schedules:** a daemon can fire `at` a time of day, `on` weekdays or any calendar check. Its next firing is the next matching day at that time, so it's stepped to like any other. One that begins running works out its first firing from the clock when first needed, so the calendar can be chosen after it's defined, and one added in a later version of a game doesn't fire for every day an old save missed. The inspector describes it as "at 08:00 on tuesday, thursday".
- **Words:** `dateText()` words the date through the `calendar.date` message.

## Consequences

- Astronomical seasons and moon phases aren't included; a game can add checks of its own from `calendar`.
- #89 (opening hours, time-aware content) builds on `calendar.is` and `timeOfDay`.
