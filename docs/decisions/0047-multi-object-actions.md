# 0047. Multi-object actions

- **Status:** Accepted, 2026-11-22
- **Issue:** [#78](https://github.com/loominate-if/loominate-if/issues/78)
- **Design:** [Dynamic context menus](../DESIGN.md#dynamic-context-menus), [ADR 0044](0044-action-pipeline.md), [ADR 0046](0046-context-menus.md)

## Context

"Use the crowbar on the crate" should be offered only when all its participants are present. An action could already take several things, from a link that named them all, but a menu called each action with only the menu's thing.

## Decision

- An action's `with` names its other things by role, for menus to fill in. Each role is a fixed thing, as in `with: { tool: crowbar }`, or a test for things that suit, as in `with: { blade: (t) => isSharp(t) }`. `with` can't fill `thing`, which is the role whose menu offers it, or `actor` and `body`.
- A test is tried on the things core's `useCandidates` provider gives. The world model provides the things the player can reach. Without a provider, menus fill only fixed roles.
- `actionsFor(thing)` offers an action on every participant's menu. That covers the menus of the things it's `on` or `for`, with the thing as `thing`, and of the things that fit one of its `with` roles, with every thing it's offered on as `thing`. Other roles are filled every way they can be, one menu entry each, never with the same thing twice.
- A participant out of reach hides the action. The world's "things in reach" rule already checks every thing an action has, so nothing new is needed.
- The standard lock and unlock actions stay single-object, needing the key the player carries. A game that wants "Unlock the chest with the iron key" writes it with `with`.

## Consequences

- A menu's actions grow with the number of candidates, as one entry per suitable thing in reach. A broad test, like "anything portable", can make a long menu, so tests should be narrow.
- The action log and the replay format don't change: an action call was already logged with each of its things as a `$ref`.
- A parser, later, can fill the same roles from what the player typed.
