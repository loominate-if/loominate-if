# 0063. The compass widget

- **Status:** Accepted, 2026-11-24
- **Issue:** [#81](https://github.com/loominate-if/loominate-if/issues/81)
- **Design:** [World model library](../DESIGN.md#world-model-library), [ADR 0034](0034-exits-and-directions.md), [ADR 0062](0062-journeys.md)

## Context

The compass is an optional widget that asks the current location for its exits and their passability, so locked doors appear disabled with the door's reason. Authors choose whether unvisited exits show destination names. It's reskinnable, and keyboard-operable with the numpad or vi-style keys. The world model compiles without the DOM, so it can't draw one itself.

## Decision

- **Split:** presentation draws it, and the world model supplies it.
  - Presentation's `compassWidget({ ways, take, keys })` is generic. It lays the eight compass points out in a 3 by 3 grid, with the other ways (up, down, in, out, a game's own) beside it. A way that can't be taken is `aria-disabled`, with its reason as its tooltip and described for screen readers. A point with no way at all is a faint mark in its cell, hidden from screen readers, and the centre has a mark too, so the rose keeps its shape and a missing way looks different from a blocked one (added in review). Its data is plain (`direction`, `label`, `title`, `available`, `reason`), so a game can replace the view and keep the data.
  - The world model registers `compass` from `compass({ names, keys })`. Its ways are the exits of the player's room, with the door's reason for a blocked one.
- **Placement:** it's opt-in. A game places it with `addToHeader("compass")` or in a layout of its own, and changes its settings by replacing the widget.
- **Names:** a way names its destination once visited, as `{exits}` does. `names: "all"` or `"none"` changes that.
- **Keys:** the numpad's 8 2 4 6, 7 9 1 3, + and - take ways by default, read from the key's code so they work whatever Num Lock says. vi-style h j k l y u b n are opt-in with `keys: "vi"` (or `"both"`), since those letters may mean something else in a game. Keys are ignored while focus is in a text field or with Ctrl, Alt, or the Windows key. The buttons are always reachable with Tab and Enter.
- **Taking a way:** it works even in a passage with no `{exits}` links, which `story.follow` wouldn't accept. So widgets get two new moves on `WidgetHost`, `goTo(passage, label)` and `act(call, label)`, which the page guards, records, and redraws after like any other move. A plain way goes to its room's passage, and a journey takes its action (ADR 0062).

## Consequences

- A plain way taken from the compass is a `goTo` move in the action log, where the same way taken from a passage's `{exits}` link is a `follow` move. Both replay the same.
