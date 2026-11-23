# 0059. Closing time, and redirecting a move

- **Status:** Accepted, 2026-11-23
- **Issue:** [#316](https://github.com/loominate-if/loominate-if/issues/316)
- **Design:** [Time and scheduling](../DESIGN.md#time-and-scheduling), [ADR 0050](0050-fuses-and-daemons.md), [ADR 0058](0058-time-aware-content.md)

## Context

With opening hours (ADR 0058), someone inside at closing time is free to leave, and nothing else happens. A game should be able to opt in to more, such as the baker glaring after five minutes and showing the customer out after twenty. The player may have something to finish first, so it can't be automatic.

Showing the player out means changing passages partway through a move: a wait, an action, or another move, when a fuse fires. Core forbade that.

## Decision

- **`redirect(passage)`** (core) can be called from an effect, an action, or a fuse or daemon as it fires.
  - When the move's passage has been entered, the story goes on to the redirected one, within the same move and transaction: one undo step, and nothing extra in the action log, so replays redirect the same way. A later call in the same move wins.
  - Redirects made in `turnEnd`'s rules, such as fuses counted in moves, are followed after it.
  - The redirected navigation event says `redirected: true`. The page, the story-so-far drawer, and the walkthrough API don't start a new move at it, so what was noticed before it stays with the move.
  - Calling it outside a move is an error. More than 20 redirects in one move are taken for a loop, and the move is rolled back.
- **`closingTime(door, steps)`** (world) is a load-time helper for a door with opening hours. A step's code can't be stored in state, so it isn't part of `openingHours`.
  - It builds a daemon at the door's closing time, which reads the hours from state each time through a function `at`. Daemons now accept that.
  - When the daemon fires, it checks that the place was open a minute before and that the player is inside, then starts a fuse for each step.
  - **What a step does:** `say`, `moveTo` (moves the player's body and redirects to the place's room passage), or `do`.
  - **When it acts:** only while the player is still inside. It stands out, and if it does anything during a jump of the clock, it interrupts it.
  - **`unless`:** while it holds, the step waits in a list kept in state. A daemon every minute and one every move retry it, and both stop when nothing is waiting.
  - All of it is named `closing:<door>…`, so the inspector lists it.

## Consequences

- Only the player is shown out; NPCs come later, with NPCs.
- Other things can use `redirect`, such as trapdoors and chases, without waiting for the player's next choice.
