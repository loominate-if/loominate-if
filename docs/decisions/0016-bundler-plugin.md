# 0016. Bundler plugin

- **Status:** Accepted, 2026-11-18
- **Issue:** [#35](https://github.com/loominate-if/loominate-if/issues/35)
- **Design:** [Tooling](../DESIGN.md#tooling), [ADR 0001](0001-repository-layout.md), [ADR 0005](0005-passage-modules.md)

## Context

The dev server (#53) and the builds (#55, #56) need passage files compiled into modules a bundler can load, recompiled incrementally as the author edits them. Two things had to be chosen: the bundler, and where the integration lives. The compiler only had `compileProject`, which compiles everything from scratch every time.

## Decision

### Vite

The CLI uses **Vite 8**, pinned to 8.3.5. Its dev server has hot module replacement built in, and the same plugin serves the production builds. It's a dependency of `@loominate-if/cli` only, which is tooling, so nothing of it reaches a game's bundle (ADR 0001, rule 5).

### An incremental session in the compiler, the plugin in the CLI

- `createCompilerSession(options)` keeps a game compiled between edits. `update(path, text)` (or `undefined` to remove a file) regenerates only what the edit affects, and returns the passage files whose modules changed and whether the passage-names module did:
  - each passage file's module is cached with the text and scope exports it came from;
  - a TypeScript file's change re-reads the scope module's exports, and every passage module is regenerated only if they changed;
  - type-checking reuses the previous program and unchanged source files, and runs only when diagnostics are asked for.
- `compileProject` is now a session used once.
- The compiler stays free of any bundler, so the language server (#148) can use the same session.
- `loominate(options)` in `@loominate-if/cli` is the Vite plugin. It reads the game's passage files and TypeScript modules at startup (skipping `node_modules`, `dist`, and hidden directories).
  - `import { passages } from "./cellar.weft.js"` (TypeScript's NodeNext name for it) or `"./cellar.weft"` resolves to the generated module `cellar.weft.ts`. Vite compiles it as TypeScript, with the source map back to the passage file.
  - On a change, the plugin updates the session once, shared by every Vite environment, and hot-updates the modules it regenerated. A passage file is known to Vite only through its module.
  - The dev server logs the game's problems after each change. A build fails on errors, listing them at the author's lines, and reports warnings.

## Consequences

- Game code imports each passage file. Whether the CLI gathers every passage file into one module for the game's entry is for the dev server and builds (#53, #55) to decide.
- The plugin type-checks the whole game after every edit. That reuses earlier work, but large games may need it debounced or moved off the update path; #53 can measure.
- Module-level handles (ADR 0012) still need resetting when a module is evaluated again on hot update. That's the dev server's job (#53).
- Finding packages' compiler extensions is #238, decided in [ADR 0023](0023-game-config-and-cli-commands.md): `loominate dev` and `loominate build` read them from `loominate.config.ts` and pass them to the plugin.
- Upgrading Vite is a deliberate change to the CLI's pinned dependency.
