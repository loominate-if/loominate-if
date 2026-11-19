# Theming

A game's look comes in two depths. A **theme file** changes the page's fonts, colors, and spacing by setting CSS custom properties, the theme tokens. **Replacing a widget's view** changes how a widget is drawn entirely, while it keeps the same data. [ADR 0018](../decisions/0018-theming.md) records the decisions behind this guide.

## The default styles

`mountPage` adds presentation's default styles to the document, once, as the first `<style>` in its head. They're in a cascade layer named `loominate`, and CSS outside any layer always beats CSS inside one, whatever its specificity. So your own stylesheet overrides any default rule without `!important` or long selectors.

To style the page from nothing, turn the defaults off:

```ts
mountPage(container, { story, record }, { styles: false });
```

The class names stay the same either way: `.loominate-page`, `.loominate-region` (with `data-region="header"` and so on), `.loominate-passage`, `.loominate-link`, `.loominate-continue`, `.loominate-reason`, `.loominate-drawer`, and `.loominate-status`. A link that can't be followed has `aria-disabled="true"`; style it with `.loominate-link[aria-disabled="true"]`, not `:disabled`.

Sidebars ([ADR 0019](../decisions/0019-sidebars-and-narrow-screens.md)) sit with main in `.loominate-columns`, and each has `data-sidebar="start"` or `"end"`. The page root has `data-sidebars` listing the sides in use, and `data-narrow` on narrow screens, where each sidebar shows a `.loominate-sidebar-toggle` button and a `.loominate-sidebar-panel`. The narrow breakpoint is `mountPage`'s `narrow` option, not a token, because custom properties can't be used in media queries.

## A theme file

A theme file is ordinary CSS that sets tokens. Load it however your game loads CSS, for example with a `<link>` in `index.html` or `import "./theme.css"` in `main.ts`:

```css
:root {
  --loominate-font-body: "Iowan Old Style", Georgia, serif;
  --loominate-measure: 34rem;
  --loominate-color-accent: light-dark(#8a3b12, #f0a46e);
}
```

### Light and dark

The default colors follow the player's light or dark preference. Each color token is a `light-dark()` pair, and the defaults set `color-scheme: light dark` on `:root`. To keep a game in one scheme, set it yourself:

```css
:root {
  color-scheme: dark;
}
```

Give your own colors as `light-dark(light, dark)` pairs to keep following the preference, or as a single color to use it in both.

### Tokens

| Token | Default | Styles |
| --- | --- | --- |
| `--loominate-font-body` | `Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif` | The typeface for prose. |
| `--loominate-font-ui` | `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` | The typeface for widgets, such as the status line, and the drawer's label. |
| `--loominate-font-size` | `1.125rem` | The prose's size. |
| `--loominate-line-height` | `1.6` | The prose's line height. |
| `--loominate-measure` | `38rem` | The maximum width of the page without sidebars, which keeps lines readable. |
| `--loominate-sidebar-width` | `14rem` | The width of each sidebar beside main, which widens the page by as much. |
| `--loominate-space` | `1rem` | The base spacing; paddings and gaps are multiples of it. |
| `--loominate-radius` | `0.375rem` | The corner radius of buttons and panels. |
| `--loominate-color-text` | `light-dark(#1f1d1a, #ece8e1)` | Prose and other text. |
| `--loominate-color-background` | `light-dark(#fbfaf7, #17161a)` | The page's background. |
| `--loominate-color-surface` | `light-dark(#f0ede6, #232228)` | The background of regions other than main, and of continue buttons. |
| `--loominate-color-border` | `light-dark(#d6d1c7, #3d3b43)` | Borders around regions, buttons, and the drawer. |
| `--loominate-color-muted` | `light-dark(#5f5a52, #a9a398)` | Secondary text: reasons, the drawer, and links that can't be followed. |
| `--loominate-color-accent` | `light-dark(#1d5fa8, #8cb9f0)` | Links and choices. |
| `--loominate-color-focus` | `light-dark(#1d5fa8, #8cb9f0)` | The focus ring on keyboard focus. |

Keep text and its background at a contrast of at least 4.5:1. The defaults meet that in both schemes, but the tests can't check your theme's colors.

## Replacing a widget's view

A widget is headless: its `data` computes plain data from the game, and its `view` draws it ([ADR 0017](../decisions/0017-layouts-and-widgets.md)). To restyle a widget completely, replace it with the same data and your own view. This draws the status line as a ship's log:

```ts
// A ship's log instead of a bar: the same data, drawn as a definition list.
const shipsLog: WidgetView<StatusLineData> = {
  mount(element, data) {
    const doc = element.ownerDocument;
    const log = doc.createElement("dl");
    log.className = "ships-log";
    const place = doc.createElement("dd");
    const watch = doc.createElement("dd");
    const term = (text: string) =>
      Object.assign(doc.createElement("dt"), { textContent: text });
    log.append(term("Position"), place, term("Watch"), watch);
    element.append(log);
    const show = (d: StatusLineData) => {
      place.textContent = d.left;
      watch.textContent = d.right;
    };
    show(data);
    return { update: show, unmount: () => log.remove() };
  },
};
widgets.replace("status-line", { ...statusLine(), view: shipsLog });
```

The page notices the replaced widget on its next draw and mounts the new view in the same place. A view can use any UI framework, as long as it meets the `mount`/`update`/`unmount` contract. Keep it keyboard-operable: if it can make moves, use buttons.

A new widget of your own is registered the same way. Wrap it in `widget(…)` so its view sees the data typed: `widgets.register("notes", widget({ data: …, view: … }))`.
