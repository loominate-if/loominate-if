/** The story map's styles (#149), for its own page: light and dark, and wide and narrow screens. */
export const MAP_STYLES = `
.loominate-map {
  color-scheme: light dark;
  --bg: light-dark(#ffffff, #17181b);
  --panel: light-dark(#f7f7f8, #1f2024);
  --fg: light-dark(#1f2328, #e6e6e9);
  --muted: light-dark(#5f6670, #a0a4ad);
  --line: light-dark(#c9cdd3, #4a4d55);
  --accent: light-dark(#0b5cad, #7ab7ff);
  --warn: light-dark(#9a5b00, #f0b35a);
  --error: light-dark(#b3261e, #ff8a80);
  display: grid;
  grid-template-rows: auto auto 1fr;
  height: 100vh;
  font: 14px/1.45 system-ui, sans-serif;
  color: var(--fg);
  background: var(--bg);
}
.loominate-map button { font: inherit; color: inherit; cursor: pointer; }
.loominate-map :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.map-toolbar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem;
  padding: 0.5rem 1rem; border-block-end: 1px solid var(--line); background: var(--panel);
}
.map-title { font-size: 1rem; margin: 0; flex: 1 1 auto; }
.map-tabs, .map-zoom { display: flex; gap: 0.25rem; }
.map-tabs button, .map-zoom button {
  border: 1px solid var(--line); border-radius: 6px; background: var(--bg); padding: 0.15rem 0.6rem;
}
.map-tabs [aria-selected="true"] { border-color: var(--accent); font-weight: 600; }
.map-status { margin: 0; padding: 0 1rem; min-height: 0; font-size: 0.85rem; color: var(--muted); }
.map-body { display: grid; grid-template-columns: minmax(16rem, 24rem) 1fr; min-height: 0; }
.map-outline { overflow: auto; border-inline-end: 1px solid var(--line); padding: 0.5rem 1rem 2rem; }
.map-places { list-style: none; margin: 0; padding: 0; }
.map-place { padding: 0.5rem 0.25rem; border-block-end: 1px solid var(--line); }
.map-place.selected { background: color-mix(in srgb, var(--accent) 10%, transparent); }
.map-place h2 { font-size: 1rem; margin: 0 0 0.25rem; }
.map-place ul { margin: 0.1rem 0 0.4rem; padding-inline-start: 1.1rem; }
.map-label, .map-none, .map-tags, .map-where { margin: 0.1rem 0; color: var(--muted); font-size: 0.85rem; }
.map-note { color: var(--muted); font-weight: normal; }
.map-go { border: none; background: none; padding: 0; color: var(--accent); text-decoration: underline; text-align: start; }
.map-open { margin-block-start: 0.25rem; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); padding: 0.1rem 0.5rem; font-size: 0.85rem; }
.map-frame { position: relative; min-width: 0; min-height: 0; }
.map-picture { width: 100%; height: 100%; display: block; touch-action: none; cursor: grab; }
.map-node rect { fill: var(--panel); stroke: var(--line); stroke-width: 1.5; }
.map-node text { fill: var(--fg); font-size: 13px; pointer-events: none; }
.map-node { cursor: pointer; }
.map-node.start rect { stroke: var(--fg); stroke-width: 2; stroke-dasharray: none; }
.map-node.start text { font-weight: 700; }
.map-node.unreachable rect { stroke: var(--warn); stroke-dasharray: 6 3; }
.map-node.missing rect { stroke: var(--error); stroke-dasharray: 3 3; fill: transparent; }
.map-node.missing text { fill: var(--error); }
.map-node.selected rect { stroke: var(--accent); stroke-width: 3; fill: color-mix(in srgb, var(--accent) 15%, var(--panel)); }
.map-edge { fill: none; stroke: var(--muted); stroke-width: 1.5; }
.map-edge.guarded { stroke-dasharray: 6 4; }
.map-edge.conditional { stroke-dasharray: 2 3; }
.map-edge.touching { stroke: var(--accent); stroke-width: 2.5; }
.map-arrowhead { fill: var(--muted); }
@media (max-width: 40rem) {
  .map-body { grid-template-columns: 1fr; grid-template-rows: 45vh 1fr; }
  .map-outline { border-inline-end: none; border-block-end: 1px solid var(--line); order: 2; }
}
@media (forced-colors: active) {
  .map-node rect, .map-edge { stroke: CanvasText; }
  .map-node.selected rect { stroke: Highlight; }
}
`;
