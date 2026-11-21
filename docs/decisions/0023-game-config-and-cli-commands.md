# 0023. Game configuration, CLI commands, and the scaffold

- **Status:** Accepted, 2026-11-19
- **Issues:** [#238](https://github.com/loominate-if/loominate-if/issues/238), [#52](https://github.com/loominate-if/loominate-if/issues/52)
- **Design:** [Tooling](../DESIGN.md#tooling), [Extensibility](../DESIGN.md#extensibility), [ADR 0015](0015-compiler-extensions.md), [ADR 0016](0016-bundler-plugin.md), [ADR 0022](0022-player-shell-and-browser-saves.md)

## Context

`compileProject({ extensions })` takes packages' compiler extensions in load order, but nothing found them (ADR 0015). The dev server, builds, tests, and the language server all need the same extensions in the same order, written down by the author. A new game also needed a scaffold. Until now every game wired up its own Vite config, entry module, and `playGame` call, repeating its ID and start passage.

## Decision

### `loominate.config.ts`

A game's root holds a typed config file, read by every tool:

```ts
import { defineConfig } from "@loominate-if/cli";

export default defineConfig({
  game: { id: "lantern-road", version: "1.0.0" },
  title: "Lantern Road",
  start: "Start",
  extensions: ["@loominate-if/world"],
});
```

- `game` is the ID and version that saves record, `title` is the start screen's, and `start` is the passage a new game starts in. `scope` names the scope module when it isn't `story.ts`.
- `loadConfig(root)` reads the file through Vite's module runner, so it's TypeScript without a build step, and checks it. A missing file or a missing or mistyped field is an error saying what to write.

### Finding extensions

- `extensions` lists packages by name, in load order. The order is written down by the author, not inferred, and core's own extension always loads first (ADR 0015).
- A package provides an extension by naming its module in its package.json: `"loominate": { "extension": "./dist/extension.js" }`. The module default-exports the `CompilerExtension`. It's data, importing compiler types only, so runtime packages take no compiler dependency (ADR 0001). It's found with Node's `findPackageJSON`, so it needs no subpath export.
- A listed package that isn't installed, one with neither `loominate.extension` nor `loominate.inspector`, or a module with no default extension is an error naming the package and the fix.
- A package can also name an inspector module, `"loominate": { "inspector": "./dist/inspector.js" }`, and a game its own with `inspector: "./inspector.ts"`. These are imported only where the inspector is ([ADR 0028](0028-inspector-shell.md), #188).

### `loominate dev` and `loominate build`

- `loominate dev` serves the game with hot reload, and `loominate build` writes a static site to `dist/` with relative URLs, failing on any error in the game. Both read the config and run Vite with the passage compiler (ADR 0016), so they compile with the same extensions in the same order. The test runner will read the config the same way.
- A `vite.config.ts` in the game, if any, is merged in for anything else the game needs from Vite. #53 and #55 build on these commands: state-preserving reload, the error overlay, and the build targets.

### The generated entry point

`index.html` loads `/@loominate/main`, a module the CLI generates. It imports every passage file in the game and calls `playGame` (ADR 0022) with the config's ID, version, title, and start passage. Adding or removing a passage file regenerates it. A game that wants its own shell points `index.html` at its own module instead.

### The scaffold

`npm create @loominate-if my-game` writes a game into a new or empty folder, and never into one with files:

- `start.weft`, one passage file, and `story.ts`, one module;
- `loominate.config.ts`, with an ID made from the folder's name;
- `index.html`, `package.json` with `dev` and `build` scripts, `tsconfig.json` for editors, and `.gitignore`.

The `@loominate-if` packages it depends on are the scaffold's own version.

## Consequences

- A new game is a passage file and a module, with no build plumbing. Vite stays an implementation detail unless the game needs it.
- The ID, version, and start passage are written once, in the config.
- The language server, when it's built, will call `loadConfig` too.
- Tests in this repository read packages from source. A config's import of `@loominate-if/cli` can't be loaded natively from TypeScript sources inside the test runner, so those tests install a stand-in exporting `defineConfig`, as a published build would.
