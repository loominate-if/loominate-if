# 0112. Splitting up

- **Status:** Accepted, 2026-11-25
- **Issue:** [#139](https://github.com/loominate-if/loominate-if/issues/139)
- **Design:** [Companions](../DESIGN.md#companions), [ADR 0098](0098-companions.md), [ADR 0100](0100-orders.md), [ADR 0101](0101-knowledge-sharing.md)

## Context

Companions accompany the player or wait (ADR 0098), take orders (ADR 0100), and share what they know by policy, with a "what they found" topic (ADR 0101). The design's third state, independent, sends a companion off with an agenda; what they see becomes their sourced knowledge, and on reunion they tell it, recorded as dialogue. Until now, NPCs moving through `go` didn't see where they arrived, and nothing taught a fact by being seen.

## Decision

- **`sendOff(npc, { to, then })`** sends a companion off during play, to a place. Their state is `independent`, and they act even unseen, a step a turn toward it through `go`. Arriving is that turn; then, with `then: "return"`, the default, they head back to the player, wherever the player is, and with `"wait"` they wait there. The errand is state.
- **A standard order,** "Ask Mira to search the library", on a companion's menu for each place the game marks with `searchable(…)`, but the one they're in. Each place gets an order of its own, with the place fixed, since a menu fills an action's other roles only from what's in sight, and the place to search isn't. It goes through `obeying` and the search action's check, so a companion can refuse or say there's no way there.
- **NPCs see where they arrive.** `go` notes what the NPC can see in the room they come to, as arriving does for the player, so a companion knows of what they saw.
- **Facts found by seeing:** a thing or place that says `found: fact` teaches whoever first sees it that fact, sourced to the thing: a companion on an errand, the player, anyone. Other discoveries are the game's own rules.
- **The report:** when an errand ends with the player, the companion tells the facts they learned on it that the player doesn't know, as their own words, an `action-result` tagged `topic` and their `speaker:`, so the page and the story log show it as their dialogue; then the player learns them from the companion. With nothing new, "“Nothing worth telling,” Mira says." It comes before sharing by policy, so under the default `reunion` policy the report is still said. Then they accompany the player again, or, sent to wait, wait.

## Consequences

- The design's three companion states are all there, from the same pieces: NPC turns, `go`, perception, and knowledge.
- Any NPC moving through `go` now sees where they arrive, so `knowsAbout` holds for what an NPC has walked past, as it does for the player.
- A player who walks into the room themselves first sees what the companion saw, and the report has nothing new: what the player learned for themselves is theirs.
