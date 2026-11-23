# 0058. Parts of the day and opening hours

- **Status:** Accepted, 2026-11-23
- **Issue:** [#89](https://github.com/loominate-if/loominate-if/issues/89)
- **Design:** [Time and scheduling](../DESIGN.md#time-and-scheduling), [ADR 0034](0034-exits-and-directions.md), [ADR 0057](0057-calendar.md)

## Context

Descriptions and actions should vary by time of day. Locations should have opening hours, enforced through the same rules that gate doors. Scenes should be able to start at a time.

## Decision

- **Parts of the day:** `clock.part`, `clock.is(part)`, and `calendar.is({ part })` name the time of day.
  - The parts default to dawn (5:00), morning (7:00), afternoon (12:00), evening (17:00), and night (21:00).
  - `dayParts({ name: "HH:MM", … })` replaces them. Each part lasts until the next, and the last runs on past midnight.
  - Names are checked, so a typo is an error.
- **Spans:** `clock.between(from, to)` checks a span of the day, running past midnight when `to` is earlier.
- **Opening hours:** `openingHours({ of, open, close, on })` is a mixin for a door or obstacle on an exit.
  - `of` names the place whose hours they are, and is required. Outside the hours, only the way *into* that place is blocked; the way out never is, so someone inside at closing time can always leave. A door joins two places and can't tell which side keeps the hours, so it has to be told. Without `of`, the hours blocked both directions, and named the street as closed from inside.
  - It adds plain data, `hours`, rather than a `blocks` method, since spreading it beside `door` would replace the door's.
  - An exit's blocked reason checks the hours first, then the door's own `blocks`. So outside its hours a door says the place is closed, and inside them it still says it's locked or shut.
  - `on` takes weekdays or any calendar check.
  - A `close` earlier than `open` closes after midnight, and the hours after midnight count as the day it opened.
  - The reason names the place from `of`, and says when it next opens: "The bakery is closed until 9:00 am", "… tomorrow", or "… on Monday", through the `hours.closed` and `hours.onDay` messages.
  - `isOpenNow(thing)` checks it from code.
  - The hours are state, so a game can change them during play.
- **Scenes:** starting a scene at a time is left to scenes (#68), which don't exist yet. A timed daemon or `waitUntil` will start them.

## Consequences

- Opening hours gate exits, not things. A shopkeeper's action checks `isOpenNow` in its `check`.
- Nothing happens to someone inside at closing time; they're simply free to leave. A game can have the baker glare and then usher them out with daemons. Built-in, optional closing-time behaviour is #316.
