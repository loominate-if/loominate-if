# 0018. Theming

- **Status:** Accepted, 2026-11-18
- **Issue:** [#40](https://github.com/loominate-if/loominate-if/issues/40)
- **Design:** [Theming](../DESIGN.md#theming), [ADR 0017](0017-layouts-and-widgets.md)

## Context

Until now, presentation shipped no CSS, so every game started from an unstyled page. The design calls for light customization through CSS custom properties in a theme file, and deep customization by replacing a widget's template. Packages have only one entry point (ADR 0001), so presentation can't publish an importable `.css` file.

## Decision

- **Default styles are added by `mountPage`.** They go in one `<style data-loominate-styles>` element, the first in the document's head, added once per document. `mountPage(…, { styles: false })` leaves them out.
- **They sit in the `loominate` cascade layer.** CSS outside a layer beats layered CSS whatever its specificity. A game's own stylesheet therefore overrides any default rule without `!important` or long selectors, and a theme file can contain nothing but token values.
- **Theme tokens are `--loominate-*` custom properties**, set on `:root`. `themeTokens` exports each one with its default and what it styles, and the [theming guide](../guide/theming.md) tables them. A test keeps the guide, the export, and the stylesheet in agreement: every token is documented and used, and the stylesheet uses no others.
- **Colors follow the player's light or dark preference.** Each color token is a `light-dark()` pair, and the defaults set `color-scheme: light dark` on `:root`. A game picks one scheme by setting `color-scheme` itself. The default text, muted, and accent colors have a contrast of at least 5.5:1 against both the background and the surface color, in both schemes.
- **Deep customization is the widget contract** from ADR 0017: replace a registered widget with the same `data` and a new `view`. The guide's example draws the status line as a ship's log, and that example's code is the one a test runs.

## Consequences

- A game looks reasonable with no CSS at all, and a plain story pays about 2 KB of CSS for it.
- `light-dark()` and cascade layers are baseline in browsers since 2024. Older browsers ignore the whole stylesheet and show the page unstyled, but it still works.
- Token names are public API. Renaming one breaks themes, so new tokens are added rather than existing ones renamed.
- Mobile rules (#39) add their media queries to the same layer.
