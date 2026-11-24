# 0086. The inspector's NPC view

- **Status:** Accepted, 2026-11-24
- **Issue:** [#108](https://github.com/loominate-if/loominate-if/issues/108)
- **Design:** [NPCs](../DESIGN.md#npcs), [ADR 0082](0082-npc-turns.md), [ADR 0084](0084-agendas.md), [ADR 0085](0085-schedules.md)

## Context

The inspector should show where every NPC is, what they're doing and why, and a timeline of their offstage actions, including where an agenda item or timetable entry came from. Offstage actions leave no trace on the page, so a timeline needs a record of them.

## Decision

- **An NPCs tab** in the world model's inspector module, a row per NPC with a body, the player aside, in ID order:
  - where they are;
  - their level: observed only, scheduled, or simulated;
  - whether they get a turn now, and why: simulated, busy with an agenda item, seen or heard by the player, or out of sight;
  - their agenda items, with priority, whether each is active and ready, and which acts next;
  - their timetable entry now and the next to begin.
- **The timeline is in the event record.** `actAs` records an `npc` event for each action: its name, whether it was done, and why not. Timetable moves and catch-ups record one too. Each has the clock's minutes and whether the player could see or hear the NPC. The page only shows the kinds it knows, so these never appear there.
  - Being in the record, the timeline survives reloads and is kept by undo, saves, and replays, as the Events tab is.
  - The tab lists the last 100, newest first, offstage only unless asked for all.
- **The data comes from internal functions** in the world model (`_npcRows`), gathered from the NPC, agenda, and timetable modules, which read the world and change nothing.

## Consequences

- Saves grow by one small event per NPC action, as they do for the player's.
- A kit's NPC behaviours appear in the timeline as long as they act through `actAs`.
