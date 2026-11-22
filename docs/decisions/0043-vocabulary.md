# 0043. Vocabulary on things

- **Status:** Accepted, 2026-11-22
- **Issue:** [#73](https://github.com/loominate-if/loominate-if/issues/73)
- **Design:** [Future parser](../DESIGN.md#future-parser)

## Context

A full parser is a later optional package. For it to be a second front end on the same game, objects need to be able to carry vocabulary from version one, without anything using it before then.

## Decision

- A thing's `vocab` is typed lists of `nouns`, `adjectives`, and `plurals`, not adv3Lite's vocabulary string. Mistakes are type errors, and tools read it without parsing a mini-language. Each entry is one word.
- `vocabOf(thing)` gives the full vocabulary: the name's words first, with the last word as a noun, the others as adjectives, and the name's plural (from `pluralName` or spelling) as a plural, then what `vocab` adds, lowercased and without repeats. A proper name has no plural of its own. Most things need no `vocab` at all.
- `vocab` is state, like `name`, so a game can change it during play.
- Nothing in the world model reads vocabulary. It's there for the parser.

## Consequences

- The parser (#184) matches the player's words against `vocabOf`, and can register its own disambiguation on top.
- Things made from templates get vocabulary the same way, from their template's definition.
