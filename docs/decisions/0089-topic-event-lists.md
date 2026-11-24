# 0089. Topic event lists

- **Status:** Accepted, 2026-11-24
- **Issue:** [#112](https://github.com/loominate-if/loominate-if/issues/112)
- **Design:** [Topic entries](../DESIGN.md#topic-entries), [ADR 0088](0088-topic-entries.md)

## Context

Topics the player asks about again need responses that change: adv3Lite's event lists, which stop at the last, cycle, or shuffle. Shuffling must replay exactly from a seed and the moves.

## Decision

- **A list goes in `says`.** An entry's `says` can be a list of responses, each text or a function, as a single `says` is. `order` chooses how they're said:
  - `stop`, the default, says each in turn, then the last again;
  - `cycle` goes back to the first;
  - `shuffle` deals a shuffled deck each round, saying every response once. It swaps the first two if a new round would start with the one just said.
- **Shuffling draws** from the `world:topics` random stream's substream for the entry, named by its ID.
- **How far each list has got is game state** (`world:topicLists`): how many times it has answered and, for a shuffle, the rest of the round and the last said. So undo, saves and replays agree.
- An empty list, or `order` without a list, is an error when the game loads.

## Consequences

- A list's progress is keyed by the entry's ID, which includes its position among the NPC's entries. Inserting an entry before it in `story.ts` restarts its list in an older save. Compiled topic blocks (#115) can give entries stable IDs from their lines.
- `{ask letter, again}` in passage files (#115) can compile to a list, or to an entry with a condition.
