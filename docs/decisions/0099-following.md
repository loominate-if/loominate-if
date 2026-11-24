# 0099. Following NPCs

- **Status:** Accepted, 2026-11-24
- **Issue:** [#122](https://github.com/loominate-if/loominate-if/issues/122)
- **Design:** [Companions](../DESIGN.md#companions)

## Context

The player should be able to follow any NPC who leaves, reusing the movement machinery, as TADS's follow command did.

## Decision

- **The trail:** when the player sees a body leave their room by an exit, the world remembers that exit for that body, as game state (`world:following`). The player moving, or the body coming back to the player's room, forgets it. So the trail is known only while the player stays where they saw them go.
- **The action:** `follow({ who })` is a standard action.
  - Verify hides it with why: "You don't know where the butler went.", "The butler is right here.", or "You can't follow yourself."
  - Check disables it with the exit's blocked reason, such as a door locked behind them.
  - Running it says "You follow the butler west." as a `lead` notice, then redirects the move to the exit's room's passage, or takes a journey as its action. Arriving moves accompanying companions as any move does.
  - Its `who` needn't be in reach (`reachNotNeeded`).
- **Offering it:** `{exits}` offers "Follow the butler" after the exits while the trail is known. The exits module takes extra links from other modules through an internal registry.

## Consequences

- A trail isn't kept across rooms, so the player can't pick it up again later. A game wanting tracking can keep its own.
- Parser commands ("follow the butler") use the action's verbs when the parser comes.
