# 0053. Atmosphere, standouts, and joined sentences

- **Status:** Accepted, 2026-11-23
- **Issue:** [#307](https://github.com/loominate-if/loominate-if/issues/307)
- **Design:** [Time and scheduling](../DESIGN.md#time-and-scheduling), [ADR 0052](0052-summing-up-repeats.md)

## Context

After ADR 0052, each fuse's or daemon's summary was still its own notice and its own paragraph. A long night read as a stack of one-line paragraphs, and a returning player had to read every one to catch what mattered. Atmospheric noise should be skimmable, while details that matter stand out.

## Decision

- **Atmosphere:** what fuses and daemons say is atmosphere by default. A move's atmosphere runs together as one paragraph, placed where the first of it falls. This applies in any move, not only long jumps.
- **Standing out:** `standsOut: true` on a fuse or daemon gives its notices a paragraph of their own. What interrupted a jump always stands out. Other notices (perception, action results) keep their own paragraphs as before.
- **The record:** `scheduled` events carry `standsOut: true` when they stand out. The page, the story-so-far drawer, and the walkthrough API all group a move's notices with one core helper, so they agree. The field is additive, so old saves still read.
- **Named groups:** a fuse or daemon can give `joins: "<group>"` and a `clause`. When it fires more than once in one jump, its clause joins its group's sentence, in place of its lines or summary. `sentence(group, ({ list, clauses }) => …)` words a group's sentence; without one, its clauses are joined with `list.join` and capitalised. A group's sentence goes where its first member first spoke. Groups keep different noises in different sentences ("Outside, … In the house, …").
- **When joining happens:** only for repeats in a jump. A single firing keeps its own line. Clauses describe a stretch of time, which a single moment doesn't.
- **Joined sentences** are always atmosphere. `joins` and `clause` go together, or neither.

## Consequences

- Without `standsOut`, a game's fuses and daemons now share a paragraph where they used to have one each. That's the intended default for atmosphere.
- Whether perception or action results can be atmosphere too is left open.
