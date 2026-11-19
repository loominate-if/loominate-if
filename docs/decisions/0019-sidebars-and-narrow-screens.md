# 0019. Sidebars and narrow screens

- **Status:** Accepted, 2026-11-19
- **Issue:** [#39](https://github.com/loominate-if/loominate-if/issues/39)
- **Design:** [Layouts, regions, and widgets](../DESIGN.md#layouts-regions-and-widgets), [ADR 0017](0017-layouts-and-widgets.md), [ADR 0018](0018-theming.md)

## Context

The design says mobile rules collapse sidebars into drawers or tabs on narrow screens. Until now, a layout's regions were only names in document order, and they all stacked, so there was no such thing as a sidebar to collapse.

## Decision

- **A layout names its sidebars.** `sidebars` is an optional field mapping region names to `"start"` or `"end"`: `{ regions: ["header", "map", "main", "inventory"], sidebars: { map: "start", inventory: "end" } }`. Making `main` or an unknown region a sidebar, or using another side, is an error raised when the page draws the layout. The field is additive, so existing layouts are unchanged.
- **Sidebars sit beside main** in a `.loominate-columns` row that takes main's place among the regions. Inside it, start sidebars come first, then main, then end sidebars, so reading and tab order match what's on screen. The page widens by one `--loominate-sidebar-width` for each side that has a sidebar with widgets.
- **On narrow screens they collapse into drawers**, not tabs. Each sidebar region gets a button named after it, with `aria-expanded` and `aria-controls`, that shows and hides its panel. Drawers start closed, and each opens independently. Start sidebars sit above the passage and end sidebars below it, keeping document order. Which drawers are open is UI state, not game state, so undo doesn't close them. They stay open across moves and layout switches.
- **The breakpoint is a media query** that `mountPage`'s `narrow` option sets, defaulting to `(max-width: 48rem)`. It's an option rather than a token because custom properties can't be used in media queries. The page follows the query as the screen changes, sets `data-narrow` on its root, and stops listening when destroyed. Without `matchMedia`, the page counts as wide.
- **The default styles are usable at phone width:** long words wrap, the page's padding shrinks below 30rem, the status line wraps, and on touch screens choices, continue buttons, drawer toggles, and the story-so-far summary are at least 2.75rem tall.

## Consequences

- Drawers are the simplest accessible pattern: native buttons with no arrow-key behavior to get right. A game that wants tabs can draw them with its own CSS and widgets, or a later layout option can add them.
- The narrow state needs JavaScript, so it can't come from CSS alone, but it gives proper `aria-expanded` semantics and is testable without a browser.
- Mobile layouts for the compass and conversation mode (Phase 3) build on sidebars rather than inventing their own collapsing.
