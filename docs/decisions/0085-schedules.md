# 0085. Scheduled NPCs

- **Status:** Accepted, 2026-11-24
- **Issue:** [#105](https://github.com/loominate-if/loominate-if/issues/105)
- **Design:** [NPCs](../DESIGN.md#npcs), [ADR 0057](0057-calendar.md), [ADR 0084](0084-agendas.md)

## Context

Scheduled NPCs follow a timetable, and the runtime works out where they are whenever it matters, with no step-by-step simulation. They should be in the right place after time jumps, and use the calendar. Agenda items can interrupt them.

## Decision

- **`schedule(npc, entries)`,** in `story.ts`, gives an NPC a timetable. Each entry is `{ at: "HH:MM", in: place, on? }`, where `on` is the calendar's query (weekday, month, season, holiday, part of the day).
- **Where they are is a function of the clock:** the latest entry that's begun, on a day its `on` matches, working back up to 400 days.
  - Among entries at the same time, the first listed that applies wins, so a general entry can follow particular ones.
  - `whereScheduled(npc, minutes?)` gives it for any time.
- **When they move:** after each move, before NPCs take their turns, and after each jump of the clock, every scheduled NPC is put where their timetable says.
  - They're placed at once, through `move`, so coming and going is narrated where seen, as any actor's is.
  - At the start of the game they're placed without narration.
  - NPCs are placed in ID order.
- **Agendas come first:** while an NPC has an active, ready agenda item, the timetable doesn't move them. Afterwards they go where it says by then, so missed entries are skipped, as a person who's been kept busy all afternoon doesn't go to the market at night.

## Consequences

- Something that depends on an NPC being somewhere should check where they are, not the time, since an agenda can keep them from an entry.
- Walking between places while seen, rather than appearing, could come later as an option.
