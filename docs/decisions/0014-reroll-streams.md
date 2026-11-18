# 0014. Streams that reroll on undo

- **Status:** Accepted, 2026-11-18
- **Issue:** [#226](https://github.com/loominate-if/loominate-if/issues/226)
- **Design:** [Randomness](../DESIGN.md#randomness), design principle 4 (determinism)

## Context

A stream's position is ordinary state (ADR 0008), so undo rewinds it and retrying gives the same result. Some streams should give something new on retry, such as flavor text or a fortune teller. The design lets authors opt a stream out.

A stream that rerolls must still keep save, load, and replay exact. Undo trims the action log (ADR 0009), so a replay holds only the path the player kept and knows nothing of what was undone. Whatever makes a retry differ has to be recorded in that path.

## Decision

- `randomStream(name, { undo: "reroll" })` makes a stream that rerolls on undo; the default is `"rewind"`. Substreams undo as their parent does.
- **Attempts.** The story counts how many times an action has been taken at each point in the log, in the `$attempts` entity. Undo and redo leave `$attempts` alone, so after undoing action 3 and taking another, the story knows it's attempt 1 there. The logged action records `attempt` when it isn't 0.
- **Moves.** Each move has a name: `begin`, or the action's number and attempt, as `3.1`. The story keeps it at `$random.move`.
- **Draws.** A rerolling stream's draws in a move start from the cyrb128 hash of `<seed>\0<name>\0<move>`, warmed up as in ADR 0008, and carry on from there within the move. So a retry draws differently, a move that isn't retried draws exactly as before, and the stream never affects any other.
- **Replays** record each action's `attempt` (replay version 4) and play it back, so they reproduce the state exactly. A save carries `$attempts` and the stream's position like any other state, so it carries on the same way after loading.

## Consequences

- A rerolling stream starts afresh in every move, rather than running on continuously. Within a move it's an ordinary stream.
- `$attempts` gains one small field per action, like the action log.
- The history has one entity it never undoes. Anything else that should survive undo needs its own decision.
- The derivation, the move name format, and `$attempts` are part of the replay and save contract, like ADR 0008's generator.
