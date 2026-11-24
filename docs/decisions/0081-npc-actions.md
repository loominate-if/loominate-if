# 0081. NPCs act through the shared pipeline

- **Status:** Accepted, 2026-11-24
- **Issue:** [#106](https://github.com/loominate-if/loominate-if/issues/106)
- **Design:** [NPCs](../DESIGN.md#npcs), [ADR 0044](0044-action-pipeline.md), [ADR 0037](0037-perception.md)

## Context

Locks, keys, and rules should apply equally to NPCs. Actions took the player as the actor, through the world model's `useActor`, and the player moves by passages and exits, so there was no action for an NPC to go through a door.

## Decision

- **Core's `perform(call, { as: { actor, body } })`** runs every stage with that actor and body, so every rule, the world model's reach and the game's own, applies to them as to the player. Acting as someone else:
  - doesn't report to the player: neither a refusal nor the report is recorded as an `action-result`;
  - takes none of the game's time, so `actionTime` isn't run;
  - returns what onlookers see, from the action's new `seen` text, as `outcome.seen`.
- **The world model's `actAs(npc, call)`:**
  - resolves the NPC's mind and the body it acts through, and calls `perform` as them;
  - tells whoever can see the body what onlookers see, through `happen`, so it's narrated in the third person, to the player only if they see it;
  - returns the outcome, so a refusal reaches code such as an agenda, unnarrated;
  - refuses the player, who acts through links, menus, and `perform`.
- **A standard `go` action,** `go({ way })`, moves the actor's body through an exit of its room.
  - Its check is the exit's `blockedReason`, so a locked or closed door stops an NPC with its reason.
  - Coming and going is narrated by the perception layer, as any actor's movement is.
  - It refuses the player, who moves through the story's passages and exits.
- **Standard actions gain `seen` messages** (`take.seen` and so on), worded for the acting body: "The butler takes the iron key."
- **Giving to the player:** with no rule in `giving`, the player takes it, since they can't refuse. Showing the player something has no reaction of its own.

## Consequences

- A refusal's reason is still worded for the player, as "You need the iron key." It's returned to code, never shown.
- Agendas (#107), scheduled NPCs (#105), and orders (#123) build on `actAs`.
