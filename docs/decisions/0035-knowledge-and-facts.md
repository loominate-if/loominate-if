# 0035. Knowledge and facts

- **Status:** Accepted, 2026-11-22
- **Issue:** [#67](https://github.com/loominate-if/loominate-if/issues/67)
- **Design:** [World model library](../DESIGN.md#world-model-library), [ADR 0032](0032-minds-and-bodies.md)

## Context

The design has the player and NPCs track what they have seen, what is familiar, and which facts they know, with a source for each fact ("the gardener told me" versus "I read it in the diary"). Conversations reveal facts with `{reveal facts.x}`, and actions and topics test `player.knows(facts.x)`. Minds and bodies (ADR 0032) put knowledge in the mind, and the player can switch minds during play.

## Decision

### Facts

- A fact is defined in code with `fact(id, { text })`, or several at once with `defineFacts({ id: text, … })`, whose keys are the IDs and whose result is typed, so a misspelled fact is a type error. Both register in one table, and a duplicate ID is an error. A module, such as a chapter file or a kit, can export its own facts either way. (`defineFacts`, not `facts`, so a game can write `export const facts = defineFacts(…)`.)
- Facts aren't state: they never change. Their IDs are stored in saves, so they must stay stable.

### What a mind knows

- Each mind's knowledge is state, on a world-owned object `world:knowledge:<mind>` created with the mind, so undo, saves, and the inspector cover it, and the mind's own properties stay the author's.
- Every mind has methods for it: `knows`, `learn`, `sourceOf`, `knownFacts`, `see`, `hasSeen`, `learnAbout`, `knowsAbout`, and `forget`. An actor passes them through to its mind, like its other properties. Their names are reserved: a mind's definition can't use them, which is a type error and a runtime error.
- A fact's source is where the mind first learned it: a thing or mind it came `from`, the passage it was revealed in, or both. Learning it again keeps the first source.
- `forget` takes back a fact, or that a thing was seen or is familiar. It's how forgetting works, such as for amnesia and per-mind visit memory (#200).

### The player

- `player` stands for the mind the player controls now. `player.knows(…)` follows the player through `playAs`, possession, and body swaps, where `you.knows(…)` asks one actor's mind, which stops being the player's after a switch. Conditions that mean "if the player knows" use `player`.

### `{reveal}`

- `{reveal fact, from: source}` is an arrival directive: when the player reaches it, the player's mind learns the fact, sourced to `from` if given and to the passage. It never runs when the passage is only shown. Conversations will reveal facts to everyone present (#140); this reveals them to the player.

### Seen and familiar

- Arriving at a room passage marks everything the player's body can see there as seen, using scope's sight, by the mind in control and by any passenger. Nothing is seen in the dark or in a closed opaque container. `see(thing)` marks a thing by hand.
- Moving alone doesn't mark anything; noticing what changes in view as it happens is the perception layer's (#69).
- A thing is familiar to a mind with `learnAbout(thing)`, or to every mind with `isFamiliar: true` on the thing. `knowsAbout` is seen or familiar.

## Consequences

- Topics (#111) and actions (#76) test `player.knows` and `knowsAbout`; group conversations will call `learn` for each listener.
- Knowledge sharing between companions (#124) builds on `learn` with a source.
- Perceived identity (#66) stores who an NPC believes a body is as knowledge.
- The inspector's object tree (#82) can show each mind's knowledge from its record.
