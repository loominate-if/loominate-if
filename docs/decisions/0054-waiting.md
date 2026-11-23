# 0054. Wait and wait-until actions

- **Status:** Accepted, 2026-11-23
- **Issue:** [#87](https://github.com/loominate-if/loominate-if/issues/87)
- **Design:** [Time and scheduling](../DESIGN.md#time-and-scheduling), [ADR 0044](0044-action-pipeline.md), [ADR 0046](0046-context-menus.md), [ADR 0051](0051-time-jumps.md)

## Context

"Wait" and "wait until" are ordinary actions on the pipeline. Menus so far are things' menus, and waiting isn't about a thing. An action's arguments are logged for replays, so they must be plain data.

## Decision

- **The actions:** the world model defines standard `wait({ minutes })` and `waitUntil({ time | fires | condition, atMost })` actions.
- **Offering them:** a passage offers them as links with `{act …}`. `waitMenu(choices)` adds an opt-in Wait button to the header, listing the waits a game gives it.
  - The button is presentation's new `menuWidget`, a button opening a menu of any action calls with optional labels.
  - Page menus now take a `MenuSource`: a thing's ID, or a function of `MenuChoice`s.
- **What a wait-until waits for:**
  - `time` is the next time it's that time of day; it isn't offered at that time.
  - `fires` names a fuse or daemon by ID; it isn't offered while that one isn't running.
  - `condition` names a condition from `waitCondition(name, holds)`, defined at load like fuses so replays stay plain data; it isn't offered while the condition holds.
  - `atMost` caps `fires` and `condition`, and defaults to a day.
- **Ending a wait:** `clock.advance` takes an `until` check, run after each fuse or daemon fires, since only firings change the world while time passes. When it holds, the advance ends after that minute's firings, and its result says `reached`.
- **Interruptions:** a wait is passive, so anything that interrupts stops it. It doesn't set a `stopsFor`.
- **Reports:** messages say how a wait ended: `wait.done`, `waitUntil.done`, `wait.interrupted`, or `waitUntil.gaveUp`. Labels are `wait.label` and `waitUntil.label`.
- **Mistakes:** naming nothing, more than one thing, an unknown fuse or condition, or a bad time or count is an error that explains it.

## Consequences

- A game's own action named `wait` or `waitUntil` now clashes with the standard ones. The error says to rename it.
- `MenuChoice.call` takes a call of any action. An action's type is invariant in its arguments, so no narrower type accepts them all.
