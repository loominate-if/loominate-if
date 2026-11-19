# 0005. Passage modules

- **Status:** Accepted, 2026-11-16
- **Issue:** [#30](https://github.com/loominate-if/loominate-if/issues/30)
- **Design:** [Compilation and checking](../DESIGN.md#compilation-and-checking), [Passage files](../DESIGN.md#passage-files)

## Context

Each passage file compiles to a virtual TypeScript module, so inline code is type-checked as one program with the author's modules. Several choices weren't in the design:

- what the passage files are called;
- how inline code sees names like `lantern` and `player` without importing them;
- whether the virtual module only shadows the passage for type checking, or is the compiled code itself;
- how code refers to passages, given names like "Cellar Stairs".

## Decision

### File extension: `.weft`

Passage files end in `.weft`. In weaving, the weft is the thread carried back and forth through the fixed warp, as prose is woven through the structure the TypeScript defines. `.loom` is the archive format, and `.tw`/`.twee` would make editors and Twine tools treat the files as Twee 3, which the syntax differs from (ADR 0004).

### The generated module is the compiled code

`scenes/cellar.weft` becomes the virtual module `scenes/cellar.weft.ts`, which exports `passages`, an array of core `Passage`s. The build emits it like any other module, so what's type-checked is exactly what runs.

- Inline code is copied verbatim. Each copy is recorded as a mapping, so TypeScript errors and runtime stack traces point at the passage file's lines. The compiler also writes a standard version 3 source map.
- Paragraphs are built with core's `prose`, `emphasis`, and `strong` (#206).
- `{if}` becomes an `if` statement, links and `{continue}` become core link and continue nodes, and `{when}` becomes a `LinkGuard`, keeping the condition's source text for the inspector.
- Effect phases become the passage's `effects`. They must be at the top level of a passage: they run when it's visited, not when it's shown.
- Printed values go through a helper typed `string | number`, so printing anything else is a type error (ADR 0004).
- Constructs core can't run yet are compile errors that name the issue that adds them: `{beat}` and `{wait}` (#41, since added by [ADR 0021](0021-beats.md)), links inside a paragraph (#207), and formatting in link labels.

### The scope module

Each game has a **scope module**, `story.ts` by default and configurable. Inline code can use everything it exports without an import.

- Each generated module imports only the scope exports its inline code uses, so TypeScript checks every reference and unused names cost nothing.
- Inline code also gets `visits`, `firstVisit`, and `visited` from the passage's context. A scope export with one of those names is an error on the export.
- Identifiers starting with `$` are reserved for generated code; a scope export starting with `$` is an error.
- The scope module is optional. Without one, inline code can use only the context names and globals.
- A directive name that is also a scope export is an error at the directive, as ADR 0004 requires.

### Passage references are strings

Code refers to passages by name as strings: `visited("Cellar Stairs")`. The compiler generates a `PassageName` type listing every passage in the game, and `visited` takes a `PassageName`, so a misspelled name is a type error and editors can complete names. This replaces the design's bare `visited(Cellar)`, which can't work for names with spaces.

## Consequences

- Inline code is real TypeScript in a real program, so the language server (#148) can offer completion and go-to-definition through the same modules.
- Type errors already come back at passage lines with TypeScript's wording. #31 turns them into author-facing messages.
- Inline code has no direct access to the state store. `player.fear += 1` type-checks against the author's types, but writing to the store depends on how objects are defined (#4).
- Adding a passage changes `PassageName` and so re-checks every module that uses `visited`. This is cheap at the sizes expected; the language server can check incrementally later.
- Renaming `story.ts`, or the `.weft` extension, after games exist would break them. Both are fixed for Phase 1.
