# 0055. Inspecting fuses and daemons, from the world model's own inspector module

- **Status:** Accepted, 2026-11-23
- **Issue:** [#91](https://github.com/loominate-if/loominate-if/issues/91)
- **Design:** [Tooling](../DESIGN.md#tooling-1), [ADR 0001](0001-repository-layout.md), [ADR 0028](0028-inspector-shell.md), [ADR 0050](0050-fuses-and-daemons.md)

## Context

The inspector should list scheduled events with their next fire time and source, and show whether each was cancelled.

ADR 0028 says a package registers its panels in an inspector module named in its package.json. That module has to import `@loominate-if/inspector`. But the layering check forbids a runtime package like the world model from declaring any tooling package, so no package could have one. The inspector can't import the world model either. And ADR 0001 keeps DOM access to presentation and render code, while the world model is compiled without DOM types.

## Decision

- **The module:** the world model has an inspector module in `src/inspector/`, named in package.json as `"loominate": { "inspector": "./dist/inspector/inspector.js" }`. It's its own TypeScript project, with DOM types and a reference to the inspector, and the main world project excludes it. It reaches the world model through the package's entry point, like any package would, plus one `@internal` export, `_scheduled()`.
- **The dependency:** world declares the inspector as an optional peer dependency, and as a dev dependency to build and test with. `check-deps` allows a runtime package that one tooling dependency, and only when:
  - the package names an inspector module in its own folder of `src`;
  - the inspector is an optional peer, not a runtime dependency;
  - no other file in the package imports it, so it never reaches a game build.
- **The panel:** **Fuses and daemons** lists every fuse and daemon in definition order, with:
  - its kind;
  - its state: Running, Not started, Fired, Cancelled, or Stopped;
  - when it fires next, as a time of day or a move, and how long until then;
  - its timing and flags (interrupts, stands out, priority, joins);
  - its source.
- **State:** fuses and daemons now record how they last ended (`fired`, `cancelled`, or `stopped`), so the panel can tell a cancelled fuse from one that went off. Starting one again clears it.
- **Source:** fuses and daemons take an optional `source`, like actions, defaulting to `game`.

## Consequences

- Other runtime packages, such as kits, can add inspector panels the same way.
- Saved fuse and daemon objects gain an `ended` field. Older saves lack it and read it as not ended.
