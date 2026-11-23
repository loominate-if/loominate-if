# 0067. Relationships

- **Status:** Accepted, 2026-11-24
- **Issue:** [#96](https://github.com/loominate-if/loominate-if/issues/96)
- **Design:** [Stats, traits, and relationships](../DESIGN.md#stats-traits-and-relationships), [ADR 0066](0066-perceived-identity.md)

## Context

Relationships are a directed store keyed by pairs of minds, covering player-to-NPC and NPC-to-NPC, with several dimensions per pair (affection, trust, rivalry) and thresholds that trigger events. ADR 0066 added a one-number "attitude" as a stand-in.

## Decision

- **Dimensions:** a game declares its dimensions by name in the `Dimensions` interface, by declaration merging, so they're typed. It gives each one's start and limits with `relationships({ affection: { min: -10, max: 10 }, trust: { start: 2 } })`. A game and its packages can each declare their own. A dimension the interface names but nothing declares is an error when it's used.
- **Values:** `relationship(observer, toward)` gives a pair's values in every declared dimension: as changed in play, as set when the game loaded, or the dimension's start. Pairs are directed, keyed by minds (`observer>toward`), and kept in state, so undo, saves, and replays see them.
- **Changing them:** `setRelationship` and `changeRelationship` change a pair, clamped to the limits. Called in `story.ts`, as the game loads, they set how things start instead, as `disguise` does.
- **Perceived identity:** `relationshipTo(observer, body)` reads toward whoever the observer believes the body is (ADR 0066). For a stranger, every dimension is at its start.
- **Thresholds:** `threshold(id, { dimension, reaches | falls }, fire)` fires when a change during play crosses it, from below for `reaches`, from above for `falls`, in the move that makes the change. What it returns is recorded as a standing-out `scheduled` event from `threshold:<id>`. It fires once for each pair, kept in state, until the value goes back past it, which re-arms it.
- **Attitudes are removed:** ADR 0066's attitudes, which only shipped in #66, are gone. Relationships replace them, and `relationshipTo` replaces `attitudeTo`.

## Consequences

- Storylets (#97), conversations, and NPC agendas can test relationships and react to thresholds.
- The inspector doesn't list relationships or thresholds yet. It can once a panel is wanted.
