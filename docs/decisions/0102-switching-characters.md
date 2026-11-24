# 0102. Switching the player character

- **Status:** Accepted, 2026-11-24
- **Issue:** [#125](https://github.com/loominate-if/loominate-if/issues/125)
- **Design:** [Companions](../DESIGN.md#companions), [Minds and bodies](../DESIGN.md)

## Context

The player controls one mind, and should be able to change which mid-game. Narration's person must follow the mind controlled. `playAs` already switches the mind, and the grammar already speaks of the player's body as "you".

## Decision

- **`switchTo(npc)`,** during a move:
  - ends a conversation the player was in;
  - switches with `playAs`;
  - says "You are Mira now.", as a `lead` notice, worded before the switch while she's still someone else;
  - redirects the move to the passage of the room the new character is in, which then reads as they see it.
- **`takeControl({ thing })`** is a standard action that calls it.
  - It's offered on a body's menu when its mind was named with `playable` in `story.ts` and it isn't the one played. Any thing can be asked, and only such bodies say yes.
  - Its thing needn't be in reach, so a link can offer it anywhere.
- **The character left** is an ordinary NPC: spoken of by name, acting as any NPC, and never moved as a companion while played. Switching away from a body named "you" is an error, since it would then be spoken of as "you" in the third person. The fix is to give it a name; the grammar still says "you" while it's played.
- **`playAs`** stays as it is, for switching without moving the story.

## Consequences

- Games that might switch characters name the starting body, as "Alex", rather than "you".
- Combat control per character, from the design, comes with the RPG kit.
