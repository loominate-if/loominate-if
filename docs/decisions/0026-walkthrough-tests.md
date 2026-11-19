# 0026. Walkthrough tests

- **Status:** Accepted, 2026-11-19
- **Issue:** [#54](https://github.com/loominate-if/loominate-if/issues/54)
- **Design:** [Tooling](../DESIGN.md#tooling), [ADR 0023](0023-game-config-and-cli-commands.md)

## Context

Walkthrough tests are scripted playthroughs that make moves in order and check what the player sees and the game's state. They protect authors from regressions, and they're how an agent checks its own changes. They need to run headless, import passage files as the game does, and use the game's config.

## Decision

### `loominate test`

- `loominate test [files…] [--watch]` runs a game's `*.test.ts` files with Vitest. Vitest is configured from `loominate.config.ts`, with the passage compiler and the same extensions as `dev` and `build`. `test()` is the programmatic form, returning how many tests ran and failed.
- Vitest is an optional peer dependency of `@loominate-if/cli`, loaded only by this command. A game without it gets an error saying what to install. The scaffold adds it, with `@loominate-if/testing`, a `test` script, and one sample walkthrough.
- Before each test file, a generated setup module gives `@loominate-if/testing` every passage file in the game and the config's start passage.

### `play()`

- `play()` from `@loominate-if/testing` starts the game the runner loaded. Tests outside `loominate test`, such as this repository's own, pass the game in with `play({ passages, start })`. Options give the seed (default `"walkthrough"`, so runs are repeatable) or a saved state to start from (`from`).
- The walkthrough is imperative. `choose(label)` makes a choice by its label, with `"Continue"` for a continue point that has none. `advance()` and `skip()` move past beats, and `undo()` takes a move back. Each returns the walkthrough, so steps chain.
- Between steps, a test reads `passage`, `text` (the prose on screen), `choices`, `unavailable` (with each closed link's condition and reason), `beat`, and `transcript` (all prose read). It uses Vitest's own `expect` on those and on the game's objects, which are bound to the walkthrough's state. `replay()` gives the replay file, and `story`, `store`, `record`, and `history` are there for anything else.
- A choice that isn't there is an error naming the passage and listing the choices there are. If the label matches a link that's closed, it gives the link's condition and the reason the player is told. If a beat is waiting, it says to advance first.

## Consequences

- A walkthrough reads like a playthrough, and a failure says what the player could have done instead.
- Objects are bound to the latest walkthrough's state, so tests in one file run one game at a time, as Vitest runs them by default.
- Determinism checks are a pair of walkthroughs with the same seed, or a walkthrough and its replay.
- The acceptance games in `examples/` (#8, #2) are written as walkthroughs.
