# 0027. The first acceptance games

- **Status:** Accepted, 2026-11-19
- **Issue:** [#8](https://github.com/loominate-if/loominate-if/issues/8)
- **Design:** [Roadmap](../DESIGN.md#roadmap), [Open questions](../DESIGN.md#open-questions), [ADR 0026](0026-walkthrough-tests.md)

## Context

Each phase ends when a small acceptance game passes its walkthrough tests (gates #2, #59, and #102). The design proposed two games: a plain branching story with no world model (gate 1), and a short world-model piece with a container, a locked door, and an NPC with three topics and an agenda item (gate 2). But topics, conversations, and agendas are Phase 3 work, so gate 2 as proposed couldn't pass until Phase 3 was done.

## Decision

Each gate tests its own phase. Topics and the agenda move from gate 2 to gate 3.

### Gate 1: `examples/branching-story` (#2)

A short original branching story of about 10–15 passages with two or three endings, using core and presentation only. Between them, its passages use:

- links, a link inside a paragraph, and link guards: hidden, disabled, and disabled with a reason;
- conditional text and printed values from the game's objects;
- every effect phase (`on first visit`, `on enter`, `on leave`) and a continue point;
- a timed beat, a wait, a page break, and effects written after a beat;
- a named effect;
- a random stream, so its walkthroughs check determinism.

It passes when:

- it builds to the static site and the single file;
- walkthrough tests play it from the start to each ending, asserting on state and output, and check that save and load, undo, and replay reproduce state, and that effect phases never rerun on reload or re-render;
- its bundles contain no world-model code;
- it plays in a browser, checked by hand.

### Gate 2: `examples/world-model` (#59)

A short world-model piece with a container, a locked door with its key, and an NPC who is present, can be given or shown things, and reacts through rules. A walkthrough exercises containment, the locked door shown disabled with a reason in menus and the compass, unlocking, and the NPC. Save, load, undo, and replay reproduce state, and the gate 1 story still builds without world-model code. It has no topics or agenda.

### Gate 3: `examples/conversation-demo` (#102)

As planned, plus the topics and agenda moved from gate 2: an NPC with at least three topics and an agenda item, alongside scheduled NPCs, conversation nodes, and exit control.

## Consequences

- Gate 2 can pass at the end of Phase 2, so Phase 3 can start on time.
- Gate 3 is the first to test conversations of any kind, so it carries more.
- The gate 1 story is also the getting-started tutorial's example (#57), so the tutorial's code is compiled and tested in CI.
