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
/* Only for screen readers: the heading that takes focus before new text, and the live region. */
.loominate-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.loominate-notice { font-style: italic; }
.loominate-error {
  font-family: ${v("font-ui")};
  padding-inline-start: ${v("space")};
  border-inline-start: 3px solid currentColor;
}
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
/* A things widget, such as the inventory. */
.loominate-things { font-family: ${v("font-ui")}; font-size: 0.9em; }
/* A conversation (#118): the cast's portraits, the topics, and the room receding behind what's said. */
.loominate-cast { display: flex; flex-wrap: wrap; gap: 0.75em; list-style: none; margin: 0; padding: 0; }
.loominate-portrait {
  display: flex; flex-direction: column; align-items: center; gap: 0.25em;
  padding: 0.25em 0.5em; border: 2px solid transparent; border-radius: ${v("radius")};
  background: none; color: inherit; font: inherit; font-family: ${v("font-ui")}; font-size: 0.85em; cursor: pointer;
}
.loominate-portrait[aria-pressed="true"] { border-color: ${v("color-accent")}; }
.loominate-portrait-image, .loominate-portrait-initials { width: 4em; height: 4em; border-radius: 50%; }
.loominate-portrait-image { object-fit: cover; }
.loominate-portrait-initials {
  display: flex; align-items: center; justify-content: center;
  background: ${v("color-surface")}; border: 1px solid ${v("color-border")}; font-weight: 600;
}
.loominate-action-list { display: flex; flex-direction: column; align-items: flex-start; gap: 0.35em; list-style: none; margin: 0; padding: 0; }
.loominate-action-list-item {
  padding: 0.3em 0.75em; border: 1px solid ${v("color-border")}; border-radius: ${v("radius")};
  background: ${v("color-surface")}; color: inherit; font: inherit; text-align: start; cursor: pointer;
}
.loominate-action-list-item[aria-disabled="true"] { color: ${v("color-muted")}; border-style: dashed; cursor: not-allowed; }
.loominate-action-why { margin-inline-start: 0.5em; color: ${v("color-muted")}; font-size: 0.9em; }
.loominate-page[data-layout="conversation"] .loominate-notice[data-tags~="topic"] { font-style: normal; }
.loominate-system { color: ${v("color-muted")}; font-size: 0.9em; }
.loominate-notice[data-tags~="player"] { color: ${v("color-muted")}; font-style: italic; }
/* A layout's placed passage parts: prose as a strip of context, links in a disclosure. */
.loominate-region[data-region="context"] { font-family: ${v("font-body")}; font-size: 0.95em; color: ${v("color-muted")}; background: none; border: none; padding: 0; }
.loominate-region[data-region="context"] p { margin-block: 0.25em; }
/* A transcript scrolls: the latest exchange shows, and earlier lines are a scroll up. */
.loominate-passage.loominate-transcript { overflow-y: auto; max-height: 60vh; min-height: 6em; overscroll-behavior: contain; scroll-behavior: auto; }
.loominate-passage.loominate-transcript > p:first-of-type { margin-block-start: 0; }
.loominate-passage.loominate-transcript:focus-visible { outline: 2px solid ${v("color-focus")}; outline-offset: 2px; }
.loominate-region[data-region="history"] { background: none; border: none; padding: 0; font-family: inherit; font-size: inherit; }
.loominate-placed-choices > summary { cursor: pointer; color: ${v("color-muted")}; }
.loominate-placed-choices[open] > summary { margin-block-end: 0.5em; }
/* The compass: the eight points in a grid, and the other ways beside it. */
.loominate-compass { display: flex; gap: 0.5em; align-items: center; font-family: ${v("font-ui")}; font-size: 0.85em; }
.loominate-compass-points { display: grid; grid-template-columns: repeat(3, 2.6em); grid-template-rows: repeat(3, 2em); gap: 0.2em; }
.loominate-compass-others { display: flex; flex-direction: column; gap: 0.2em; }
.loominate-compass-way {
  font: inherit;
  color: ${v("color-text")};
  background: ${v("color-surface")};
  border: 1px solid ${v("color-border")};
  border-radius: 0.3em;
  padding: 0.1em 0.4em;
  cursor: pointer;
}
.loominate-compass-way[aria-disabled="true"] { color: ${v("color-muted")}; border-style: dashed; cursor: not-allowed; }
/* A point with no way out: a faint mark in its cell, so the rose keeps its shape. */
.loominate-compass-none, .loominate-compass-centre { display: flex; align-items: center; justify-content: center; }
.loominate-compass-none::before { content: ""; width: 0.3em; height: 0.3em; border-radius: 50%; background: ${v("color-border")}; }
.loominate-compass-centre::before { content: ""; width: 0.5em; height: 0.5em; transform: rotate(45deg); border: 1px solid ${v("color-muted")}; }
.loominate-compass-reason { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.loominate-things-title { color: ${v("color-muted")}; }
/* A thing's menu, under its name. */
.loominate-has-menu { position: relative; display: inline-block; }
.loominate-menu {
  position: absolute;
  left: 0;
  top: 100%;
  z-index: 20;
  min-width: 12em;
  margin: 0;
  padding: 0.25em 0;
  list-style: none;
  font-family: ${v("font-ui")};
  font-style: normal;
  background: ${v("color-surface")};
  border: 1px solid ${v("color-border")};
  border-radius: ${v("radius")};
}
.loominate-menu-item {
  display: block;
  width: 100%;
  padding: 0.25em 0.75em;
  border: 0;
  background: none;
  color: inherit;
  text-align: start;
  cursor: pointer;
}
.loominate-menu-item[aria-disabled="true"] { color: ${v("color-muted")}; cursor: default; }
.loominate-menu-item:focus-visible { outline-offset: -2px; }
.loominate-menu-reason {
  display: block;
  padding: 0 0.75em 0.25em 1.5em;
  color: ${v("color-muted")};
  font-size: 0.85em;
  font-style: italic;
}
/* The numbers an action asks for, in place of its menu. */
.loominate-menu-ask { padding: 0.25em 0.75em; }
.loominate-menu-ask p { margin: 0.25em 0; }
.loominate-menu-ask-title { font-weight: 600; }
.loominate-menu-ask input { width: 5em; font: inherit; }
.loominate-menu-ask .loominate-menu-reason { padding: 0; }
.loominate-menu-ask .loominate-menu-reason:empty { display: none; }
/* A disabled link's reason as a tooltip, below it, while it's hovered, focused, or tapped. */
/* An inline block, so the tooltip sits below the whole link, not its line of text. */
.loominate-has-reason { position: relative; display: inline-block; }
.loominate-tooltip {
  position: absolute;
  left: 0;
  top: 100%;
  z-index: 10;
  width: max-content;
  max-width: min(20em, 80vw);
  padding: 0.25em 0.5em;
  font-family: ${v("font-ui")};
  font-style: normal;
  line-height: 1.4;
  color: ${v("color-text")};
  background: ${v("color-surface")};
  border: 1px solid ${v("color-border")};
  border-radius: ${v("radius")};
  visibility: hidden;
}
.loominate-has-reason:hover > .loominate-tooltip,
.loominate-has-reason:focus-within > .loominate-tooltip,
.loominate-has-reason[data-shown] > .loominate-tooltip { visibility: visible; }
.loominate-has-reason[data-dismissed] > .loominate-tooltip { visibility: hidden; }
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
.loominate-game-menu button, .loominate-saves button, .loominate-log button {
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
.loominate-saves, .loominate-log {
  color: ${v("color-text")};
  background: ${v("color-background")};
  line-height: ${v("line-height")};
  width: min(36rem, 100% - 2 * ${v("space")});
  padding: ${v("space")};
  border: 1px solid ${v("color-border")};
  border-radius: ${v("radius")};
  font-family: ${v("font-ui")};
}
.loominate-saves::backdrop, .loominate-log::backdrop { background: rgb(0 0 0 / 0.4); }
.loominate-saves :focus-visible, .loominate-log :focus-visible {
  outline: 2px solid ${v("color-focus")};
  outline-offset: 2px;
}
/* The story log and transcript (#127): a tall dialog, the newest at the bottom. */
.loominate-log { width: min(44rem, 100% - 2 * ${v("space")}); max-height: calc(100vh - 2 * ${v("space")}); }
.loominate-log-body { max-height: 60vh; overflow-y: auto; overscroll-behavior: contain; font-family: ${v("font-body")}; }
html.loominate-modal-open { overflow: hidden; }
.loominate-log-entry { margin-block: 0.4em; }
.loominate-log-turn { margin-block-start: 1em; }
.loominate-log-chapter { font-size: 1.15em; margin-block: 1.5em 0.5em; }
.loominate-log-speaker { font-weight: 600; }
.loominate-log-player { color: ${v("color-muted")}; font-style: italic; }
.loominate-log-line { margin-block: 0.15em; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.85em; }
.loominate-log-seq, .loominate-log-kind { color: ${v("color-muted")}; }
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
  /* A link is inline, so it needs a block to take that height. */
  .loominate-choice a.loominate-link { display: inline-flex; align-items: center; }
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
