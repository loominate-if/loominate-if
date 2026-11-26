# 0131. Importing images and other files in story.ts

- **Status:** Accepted, 2026-11-26
- **Issue:** [#434](https://github.com/loominate-if/loominate-if/issues/434), part of [#147](https://github.com/loominate-if/loominate-if/issues/147)
- **Design:** [Build targets and distribution](../DESIGN.md#build-targets-and-distribution), [ADR 0025](0025-build-targets.md)

## Context

A map marker's icon (#396) is an image's URL, and the only way to give one was a file in `public/`, named by its path, which a single-file build can't inline, or a `data:` URL written by hand. Vite already turns `import keyIcon from "./icons/key.svg"` into a URL, copying the file under a hashed name, and the single-file build inlines every imported file. But the loominate compiler rejected the import: "Cannot find module './icons/key.svg'". Nothing declared asset modules, and the game files it type-checks left out `.d.ts` files, so a game's own `declare module "*.svg"` didn't help, though plain `tsc` accepted it.

## Decision

- **The compiler reads the game's own `.d.ts` files,** as part of the game, as `tsc` does. The dev server, builds, coverage, and the language server all see them.
- **A new game has an `assets.d.ts`,** written by the scaffold, which declares the common image, sound and video, and font files as modules whose default export is the file's URL, a `string`. It's the game's own file, so the editor's TypeScript reads it through `tsconfig.json` as the compiler does, and an author adds a kind it lacks the same way. A game made before it copies it from a new game.
- **Not built into the compiler.** Declaring them in the compiler would leave the editor's TypeScript reporting the import in `story.ts`, and a game declaring them too would conflict.
- **`public/` stays** for files named by path, such as music and sound, whose path is kept in saves and must stay the same from build to build.
- **Archives:** `.loom` archives don't exist yet; [#151](https://github.com/loominate-if/loominate-if/issues/151) carries imported files into them.

## Consequences

- An image a game imports is type-checked, a missing one fails the build, and it works in every build target with no special case.
- Existing games need the file to import assets; nothing else changes for them.
- Any `.d.ts` file in a game's folder is now type-checked as part of it.
