/**
 * The inspector's styles, inside its shadow root: the game's styles don't
 * reach the inspector, and the inspector's don't reach the game.
 */
export const STYLES = `
:host {
  all: initial;
  color-scheme: light dark;
  --bg: light-dark(#f7f7f8, #1c1d21);
  --fg: light-dark(#1f2328, #e6e6e9);
  --muted: light-dark(#5f6670, #a0a4ad);
  --line: light-dark(#d5d8dd, #3a3c43);
  --accent: light-dark(#0b5cad, #7ab7ff);
  --changed: light-dark(#fff1b8, #4d4010);
  font: 13px/1.45 system-ui, sans-serif;
  color: var(--fg);
}
button { font: inherit; color: inherit; cursor: pointer; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.toggle {
  position: fixed;
  inset-block-end: 0.75rem;
  inset-inline-end: 0.75rem;
  z-index: 2147483646;
  padding: 0.3rem 0.7rem;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--bg);
  color: var(--fg);
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.2);
}
.panel {
  position: fixed;
  inset-block: 0;
  inset-inline-end: 0;
  z-index: 2147483647;
  box-sizing: border-box;
  inline-size: min(24rem, 100vw);
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--fg);
  border-inline-start: 1px solid var(--line);
}
.panel[hidden], .toggle[hidden], [role=tabpanel][hidden] { display: none; }
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  border-block-end: 1px solid var(--line);
}
h2 { margin: 0; font-size: 1rem; }
.close, .tabs button {
  border: 1px solid transparent;
  border-radius: 4px;
  background: none;
  padding: 0.15rem 0.5rem;
}
.close:hover, .tabs button:hover { border-color: var(--line); }
.tabs { display: flex; gap: 0.25rem; padding: 0.4rem 0.75rem 0; border-block-end: 1px solid var(--line); }
.tabs [aria-selected=true] { border-color: var(--line); border-block-end-color: var(--bg); margin-block-end: -1px; border-end-start-radius: 0; border-end-end-radius: 0; }
.body { flex: 1; overflow: auto; padding: 0.5rem 0.75rem 2rem; }
.filter { box-sizing: border-box; inline-size: 100%; margin-block-end: 0.5rem; padding: 0.25rem 0.4rem; font: inherit; color: inherit; background: light-dark(#fff, #26272c); border: 1px solid var(--line); border-radius: 4px; }
.tree { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
summary { cursor: pointer; padding: 1px 2px; border-radius: 3px; }
.children { padding-inline-start: 1.1rem; }
.leaf { padding: 1px 2px 1px calc(1em + 2px); border-radius: 3px; }
[data-changed] { background: var(--changed); }
.id, .group { font-weight: 600; }
.group { font-family: system-ui, sans-serif; color: var(--muted); }
.key { color: var(--muted); }
.value[data-type=string] { color: light-dark(#0a6b2b, #8fd19e); }
.value[data-type=number], .value[data-type=boolean], .value[data-type=null] { color: light-dark(#8a3ffc, #c5a3ff); }
.value[data-type=array], .value[data-type=object] { color: var(--muted); }
.value[data-type=ref] { color: var(--accent); }
.value[data-default] { opacity: 0.7; }
.template { font-weight: 400; color: var(--muted); }
.empty:empty { display: none; }
.empty { color: var(--muted); }
.filters { display: grid; gap: 0.35rem; margin-block-end: 0.5rem; }
.chips { display: flex; flex-wrap: wrap; gap: 0.25rem; align-items: center; }
.chips[hidden] { display: none; }
.chips-label { color: var(--muted); margin-inline-end: 0.25rem; }
.chip { border: 1px solid var(--line); border-radius: 999px; background: none; padding: 0 0.5rem; font-size: 12px; }
.chip[aria-pressed=true] { background: var(--accent); border-color: var(--accent); color: var(--bg); }
.count { margin: 0 0 0.35rem; color: var(--muted); }
.events { list-style: none; margin: 0; padding: 0; font-size: 12px; }
.event summary { display: flex; gap: 0.4rem; align-items: baseline; }
/* A flex summary loses its disclosure marker; draw one. */
.event summary::before { content: "▸"; color: var(--muted); }
.event details[open] > summary::before { content: "▾"; }
.event .seq { color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; min-inline-size: 2.5ch; text-align: end; }
.event .kind { font-weight: 600; }
.event .summary { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.event details[open] .summary { white-space: normal; }
.event .tag { color: var(--accent); }
.event dl { margin: 0.2rem 0 0.4rem 3rem; display: grid; grid-template-columns: auto 1fr; gap: 0 0.6rem; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.event dt { color: var(--muted); }
.event dd { margin: 0; overflow-wrap: anywhere; }
.visually-hidden { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (prefers-reduced-motion: no-preference) { .toggle { transition: box-shadow 0.15s; } }
`;
