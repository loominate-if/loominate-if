# 0030. Recording events from passages and story code

- **Status:** Accepted, 2026-11-21
- **Issue:** [#261](https://github.com/loominate-if/loominate-if/issues/261)
- **Design:** [Core runtime](../DESIGN.md), [ADR 0015](0015-compiler-extensions.md), [ADR 0028](0028-inspector-shell.md)

## Context

Events carry tags, the event record can be queried by tag, and the inspector's event log filters by them. But authors had no way to record an event. `emit` was on the context core passes to effect phases, but passage code couldn't see it, `story.ts` couldn't reach the record at all, and core's own events carried no tags, so nothing could be found by tag.

## Decision

### Passage tags on events

- Every event recorded while the player is in a passage carries the passage's tags, before any the event gives itself: its prose, its effect phases, its beats, the move into it, and author events. A role tag is written as in the passage, such as `room: platform`. Filtering the log by `scene` finds everything that happened in `[scene]` passages.
- The move into a passage carries the tags of the passage moved into. Events recorded before any passage, such as the `gameStart` hook's, carry none.

### Recording from a passage

Passages have two ways to record, for different needs:

- **`{emit "The lamp is lit.", tags: lamp}`**, a directive, for the common case of a line of text with tags. The kind is `system` unless `kind:` names another text kind: `narrative`, `scene`, `dialogue`, or `action-result`. Its arguments follow the other directives: comma-separated, with tags as plain words (`tags: ship storm`). It compiles to a call of core's `emitEvent`.
- **`emit(kind, fields, tags)`** in effect code, beside `visits` and `firstVisit`, for custom kinds, kinds a package adds, and events recorded only sometimes. Its fields are type-checked against the event kinds.
- Both record when the player reaches them, never when the passage is only shown (design principle 3). `{emit}` at the top level runs with the `{on enter: …}` code of its part, in the order they're written, so after a beat it records when the player reaches that part. Inside a block, such as `{if}`, it's a compile error. A call of `emit` in shown text is a compile error, found by the same check that catches assignments there.

### A new kind of directive

- `{emit}` needs a directive with arguments that runs on arrival. A `content` directive runs while the passage renders, so it must stay pure, and an `effect` directive takes code, not arguments. The extension API gains a fourth kind, **`arrival`**: `{name args}` at the top level of a passage, compiling to a call of its runtime export with the arguments as one object and the effect context, beside the `{on enter: …}` code of its part.
- Core's `{emit}` registers through it like any package's directive (design principle 7), and kits can add their own, such as a visual novel kit's `{play music}`.

### Recording from story code

- Core exports `emit`, with the record's signature. It records in the story that's playing, the same way objects reach its store (ADR 0006), and its events carry the tags of the passage the player is in. An object's method in `story.ts` can record events without being passed anything.
- Like an object write, it throws if called while a passage renders, and if no story is playing.
- Events are state: undo takes them back, saves keep them, and a replay records them again.

### Left for later

- How authors tag prose itself, line by line, is decided with the story log ([#126](https://github.com/loominate-if/loominate-if/issues/126)). A passage's tags already cover all of it.
- The page shows only prose events, so a `system` event shows in the log but not to the player. Whether and how the page shows them is [#270](https://github.com/loominate-if/loominate-if/issues/270).

## Consequences

- `emit` is reserved in passage code, like `visits`: a scope module that exports `emit` is an error, and `{emit …}` is a directive.
- The extension API has a public `arrival` kind, and core has public `emit`, `emitEvent`, and `TextEventKind`.
- Events in games made before this carry no passage tags; new events do. The save format is unchanged, since tags were always part of an event.
