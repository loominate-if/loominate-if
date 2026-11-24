# 0098. Accompanying and waiting companions

- **Status:** Accepted, 2026-11-24
- **Issue:** [#121](https://github.com/loominate-if/loominate-if/issues/121)
- **Design:** [Companions](../DESIGN.md#companions)

## Context

Companions are ordinary NPCs with extra states. Accompanying ones move with the player, narrated as a group ("You and Mira head down the corridor"). Waiting ones stay put when asked.

## Decision

- **Making companions:** `companion(npc, { starts })`, in `story.ts`, makes an NPC a companion, accompanying by default. `accompany(npc)` and `waitHere(npc)` change their state, as game state, saying "Mira comes along." or "Mira waits here." to whoever sees it. `companionState(npc)` reads the state.
- **Moving together:** when `enterRoom` moves the player from one room to another, every accompanying companion who was in the room they left goes too.
  - They're moved directly, so they aren't told as arriving apart from the player.
  - Each companion's minds note what they see there, so it becomes their knowledge.
  - The move is told once: "You and Mira head north." with the exit's direction, or "Mira comes with you." with no exit between.
  - The rooms module tells listeners when the player changes rooms, through an internal registry.
- **The narration comes first:** core's `_leadingNotices` puts a notice tagged `lead` before the passage's text, wherever in the move it was recorded. The group line is an `action-result` tagged `lead` and `companions`.
- **Timetables leave accompanying companions be;** an agenda item still acts.

## Consequences

- Orders as actions (#123) call `accompany` and `waitHere`, and can refuse.
- Independent companions are agenda items and simulation levels, as the design says, with no state of their own here.
- Knowledge sharing between companions (#124) builds on what each one has seen.
