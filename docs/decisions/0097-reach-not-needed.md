# 0097. Things that needn't be in reach

- **Status:** Accepted, 2026-11-24
- **Issue:** [#362](https://github.com/loominate-if/loominate-if/issues/362)
- **Design:** [Design principle 7, open library](../DESIGN.md), [ADR 0044](0044-action-pipeline.md), [ADR 0088](0088-topic-entries.md)

## Context

The world model's `things in reach` verify rule hides an action if any thing it names is out of the actor's reach. Topic actions need some exempt: you ask someone present about something anywhere. #111 added an internal hook for that. By the open-library principle, authors' own actions need the same, as "think about {thing}" or "point at {thing}".

## Decision

- **`reachNotNeeded(action, ...things)`,** from the world model, called in `story.ts`, says which of an action's things, by name, needn't be in reach. The names are typed by the action's own arguments.
  - The reach rule skips them; the action checks them itself if it needs to.
  - Reach is the world model's idea, so it's a world function, not a field on core's action definition.
- **Errors:** it throws during play, and when no thing is named.
- **The world's own uses:** `ask`, `tell` and `hello` use it, replacing the internal hook.

## Consequences

- An action that names a thing out of reach still needs the player to know of it, or another check, if that matters. The reach rule no longer stands in for it.
