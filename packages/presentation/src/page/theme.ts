/**
 * Theming (#40, ADR 0018). The page's default styles are written in terms of
 * CSS custom properties, the theme tokens, and sit in the `loominate` cascade
 * layer. Any CSS an author writes outside a layer beats them whatever its
 * specificity, so a theme file can be nothing but token values.
 */

import { themeTokens } from "./tokens.js";

const v = (token: string): string => `var(--loominate-${token})`;

/** The default styles, in the `loominate` layer. */
const STYLES = `@layer loominate {
:root {
  color-scheme: light dark;
${themeTokens.map((t) => `  ${t.name}: ${t.value};`).join("\n")}
}
.loominate-page {
  box-sizing: border-box;
  max-width: ${v("measure")};
  margin-inline: auto;
  padding: ${v("space")};
  font-family: ${v("font-body")};
  font-size: ${v("font-size")};
  line-height: ${v("line-height")};
  color: ${v("color-text")};
  background: ${v("color-background")};
}
.loominate-page *, .loominate-page *::before, .loominate-page *::after { box-sizing: inherit; }
.loominate-region:not([data-region="main"]) {
  margin-block: ${v("space")};
  padding: calc(${v("space")} / 2) ${v("space")};
  font-family: ${v("font-ui")};
  font-size: 0.9em;
  background: ${v("color-surface")};
  border: 1px solid ${v("color-border")};
  border-radius: ${v("radius")};
}
.loominate-passage:focus { outline: none; }
.loominate-page button {
  font: inherit;
  color: inherit;
}
.loominate-link {
  padding: 0;
  border: 0;
  background: none;
  color: ${v("color-accent")};
  text-decoration: underline;
  text-underline-offset: 0.15em;
  text-align: start;
  cursor: pointer;
}
.loominate-link[aria-disabled="true"] {
  color: ${v("color-muted")};
  text-decoration-style: dotted;
  cursor: not-allowed;
}
.loominate-choice { margin-block: calc(${v("space")} / 2); }
.loominate-continue {
  padding: calc(${v("space")} / 3) ${v("space")};
  border: 1px solid ${v("color-border")};
  border-radius: ${v("radius")};
  background: ${v("color-surface")};
  cursor: pointer;
}
.loominate-reason, .loominate-note {
  color: ${v("color-muted")};
  font-size: 0.9em;
  font-style: italic;
}
.loominate-page :focus-visible {
  outline: 2px solid ${v("color-focus")};
  outline-offset: 2px;
}
.loominate-drawer {
  margin-block-start: calc(${v("space")} * 2);
  color: ${v("color-muted")};
}
.loominate-drawer summary {
  font-family: ${v("font-ui")};
  font-size: 0.9em;
  cursor: pointer;
}
.loominate-drawer-content {
  padding-inline-start: ${v("space")};
  border-inline-start: 2px solid ${v("color-border")};
}
.loominate-status {
  display: flex;
  justify-content: space-between;
  gap: ${v("space")};
}
}
`;

/** Adds the default styles to `doc` once, ahead of everything else in its head. */
export function addStyles(doc: Document): void {
  if (doc.querySelector("style[data-loominate-styles]")) return;
  const style = doc.createElement("style");
  style.dataset.loominateStyles = "";
  style.textContent = STYLES;
  doc.head.prepend(style);
}
