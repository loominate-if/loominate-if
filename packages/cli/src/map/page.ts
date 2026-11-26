/**
 * The story map page (#149, ADR 0123): in the dev server, live at
 * {@link MAP_PATH}, and standalone from `loominate map`. The page draws the
 * map with the inspector's viewer.
 */

/** Where the dev server serves the map. */
export const MAP_PATH = "/__loominate/map";
/** The laid-out map, as JSON. */
export const MAP_DATA = `${MAP_PATH}.json`;
/** Server-sent events, one each time the game's map may have changed. */
export const MAP_EVENTS = `${MAP_PATH}/events`;
/** The page's script, a module the dev server serves. */
export const MAP_SCRIPT = "/@loominate/map";

/** Text made safe inside HTML. */
const escape = (text: string): string =>
  text.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );

/** The id of a standalone page's map, as JSON in a script element. */
export const MAP_DATA_ID = "loominate-map-data";

/** Text made safe between `<script>` tags. */
const scriptText = (text: string): string => text.replace(/<\/(script)/gi, "<\\/$1");

/**
 * The page, with a script given by URL (the dev server), or inline with the
 * laid-out map beside it as JSON (a standalone file).
 */
export function mapPage(
  title: string,
  script: { readonly src: string } | { readonly code: string; readonly drawing: unknown },
): string {
  const tag =
    "src" in script
      ? `<script type="module" src="${escape(script.src)}"></script>`
      : [
          `<script type="application/json" id="${MAP_DATA_ID}">${scriptText(JSON.stringify(script.drawing))}</script>`,
          `<script type="module">${scriptText(script.code)}</script>`,
        ].join("\n");
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>Story map: ${escape(title)}</title>`,
    "<style>html, body { margin: 0; }</style>",
    "</head>",
    "<body>",
    tag,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/**
 * The dev server's map script: draws the map, opens passages in the author's
 * editor through Vite, and redraws when the game changes. It doesn't load
 * Vite's client, so an edit that reloads the game's page doesn't reload the map.
 */
export const DEV_SCRIPT = `import { mountStoryMap } from "@loominate-if/inspector";
const load = async () => (await fetch(${JSON.stringify(MAP_DATA)})).json();
const map = mountStoryMap(document.body, await load(), {
  open: (s) => { void fetch("/__open-in-editor?file=" + encodeURIComponent(s.file + ":" + s.line + ":" + s.column)); },
});
new EventSource(${JSON.stringify(MAP_EVENTS)}).addEventListener("change", async () => { map.update(await load()); });
`;

/** A standalone map's script: the map beside it, drawn once, with sources shown rather than opened. */
export const STANDALONE_SCRIPT = `import { mountStoryMap } from "@loominate-if/inspector";
const data = document.getElementById(${JSON.stringify(MAP_DATA_ID)});
mountStoryMap(document.body, JSON.parse(data?.textContent ?? '{"views":[]}'));
`;
