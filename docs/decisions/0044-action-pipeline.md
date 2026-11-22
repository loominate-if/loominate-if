# 0044. The action pipeline

- **Status:** Accepted, 2026-11-22
- **Issue:** [#76](https://github.com/loominate-if/loominate-if/issues/76)
- **Design:** [The action pipeline](../DESIGN.md#the-action-pipeline), [ADR 0012](0012-rulebooks-hooks-registries.md), ADR 0001 rule 2

## Context

Every action, whether from a menu, a passage link, an NPC, or a future parser, runs through TADS's four stages: verify, check, action, report. The stages must be replaceable rules, check failures must carry a reason, and core's action stage exposes a time-cost hook with no clock of its own. Menus (#77) don't exist yet, and until this change the action log, which replays reproduce, knew only links, `goTo`, and beats.

## Decision

### In core

- `action(name, { label, verify, check, run, report, minutes })` defines an action. Its things are typed by name, as `action<{ thing: Door }>`, and an action is called with them to make an `ActionCall`: `open({ thing: door })`. TypeScript checks the call against the action. `action`, `actor`, and `body` can't name things, since every action's rules see those.
- Each stage is a rulebook, seeded with the definition's function as the rule `"<name>: own"` (ADR 0012):
  - verify, check, and report are decide rulebooks: the first rule to give a reason, or text, wins;
  - the action stage is a list of rules that all run;
  - minutes is a fold.
- `everyAction.verify` and `everyAction.check` hold rules for every action, run before each action's own.
- `perform(call)` runs every stage. A verify or check failure records its reason as an `action-result` event and returns it. Otherwise the action stage runs, and the minutes, if any, go to the `actionTime` hook, which the world model's clock will handle (#84). The report is recorded as an `action-result` event. `statusOf(call)` runs verify and check without changing anything.
- `useActor(…)` lets a world model say who acts. Rules see `actor` and `body`.
- Core never touches the DOM. The page shows `action-result` events as notices (ADR 0037).

### Action links

- `[[Open the door]]{act open({ thing: cellarDoor })}`: `{act …}` is a core guard directive whose runtime, `actLink`, runs verify and check when the passage renders. A verify failure hides the link, a check failure disables it with the reason, and the guard carries the action.
- The compiler lets a guard directive say its link stays on the passage (`stays`), so the link needs no `->`, and its target isn't checked.
- Following an action link is a new move, `act`, logged with the action's name, its things as plain data (objects as `{ $ref: id }`), and the link's label. It runs the action in a transaction, after an `action` event that marks where the move starts, and stays on the passage. Undo, saves, and replays cover it. Replay files become version 6; versions 1 to 5 still read.
- The page, the drawer, and walkthroughs start a new move at an `action` event, so a report shows after the passage's text for its move, and the drawer keeps the turn.

### In the world model

- The player's mind acts, through the body it's in, so actions record both, following `playAs` and possession.
- `everyAction.verify` gets two rules: the actor needs a body, and the action's things must be in its reach. A failure hides the action, with a reason from the message table (`action.noBody`, `action.outOfReach`).

## Consequences

- Context menus (#77) gather action calls for an object and show them with `statusOf`, taking them as the same `act` move.
- Library actions (open, close, take, drop, go) and implicit actions (open the door first) come with the menus.
- Multi-object actions (#78) are action calls with two things, as `put({ thing, into })`.
- The clock (#84) adds a handler to `actionTime`.
