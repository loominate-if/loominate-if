# 0017. Layouts and widgets

- **Status:** Accepted, 2026-11-18
- **Issue:** [#38](https://github.com/loominate-if/loominate-if/issues/38)
- **Design:** [Layouts, regions, and widgets](../DESIGN.md#layouts-regions-and-widgets), [ADR 0003](0003-ui-rendering-approach.md), [ADR 0012](0012-rulebooks-hooks-registries.md)

## Context

The page (#37) shows a passage and the story so far. Games also need layouts, which are named regions such as a header and sidebars, and widgets in those regions: a status line, later the compass, inventory, and conversation topics. Games switch layouts at runtime, conversation mode being the first example. ADR 0003 decided that widgets are headless and that views meet a small mount/update/unmount contract any UI framework can adapt to, but left the exact API to this issue.

## Decision

### Registries

- `layouts` and `widgets` are registries (ADR 0012), so a game or kit adds its own, and replaces or removes a built-in one, by name. Presentation registers the `page` layout (`header`, `main`, `footer`, with no widgets) and the `status-line` widget.
- A layout is data: its regions in document order, one of which must be `main`, and the widgets in each region by name. Each region is an element with `class="loominate-region"` and `data-region="…"`, which themes place with CSS. Since #43 each region is a landmark: `header`, `footer`, `nav`, and `aside` regions use those elements, and any other region is a named `<section>`. A region with no widgets is hidden, apart from `main`. The `main` region holds the passage and the story-so-far drawer.

### The current layout is game state

- `display`, an object that presentation exports, holds `layout`, the registered layout to show. Effects switch it: `{on enter: display.layout = "conversation"}`. A game's scope module re-exports `display` to make it available in passages.
- After each move, or on `refresh()`, the page rebuilds its regions if the layout changed. It keeps the same main view element, so focus and the drawer's open state carry over.
- Because the layout is ordinary state, undo, saves, and replays restore it with everything else (design principle 2).
- Package objects take IDs prefixed with their package, here `loominate:display`, so they can't collide with an author's IDs. The ID is part of save data.
- An unregistered layout, a layout without `main`, widgets in a region the layout doesn't have, or an unregistered widget is an error naming the problem, raised when the page draws it.

### Widgets

- A widget is `{ data, view }`.
- `data(game)` is the headless part: a pure function from the story and record to plain data.
- `view.mount(element, data, host)` draws it and returns `{ update(data), unmount() }`.
  - The host has the story, the record, and `follow(choice)`, which makes a move as clicking a link does.
  - A view written in Preact, Solid, Lit, or anything else meets this contract through a thin adapter.
- After each move or `refresh()`, the page recomputes each widget's data and calls `update` only if it changed, comparing plain data structurally. Widgets don't subscribe to the store, so they never update in the middle of a move.
- **Restyling:** replacing a registered widget keeps its place. The page notices the new definition on its next draw and remounts it. That's the deep theming hook: `widgets.replace("status-line", { ...statusLine(), view: myView })`.

### The status line

`statusLine(options)` makes a status line widget with text at each end. By default, the left is the current passage's name and the right is the number of moves; `left` and `right` functions change them. Its default view, `statusLineView`, is two spans in a bar.

## Consequences

- Plain stories pay for the registries and the `page` layout, a few hundred bytes. They show no widgets unless they register a layout that has some.
- Every widget's data is recomputed after every move. That's cheap for the widgets planned, but a widget with expensive data should keep it small or derived from state that's already summarized.
- Mobile rules (#39) and theming (#40) build on the regions' `data-region` attributes and classes.
- Conversation mode (Phase 3) is a layout plus widgets, switched by `display.layout`.
