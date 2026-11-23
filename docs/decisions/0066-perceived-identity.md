# 0066. Perceived identity, disguises, and attitudes

- **Status:** Accepted, 2026-11-24
- **Issue:** [#66](https://github.com/loominate-if/loominate-if/issues/66)
- **Design:** [World model library](../DESIGN.md#world-model-library), [ADR 0032](0032-minds-and-bodies.md), [ADR 0035](0035-knowledge-and-facts.md)

## Context

NPCs see bodies, not minds. Who they think they're addressing is a belief. Relationships are keyed by minds, but NPC responses depend on who they believe is present. Disguises and shapeshifting make appearance diverge from identity. "You" already followed the player's mind, and descriptions came from the body (ADR 0032), but nothing modelled what others believe. Relationships didn't exist.

## Decision

- **Whose body it is:** a body belongs to the mind whose definition starts it in control: an actor's own mind, or a mind defined with `inhabits`. Others take the body for that mind, whichever mind is in it now. So Bob possessing Roy is taken for Roy.
- **Disguises:** `disguise(body, { as })` makes a body pass for another actor, or, given words, for a stranger, as `"a hooded figure"`. `undisguise` ends it, and `disguisedAs` says what it passes for. Disguises are state.
- **Belief:** `whoIs(observer, body)` is who the observer believes the body is:
  - the mind really in it, if they've seen through it;
  - otherwise whoever it's disguised as (`undefined` for a stranger);
  - otherwise whoever it belongs to.
- **Seeing through:** `expose(body, observer)` records that the observer has seen who's really there, through the disguise and past whose body it is. It's kept with the mind and the disguise at the time, so a new disguise, or another mind in the body, can fool them again. `seesThrough(observer, body)` says whether they do now.
- **How things start:** called in `story.ts`, as the game loads, `setAttitude` (now `setRelationship`) and `disguise` set how things start, kept as authored data like the clock's start. During play they change state, over the starting values. Core gains an internal `_storyRunning()` for packages to tell the two apart. (Found in review: calling `setAttitude` in `story.ts` failed with "no story is running".)
- **Recognising:** everyone recognises everyone; there's no record of who's met whom. A game can treat someone as a stranger in its own rules.
- **Attitudes, a minimal relationship:** `attitude(observer, mind)` is a number, 0 unless `setAttitude` or `changeAttitude` sets it, kept by minds. `attitudeTo(observer, body)` reads the attitude toward whoever the observer believes the body is, so what an NPC does follows the disguise, while how they feel about the real person doesn't change. *Superseded by [ADR 0067](0067-relationships.md): relationships replace attitudes, and `relationshipTo` replaces `attitudeTo`.*

## Consequences

- The text layer still names a body by its own name, so `{the roy}` says "Roy" even in disguise. Naming a disguised body as the player sees it would make naming depend on who's perceiving, which is left for later.
- NPC agendas, conversations, and richer relationships build on `whoIs` and attitudes.
