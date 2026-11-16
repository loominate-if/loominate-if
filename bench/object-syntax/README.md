# Object definition syntax prototypes

The prototypes behind [#4](https://github.com/loominate-if/loominate-if/issues/4): three ways to define objects, over one mechanism that keeps their data in the state store.

This folder isn't a workspace package. It has its own `package-lock.json` and links to this checkout's `@loominate-if/core` and `@loominate-if/compiler`.

```sh
pnpm build                 # at the repo root: the check uses the built packages
cd bench/object-syntax
npm ci
npm run check
```

## What's shared

- **`runtime/objects.ts`** is the mechanism, and would move into core if adopted:
  - An object is a handle with an explicit, stable ID.
  - Its data properties are accessors that read and write the state store under `(id, property)`. Every non-function property is state; functions are behavior.
  - The store holds only values that differ from the definition, so saves stay small and a changed default reaches old saves.
  - Objects created during play come from templates, through `spawn(template, origin)`. Their IDs come from where they were created: `gen:matchbox:match-1`, then `match-2`. Each origin keeps its own sequence in the store, so undo and replay give the same IDs.
  - IDs starting with `gen:` are reserved for spawned objects, and a duplicate static ID is an error.
- **`scene/cellar.weft`** is one scene, used unchanged by every style: a lantern to take and light, a key and a locked cellar door (through a `lockable` mixin), the player's fear, and a matchbox whose `strike()` spawns a match.
- **`check.ts`** does three things for each style:
  - Type-checks `story.ts` and the scene with the real compiler (`compileProject`).
  - Plays the scene with core's `createStory`, testing undo and redo across a spawn, save and load into a fresh store, the spawned IDs, "only changes are stored", and replay.
  - Introduces three deliberate mistakes and prints the errors they produce.

Each style has a `syntax.ts`, which is library code, and a `story.ts`, which is what an author writes. Compare the `story.ts` files.

## Results, 2026-11-16

| | A. Factory (`a-factory`) | B. Builder (`b-builder`) | C. Class (`c-class`) |
| --- | ---: | ---: | ---: |
| `story.ts` code lines | **38** | 42 | 53 |
| Type errors in the scene | 0 | 0 | 0 |
| Walkthrough (undo, save, spawn, replay) | pass | pass | pass |
| Casts or `any` in author code | none | none | one `any[]`, required by TypeScript's mixin pattern |

All three catch every deliberate mistake at the right line, including a typo in the `.weft` file. What differs is how the type is named in the message:

| Mistake | A. Factory | B. Builder | C. Class |
| --- | --- | --- | --- |
| `this.isLitt` in a method | `…type 'Handle<{ name: string; taken: boolean; isLit: boolean; light(): void; }>'. Did you mean 'isLit'?` | `…type 'Handle<{ name: string; taken: boolean; isLit: boolean; } & object & { light(): void; }>'…` | `…type 'Lantern'. Did you mean 'isLit'?` |
| `lantern.takn` in the passage | `…type 'Handle<{ name: string; … }>'. Did you mean 'taken'?` | `…type 'Handle<{ … } & { light(): void; }>'…` | `…type 'Handle<Lantern>'. Did you mean 'taken'?` |
| `this.count -= "1"` | same message in all three | | |

### Notes on each style

**A. Factory with object literal.**
- **Strengths:** the shortest and closest to a TADS object definition. `this` is inferred inside the definition with no annotations.
- **Mixins** are plain objects, spread in: `object("cellar door", { ...lockable, name: "cellar door" })`. A mixin's methods sit outside any definition, though, so they need an explicit `this:` type.
- **Error messages** spell out the whole inferred type, which gets long for big objects. #31 could shorten them to the object's ID.

**B. Builder chain.**
- **Mixins** are partial builders with inferred `this`, which is pleasant.
- **Drawbacks:**
  - Every definition splits into `.state({...})` and `.does({...})`, and must end in `.done()`. Forgetting `.done()` leaves a builder where an object should be, and the error appears where the object is used, not where it's defined.
  - The intersection types (`& object &`) leak into error messages.
  - It's the most library code.

**C. Class per object.**
- **Strengths:** familiar to TypeScript programmers, with the clearest error messages, because types have names.
- **Drawbacks:**
  - Each object takes two declarations, a class and a `define(...)` call, which makes it the longest.
  - Mixins need TypeScript's `Constructor<any[]>` pattern and a lint exception.
  - The binding is the most fragile: class fields are ordinary instance properties until `define` replaces them with store accessors, so a constructor that changed a field would bypass the store.

### Shared findings, whichever style is chosen

- **State values are frozen.** `player.inventory.push(x)` throws. Authors must reassign: `player.inventory = [...player.inventory, x]`. The ADR should decide whether to accept this, add helpers, or wrap arrays.
- **References between objects aren't covered yet.** Something like `key.location = kitchen` needs storing as an ID and reading back as a handle. This matters most to the world model, but the core mechanism has to support it.
- **One store at a time.** Handles bind to the store passed to `bindStore`. That fits one game per page, and the story would call it in `begin` and after loading a save.
- **Unused context parameter.** Generated passage modules declare a `$context` parameter even when a function doesn't use it, which matters to authors who enable `noUnusedParameters`. This is a small compiler fix, separate from #4.
