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
  overflow-wrap: break-word;
}
.loominate-page:not([data-narrow]):is([data-sidebars="start"], [data-sidebars="end"]) {
  max-width: calc(${v("measure")} + ${v("sidebar-width")} + ${v("space")});
}
.loominate-page:not([data-narrow])[data-sidebars="start end"] {
  max-width: calc(${v("measure")} + 2 * (${v("sidebar-width")} + ${v("space")}));
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
.loominate-notice { font-style: italic; }
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
.loominate-beat {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: ${v("space")};
  margin-block: ${v("space")};
}
.loominate-skip {
  padding: 0;
  border: 0;
  background: none;
  color: ${v("color-muted")};
  font-family: ${v("font-ui")};
  font-size: 0.9em;
  text-decoration: underline;
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
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0 ${v("space")};
}
.loominate-columns {
  display: flex;
  gap: ${v("space")};
  align-items: flex-start;
}
.loominate-columns > [data-region="main"] { flex: 1 1 0; min-width: 0; }
.loominate-columns > [data-sidebar] { flex: 0 0 ${v("sidebar-width")}; }
.loominate-page[data-narrow] .loominate-columns {
  flex-direction: column;
  align-items: stretch;
  gap: 0;
}
.loominate-page[data-narrow] .loominate-columns > [data-sidebar] { flex: none; }
.loominate-sidebar-toggle {
  width: 100%;
  padding: calc(${v("space")} / 4) 0;
  border: 0;
  background: none;
  text-align: start;
  font-weight: 600;
  cursor: pointer;
}
.loominate-sidebar-toggle::before { content: "\\25B8\\00A0" / ""; }
.loominate-sidebar-toggle[aria-expanded="true"]::before { content: "\\25BE\\00A0" / ""; }
.loominate-game-menu {
  display: flex;
  flex-wrap: wrap;
  gap: calc(${v("space")} / 2);
}
.loominate-game-menu button, .loominate-saves button {
  padding: calc(${v("space")} / 4) calc(${v("space")} / 1.5);
  border: 1px solid ${v("color-border")};
  border-radius: ${v("radius")};
  background: ${v("color-surface")};
  color: ${v("color-text")};
  font: inherit;
  font-family: ${v("font-ui")};
  cursor: pointer;
}
.loominate-game-menu [aria-disabled="true"] {
  color: ${v("color-muted")};
  cursor: not-allowed;
}
.loominate-saves {
  color: ${v("color-text")};
  background: ${v("color-background")};
  line-height: ${v("line-height")};
  width: min(36rem, 100% - 2 * ${v("space")});
  padding: ${v("space")};
  border: 1px solid ${v("color-border")};
  border-radius: ${v("radius")};
  font-family: ${v("font-ui")};
}
.loominate-saves::backdrop { background: rgb(0 0 0 / 0.4); }
.loominate-saves :focus-visible {
  outline: 2px solid ${v("color-focus")};
  outline-offset: 2px;
}
.loominate-saves-list { padding: 0; list-style: none; }
.loominate-saves-slot {
  padding-block: calc(${v("space")} / 2);
  border-block-end: 1px solid ${v("color-border")};
}
.loominate-saves-name { font-weight: 600; }
.loominate-saves-meta, .loominate-saves-version, .loominate-saves-problem, .loominate-saves-empty {
  color: ${v("color-muted")};
  font-size: 0.9em;
}
.loominate-saves-actions {
  display: flex;
  flex-wrap: wrap;
  gap: calc(${v("space")} / 2);
  margin-block-start: calc(${v("space")} / 4);
}
@media (max-width: 30rem) {
  .loominate-page { padding: calc(${v("space")} * 0.75); }
}
@media (pointer: coarse) {
  .loominate-choice .loominate-link, .loominate-continue, .loominate-skip, .loominate-sidebar-toggle {
    min-height: 2.75rem;
  }
  .loominate-drawer summary { padding-block: calc(${v("space")} / 2); }
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
