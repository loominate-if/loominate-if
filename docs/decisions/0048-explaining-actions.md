# 0048. Explaining actions in the inspector

- **Status:** Accepted, 2026-11-22
- **Issue:** [#80](https://github.com/loominate-if/loominate-if/issues/80)
- **Design:** [Dynamic context menus](../DESIGN.md#dynamic-context-menus), [ADR 0028](0028-inspector-shell.md), [ADR 0044](0044-action-pipeline.md), [ADR 0046](0046-context-menus.md)

## Context

The inspector should list which conditions hid any action. Its Choices panel explained action links with the reason their verify or check gave. It didn't explain the actions on things' menus, which no passage writes out, and it didn't say which rule gave the reason. Any package can add verify and check rules, so the reason alone doesn't say where to look.

## Decision

- `statusOf` returns `by`, the rule that hid or disabled the action: its stage (`verify` or `check`), rulebook, rule name, and source. An action link's guard carries the same `by`. Each rulebook it runs is still traced, so the Rules panel sees it as before.
- An action's definition takes an optional `source`, the package that defines it, which its own rules (`<name>: own`) are credited to. The world model's standard actions give `@loominate-if/world`. It defaults to `game`, as every rule's source does.
- The inspector registers a second explainer, **Actions**, after Links. It lists, once each, the actions `actionsFor` offers for the things with a `{menu …}` link in the passage, then for core's `actionCandidates()`, which with the world model are the things the player can reach or carries. That covers the inventory, and things in the room with no menu link. Each action is shown with whether it's available and, if it isn't, its reason and the deciding rule.
- `actionCandidates()` is a new core export that reads what `useCandidates` set, so the inspector doesn't depend on the world model.
- The panel shows only the deciding rule, not every rule that ran. The Rules panel already shows every rule that ran each turn.

## Consequences

- A story with no actions shows an Actions section with "None here."
- Things out of reach aren't listed, since they aren't candidates. Why a distant thing's action is unavailable is plain, and listing every thing in the game would bury the ones that matter.
