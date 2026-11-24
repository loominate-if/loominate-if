# 0092. Topic blocks in actor passages

- **Status:** Accepted, 2026-11-24
- **Issue:** [#115](https://github.com/loominate-if/loominate-if/issues/115)
- **Design:** [Authoring](../DESIGN.md#authoring), [ADR 0015](0015-compiler-extensions.md), [ADR 0088](0088-topic-entries.md)

## Context

Dialogue should live in passage files, one block per topic entry, as `:: Butler [actor: butler, state: onDuty]` with `{ask letter, when: …}`, `{ask letter, again}` and `{show photograph}`. Blocks use the same effect phases as passages, and give dialogue line IDs. Undefined topics and actors must be compile errors. The compiler extension API had no way for a directive to own the prose after it.

## Decision

- **A new extension directive kind, `section`.**
  - A section directive, usually limited to tag roles, starts a block at the top level of a passage. The block runs to the next section or to the passage's end.
  - The block's prose and effect phases compile to a passage-shaped object (`id`, `tags`, `effects`, `body`), so rendering, line IDs and effect phases are shared with passages.
  - As the game loads, the package's runtime is called once per block as `runtime(args, block, { id, directive, roles })`. The arguments are type-checked as usual. A `condition` argument is passed as a function, since nothing can be evaluated before play. `roles` holds the passage's tag role values.
  - A block's ID is the line ID of its first paragraph, as `Maid:3f2a9c`, so it's stable across edits around it. (As first merged, the lookup found no line at the directive and fell back to the block's position; #119 fixed that.)
  - Blocks can't hold links, beats, or `{on leave: …}`. Tag roles can say `sections: true`, making anything before the first section an error.
- **Optional words:** an optional `choice` argument can be left out. A word a later optional choice takes skips ahead to it, so `{give locket, takes}` works without `again`.
- **The world model registers:**
  - tag roles `actor:` (with `sections: true`), `state:` and `scene:`, each with a `register` function, so their values are checked;
  - the blocks `{ask}`, `{tell}`, `{ask or tell}`, `{show}`, `{give}`, `{show or give}`, `{yes}`, `{no}`, `{hello}` and `{bye}`, limited to `actor:` passages.
- **`topicBlock`, the world's runtime,** adds a topic entry for each block:
  - the passage's `state:` or `scene:`, or the block's `in:`, scopes it (only one of them);
  - the block's ID becomes the entry's ID.
  - When the entry answers, it runs `{on first visit: …}` the first time and `{on enter: …}` and arrival directives such as `{reveal}` every time. It then records each paragraph as an `action-result` with its line ID. Core gains an internal `_effectContext(passage)` for this.
- **`again`** (also `again: true` in TypeScript) applies only once the NPC has answered the same exchange before, by any entry. Among entries of the same priority it comes first. Counts of entries and exchanges answered are game state.
- **Entries take an optional stable `id`.**
- **A directive limited to a passage's roles,** such as `{ask}` in an actor passage, no longer clashes with a scope export of the same name, since it can't be a printed expression there.

## Consequences

- Kits can use sections for their own blocks, such as a visual novel's choice menus or a life sim's events.
- Cycling and shuffled lists stay TypeScript-only until passage syntax for alternatives is decided.
- The coverage report (#130) can list topic blocks by their IDs.
