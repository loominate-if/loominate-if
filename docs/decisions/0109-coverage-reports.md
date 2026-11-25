# 0109. Coverage reports

- **Status:** Accepted, 2026-11-25
- **Issue:** [#133](https://github.com/loominate-if/loominate-if/issues/133)
- **Design:** [Tooling](../DESIGN.md#tooling-1), [ADR 0026](0026-walkthrough-tests.md), [ADR 0064](0064-unreachable-rooms.md)

## Context

The design asks for coverage reports: unreachable passages, actions, and topics; facts no one can be asked about; and locked conversation nodes without an exit. They must run from the CLI and in CI. The compiler already warns about passages nothing links to, and the world model about rooms no exit leads to, from syntax. The rest needs the game itself: its facts, topics, nodes, and actions are defined by running `story.ts`. A report could mean what the structure rules out, or what tests never exercise.

## Decision

- **`loominate coverage`,** its own command, reporting in two parts. It exits 0 unless `--strict` is given; then it exits 1 when anything can't be reached or a walkthrough fails. `--json <file>` writes the report too. What walkthroughs don't reach never fails it: that's for the author to judge.
- **Part 1, "Can't be reached":** what the game's structure rules out.
  - The compiler's unreachable passage and room warnings, now marked `unreachable` on the diagnostic (`ProjectDiagnostic`, and `ExtensionDiagnostic` for packages' checks).
  - **Checks in a new core registry, `coverageChecks`,** run against the game loaded in Node with Vite and begun with the seed `coverage`. A check has a `title` and up to three functions: `unreachable` returns findings, `items` lists what a walkthrough should reach, and `reached` gives the keys a walkthrough reached. It lives in core, DOM-free and small, so the world model and kits register theirs as they load, as they do rules.
  - The world model's checks: facts no ask or tell topic is about; conversation nodes no topic opens, unless the node says `openedElsewhere: true`, as `closedElsewhere` does for its way out; and actions all of whose things are out of the world as the game begins. A hard lock with no way out already stops the game starting; the report shows that error as "The game couldn't start".
  - **Code can do what the structure can't show,** so a finding with a key that a walkthrough reached is dropped: a passage only code goes to, or a thing code brings into the world. Reading code to be sure, as the room check does, is left to the compiler's syntax checks.
- **Part 2, "Not reached by walkthroughs":** like code coverage. `loominate coverage` runs the walkthroughs with one more setup module, which watches each game `play()` begins (a new internal hook in `@loominate-if/testing`) and, at the end of each, asks every check what it reached. A passage is reached once visited, an action once taken, a topic once it answers, a fact once the player knows it, and a node once one of its replies answers. What part 1 lists isn't counted again.
- **Which passages count:** those a player can visit. Passages a package reads sections from, as an actor's topic blocks, are left out, found from the tag roles that say `sections: true`.

## Consequences

- Every package can add coverage the same way, from its runtime module; nothing in the CLI knows the world model.
- The registry and core's two checks are in every game's bundle, a few hundred bytes; the CLI's loading and reporting never are.
- The report loads the game twice, once to read its structure and once in the walkthroughs. That keeps part 1 working for a game with no walkthroughs.
- The world model's checks are only as sure as their definitions: a fact the game expects the player to learn but never be asked about is listed, by design.
