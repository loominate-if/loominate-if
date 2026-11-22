# 0045. Disabled links' reasons as tooltips

- **Status:** Accepted, 2026-11-22
- **Issue:** [#296](https://github.com/loominate-if/loominate-if/issues/296)
- **Design:** design principle 8 (accessible by default), [ADR 0044](0044-action-pipeline.md)

## Context

A link that can't be followed stays in the tab order, marked `aria-disabled`, with its reason shown after it, and as its description for screen readers. With action links, a passage can have several such links, and the reasons crowd the choices. The browser's own `title` tooltip isn't a reliable replacement: it never shows on touch screens, or when a keyboard user focuses the link.

## Decision

- By default, the page shows a reason as a tooltip below its link:
  - while the link is hovered, or focused from the keyboard;
  - after it's tapped, until it's tapped again or something else is. The button is `aria-disabled`, not `disabled`, so it still takes taps.
- The tooltip is part of what's hovered, so moving the pointer onto it keeps it shown. Escape hides any reason on show until the pointer or focus leaves its link (WCAG 1.4.13: dismissible, hoverable, persistent).
- The reason stays in the page as the button's description (`aria-describedby`), so screen readers announce it as before. While hidden, it's `visibility: hidden`, out of the reading order but still the description.
- `mountPage`'s `reasons: "inline"` keeps the old behavior: after the link, or after the paragraph for a link inside a sentence.
- The tooltip uses the theme's tokens, so a theme restyles it with `.loominate-tooltip`.

## Consequences

- A sentence with a disabled inline link reads as written, with its reason one hover or tap away.
- A test or tool reading the passage's raw text sees the reasons too, as before; what's visible excludes `.loominate-tooltip`.
