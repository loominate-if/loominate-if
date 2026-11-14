# 0001. Repository and package layout

- **Status:** Accepted, 2026-11-14
- **Issue:** [#7](https://github.com/loominate-if/loominate-if/issues/7)
- **Design:** [Architecture](../DESIGN.md#architecture), [Open questions](../DESIGN.md#open-questions)

## Context

The design calls for a small core with optional layers above it and tooling beside it. A plain branching story must never pay for the world model or kits. The first proposed layout in AGENTS.md had four problems:

- It bundled all kits into one package.
- It had no home for the language server, generic player, archive format, or parser.
- It put app-store toolchains in the CLI.
- It left open how the compiler and inspector would support world and kit features without depending on them.

## Decision

A pnpm monorepo with these packages:

```
packages/
  core/              DOM-free runtime: state store, passages, effect phases, action pipeline,
                     event record, save/undo, random streams
  presentation/      layouts, regions, widgets, themes, beats, effects, audio, accessibility
  world/             world model (optional): objects, rooms, exits, minds and bodies, knowledge,
                     scenes, clock and scheduling, stats/traits/relationships, NPCs,
                     conversations, compass widget
  compiler/          passage parser, virtual TS modules, line IDs, diagnostics, extension API
  inspector/         in-game debugging panel with a panel registry
  testing/           walkthrough test API that authors import
  cli/               dev server, test runner, builds (static site, single file, PWA),
                     story map, coverage reports
  create/            scaffold: `@loominate-if/create` (`npm create @loominate-if`)
  language-server/   editor-agnostic LSP built on the compiler (Volar.js)
  vscode/            thin VS Code client: TextMate grammar + LSP client
  archive/           .loom read/write, manifest, IFID, service worker
  player/            generic player: sandboxed iframe, strict CSP
  target-tauri/      desktop wrapper and custom protocol handler
  target-capacitor/  mobile wrapper
  parser/            natural-language parser (later)
  kits/rpg/          one package per kit (later)
  kits/procgen/
  kits/vn/
  kits/life-sim/
examples/            acceptance games, each a workspace package built and played by `pnpm test`
docs/                DESIGN.md, decisions/ (ADRs), author docs
```

Rules:

1. **Dependencies flow downward only.** Runtime layers stack as `core` ← `presentation` ← `world` ← kits. Kits never depend on each other unless the design says so. Tooling packages may depend on runtime packages; runtime packages never depend on tooling.
2. **Clock and scheduling live in `world`.** Plain branching stories don't need them. Core's action stage exposes a time-cost hook with no clock of its own, and `world`'s clock implements it ([#76](https://github.com/loominate-if/loominate-if/issues/76)).
3. **Optional packages extend tooling through registries, not dependencies.**
   - The compiler exposes an extension API for directives, tag roles, line forms, and diagnostics, and core syntax is built on it ([#187](https://github.com/loominate-if/loominate-if/issues/187)).
   - The inspector exposes a panel registry ([#188](https://github.com/loominate-if/loominate-if/issues/188)).
   - `world` and kits register into both, so neither tool depends on them.
4. **`core` never touches the DOM**, so walkthrough tests run headless in Node. DOM access is limited to `presentation` and widget render code.
5. **Nothing from `compiler` (or its TypeScript dependency) or `inspector` reaches a production game bundle.** Lint rules enforce rules 1, 4, and 5, and a bundle-size check on the Gate 1 game verifies them.
6. **Heavy toolchains stay out of `cli`.** Tauri and Capacitor live in their own target packages. PWA output stays in `cli` because it is only a manifest and service worker on top of the static build.
7. Package names and the npm scope are settled in [ADR 0002](0002-project-name-and-package-names.md): `@loominate-if/<package>`.

## Consequences

- Authors install only what they use. `@loominate-if/create` produces a game depending on `core`, `presentation`, `cli`, and `testing`, and `world` is added when needed.
- The compiler and inspector extension APIs are Phase 1 work. They are public API, and later phases depend on them.
- More packages mean more release coordination. The packages are versioned together until 1.0.
- `archive/` keeps the `.loom` format in one place. Changes to that format still need approval (AGENTS.md).
- Story map and coverage stay as CLI commands. They can move into the inspector later without a layout change.
