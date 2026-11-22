# 0037. Perception

- **Status:** Accepted, 2026-11-22
- **Issue:** [#69](https://github.com/loominate-if/loominate-if/issues/69)
- **Design:** [World model library](../DESIGN.md#world-model-library), [ADR 0031](0031-containment-and-scope.md), [ADR 0035](0035-knowledge-and-facts.md)

## Context

The design asks for a sense layer that decides what the player notices: NPC arrivals and departures are narrated automatically, and offstage events are silent unless they're made perceptible ("You hear a door slam upstairs"). Perception goes to the mind in a body, and optionally its passenger. Before this change, the page showed only passage text. Events recorded with `emit` reached the event record and the story-so-far drawer, but never the main view.

## Decision

### Showing what was noticed

- Core gains a `perception` event kind: prose, plus the `sense` (`see` or `hear`) and the `source`.
- The page shows the move's `perception` and `action-result` events after the passage's text and before its first choice, as `.loominate-notice` paragraphs inside its live region. Effects run, and record them, before the passage's text, but the text says what the player did and the notices what came of it: `"Shoo!"`, then "The cat slinks off outside." After a beat, they follow the part it reveals. The drawer puts them in the same place in their turn.
  - A move's events are those since its navigation or page break. After a beat, only those since the beat are added.
  - They're read from the event record, so undo, loading, and redrawing show the same.
- A walkthrough's `game.notices` gives the same text, and `game.text` has it where the page shows it, so tests see what the player sees.
- `action-result` is shown the same way, for actions' reports (#76).

### `happen`

- `happen(thing, { seen, heard, far, carries, reveals })`. For each body:
  - one that can see the thing notices `seen`;
  - one that can only hear it, in the dark or through a closed box, notices `heard`;
  - with `far`, one in a room up to `carries` exits away (default 1) notices `far`, with the way the sound came from;
  - with neither, nothing.
- Sound spreads by exits the way they lead, whatever is in the way. A room is reached through one of its own exits, and that exit's direction gives `from`, so a sound in the room above is "from above". `far` is text, or a function of that phrase.
- Directions gain `toward` ("to the north", "upstairs") and `from` ("from the north", "from above"). A game's own default to "to the fore" and "from the fore", and can say their own.
- Only the mind the player controls is told, through a `perception` event. Every mind in a body that notices, in control or passenger, learns `reveals`, sourced to the thing, and sees what it saw. It's `happen`, not `noise`, since an event can be only seen.

### Comings and goings

- When a body other than the player's moves into or out of the player's room, perception narrates it with the room's exits:
  - Arriving, if the player can see it: "Mira arrives from outside."
  - Leaving, if the player's room is lit: "Mira leaves upstairs." It's already gone, so light stands in for sight.
- The player's own moves, and anything carried with the player, aren't narrated.
- A body's `arrives(from)` and `leaves(toward)` methods replace the text, and returning `undefined` keeps it quiet. These stay methods until the library message table (#71).
- Every mind in the room that can see a newcomer sees it.
- Narration happens wherever `move` runs during a move. Events recorded during the player's `on leave` code belong to the move before, so they aren't shown.

## Consequences

- Actions' report stage (#76) records `action-result` events, and the page already shows them.
- NPC travel (#137) and companions moving with the player (#120) get narration for free, and companions will want group narration ("You and Mira…") to replace it.
- Hearing footsteps in the dark, muffling by closed doors, and a passenger told separately from its body's controller are left for later.
