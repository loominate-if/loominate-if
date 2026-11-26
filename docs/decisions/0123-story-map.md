# 0123. The story map

- **Status:** Accepted, 2026-11-25
- **Issue:** [#149](https://github.com/loominate-if/loominate-if/issues/149)
- **Design:** [Tooling](../DESIGN.md#tooling-1)

## Context

The design asks for "a generated graph of passages and rooms, giving the visual overview Twine authors get from its editor." It should render from the compiler's output. Authors who use screen readers need the same overview, which a drawn graph alone doesn't give.

## Decision

- **From the compiler:** `CompilerSession.storyMap()` gives views of nodes and edges. The Passages view has each passage, with where it's written, its tags, and whether it's the start, unreachable (from the compiler's own diagnostics), or missing (linked to but not defined). Its edges are links, with their labels, and passage targets of directives, as `{continue}`, marked guarded or conditional. Links that take an action and stay (`{act}`) lead nowhere and aren't drawn. Nodes come in reading order: the start, breadth first along its edges, then the rest. Views are generic, so the world model's rooms can be one (#426).
- **Laid out in the CLI** with elkjs, layered from the top, with the start alone in the first layer and nodes in reading order, so a map changes little between edits. elkjs is a CLI dependency only (EPL-2.0), never in a game.
- **Drawn by the inspector:** `mountStoryMap` draws a laid-out map as an SVG picture beside an outline, in plain DOM like the rest of the inspector.
- **The outline is the accessible map.** Each passage is a heading with "Leads to" and "Reached from" lists of buttons that move focus to that passage. The picture is `aria-hidden`, follows the outline's focus, and can be panned and zoomed. Updates keep focus and are announced in a polite live region.
- **Live in the dev server** at `/__loominate/map`, with its data at `/__loominate/map.json`. It doesn't load Vite's client, because Vite reloads every page when a game module can't hot-update, which would lose the reader's place. Instead it listens to server-sent events at `/__loominate/map/events`, sent when an edit changes a passage module. Passages open in the author's editor through Vite's `/__open-in-editor`.
- **`loominate map`** compiles the game, lays it out, bundles the viewer with Vite, and writes one HTML file (default `dist/story-map.html`), with the map as JSON in a script element. It draws the map even when the game has errors.

## Consequences

- Targets chosen in code, as `goTo(…)`, aren't on the map; only those written in passage files are.
- The Rooms view (#426) needs a way for the compiler's extension API to read `connect(…)` calls in TypeScript.
- The layout is computed on each change. Very large stories may want caching or a worker later.
