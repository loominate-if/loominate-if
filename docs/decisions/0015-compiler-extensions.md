# 0015. Compiler extensions

- **Status:** Accepted, 2026-11-18
- **Issue:** [#187](https://github.com/loominate-if/loominate-if/issues/187)
- **Design:** [Compilation and checking](../DESIGN.md#compilation-and-checking), [Extensibility](../DESIGN.md#extensibility), [ADR 0001](0001-repository-layout.md) rule 3, [ADR 0004](0004-passage-syntax.md)

## Context

The compiler can't know the world model or any kit (ADR 0001), yet games use their syntax: topic entries such as `{ask letter}` in `actor:` passages, the VN kit's `{show mira smiling, dissolve}` and `@mira "…"` lines, and roles such as `room:`. ADR 0004 fixed how directives are written: arguments are declared at registration, directives can be limited to tag roles, and two registrations of a name for the same passages are an error. It left open:
- how a package's directive becomes game code, when runtime packages can't depend on the compiler;
- how extensions reach the compiler, and in what order;
- how a game using syntax from a package it doesn't load hears which package to install.

## Decision

### Extensions are data

A package describes its syntax as a `CompilerExtension`: its name, directives, tag roles, line forms, and checks. Core's own directives are `coreExtension`, registered the same way. `if`/`else` and links are grammar, not registrations, as ADR 0004 said.

### Directives call runtime exports

Each directive has a kind:
- **`effect`**: `{name: code}`, statements run in a phase (`on enter`, `on first visit`, `on leave`).
- **`content`**: `{name args}` in a passage body. It ends the paragraph, and compiles to a call of the package's runtime export, with the arguments as one object, returning a passage node or an array of them. `{show mira smiling, dissolve}` becomes `$nodes.push(...[$rt_show({ sprite: ["mira", "smiling"], transition: "dissolve" })].flat())`, with `import { show as $rt_show } from "@loominate-if/vn"`.
- **`guard`**: `{name args}` right after a link, compiling to a call that returns the link's guard.
- **`arrival`**: `{name args}` at the top level of a passage that runs when the player reaches it, compiling to a call of the runtime export with the arguments and the effect context, beside the `{on enter: …}` code of its part. Added with core's `{emit}` ([ADR 0030](0030-recording-events.md)).
- **`annotation`**: `{name args}` that generates no code, read by the compiler or a package's checks.

So the runtime package only exports ordinary functions, and TypeScript checks each generated call against the function's real signature, reporting errors at the directive. Core's `{continue}` and `{when}` call core's `continueTo` and `linkGuard` the same way. A `content` or `guard` directive may instead say why it's `unsupported` (`{beat}` and `{wait}`, until #41). A content directive with `beat: true` divides the passage into parts, as core's `{beat}`, `{wait}`, and `{page}` do ([ADR 0021](0021-beats.md)).

### Arguments

Each argument declares its name, whether it's positional or named (`key: value`), whether it's required, and its kind. The compiler checks what's written and passes:
- `expression`: the value of the TypeScript, copied with its source map;
- `condition`: `{ value: Boolean(expr), text: "expr" }`, so the inspector can say why something is hidden;
- `duration`: `1.5s` or `300ms`, as milliseconds;
- `passage`: `-> Name`, checked like a link, as the name;
- `words`: `mira smiling`, as an array of strings;
- `choice`: one of the declared words, as a string.

An argument can exclude others (`{when}`'s `hidden` and `reason:`). Errors name the directive and what it takes, at the argument's position.

### Roles and conflicts

- A directive may be limited to tag roles. A definition limited to roles applies in those passages, and an unlimited one with the same name everywhere else: the world model's `{show}` topic in `actor:` passages, the VN kit's `{show}` elsewhere (ADR 0004).
- Two definitions of a name for the same passages, a name written in different forms (effect or guard against the others), two registrations of a tag role or a line-form prefix, a malformed definition, or a role no loaded package registers: each is an error naming the packages, thrown when the compiler starts, since it's the game's setup rather than a line of its source. Meaning never depends on load order.

### Tag roles, line forms, and checks

- A **tag role** may be an `entry`: passages with it are entered by its package (rooms, actors), so they're never reported as unreachable.
- A tag role from a known package that isn't loaded is an error. One that no package uses is a warning, since a game's own code may read its own roles.
- A **line form** is a prefix character (`@`) and a pattern whose named groups are passed, as strings, to its runtime export. It ends the paragraph. Without a registered form, the prefix is plain prose, as ADR 0004 said.
- A **check** runs over every parsed passage file after parsing and returns positioned diagnostics, reported as `source: "extension"` with the package and check named.

### Loading

`compileProject({ extensions })` takes extensions in load order, with core's always first. How the CLI and language server find them is [#238](https://github.com/loominate-if/loominate-if/issues/238), decided in [ADR 0023](0023-game-config-and-cli-commands.md).

### Unloaded packages

The compiler ships a catalog of which first-party package provides which syntax (`ask`, `tell`, `give`, `reveal`, `room:`, `actor:` → `@loominate-if/world`; `@` lines → `@loominate-if/vn`; `show` → either). Extensions add to it with `suggests`. A printed expression that is such a name, or starts with one followed by a space, comma, or colon, where the name isn't one of the game's exports, is reported as "`{ask}` comes from @loominate-if/world, which this game doesn't load. Install it and add it to the game's extensions." instead of a TypeScript error.

## Consequences

- `coreDirectives` and `ProjectOptions.directives` are replaced by `coreExtension` and `ProjectOptions.extensions`. Core gains `continueTo` and `linkGuard`, which generated modules import.
- Content directives and line forms end the paragraph, so they also start a new line ID (ADR 0007). Before this, only `{continue}` did, and it's the only content directive with a runtime, so existing line IDs don't change.
- Line forms have no line IDs of their own yet. Dialogue lines need them for skip-read and voice, which belongs to the VN kit's syntax (#176).
- A directive that changes state when shown, such as `{reveal}` in a topic entry, can't be a `content` directive, since rendering is pure. In a passage, an `arrival` directive does this when the player reaches it. Topic entries are compiled by the world model's conversation support (#115), which will decide where their effects run.
- Checking `t` message parameter names at compile time (#235) can build on extensions, by letting packages declare their parameters.
- The catalog has to be kept in step with the first-party packages as they add syntax.
