# 0042. Contents listings

- **Status:** Accepted, 2026-11-22
- **Issue:** [#290](https://github.com/loominate-if/loominate-if/issues/290)
- **Design:** [World model library](../DESIGN.md#world-model-library), [ADR 0031](0031-containment-and-scope.md), [ADR 0038](0038-message-parameters.md), [ADR 0039](0039-message-table.md)

## Context

Three coins spawned into a chest listed as "a gold coin, a gold coin, a gold coin", in a listing every game wrote by hand. TADS and adv3Lite group equivalent objects when they're listed: "three gold coins". True stacks, one object with a quantity, are a separate feature (#98).

## Decision

- `listContents(holder)` lists what's directly in or on `holder` as the player would see it: what their body can see, plus anything it carries, never the player's own body, and in ID order. With no player, it lists everything.
- Alike things are listed once with a count. Things are alike if they were made from the same thing template and have the same name, or if both are marked `isEquivalent: true` and have the same name. Everything else is listed singly with `{a …}`.
- A plural name comes from `pluralName`, or from adding "s", "es", or "ies" to the name's last word.
- The words are messages (ADR 0039): `list.empty`, `list.join` (with the serial comma), `list.group`, and `number.words` (words up to twelve, then digits), so a game can reword or translate them.
- It's a function, not a directive. A content directive ends its paragraph, and a listing belongs inside a sentence: `The chest holds {listContents(chest)}.`. Games export it from `story.ts`, as they do `visitsTo`.
- Nested listings, such as "a chest (in which are three gold coins)", are left to the author for now.

## Consequences

- Stacks (#98) list through the same function, as "99 turnips".
- Room descriptions and inventory, when they come, use it.
