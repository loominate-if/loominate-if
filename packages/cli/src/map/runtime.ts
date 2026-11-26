/**
 * The story map's views that packages add (#426, ADR 0124), as the world
 * model's rooms: read from the game, begun once in Node, as coverage does.
 */
import type { ResolvedConfig } from "../config/config.js";
import { gameModule } from "../game-module.js";
import type { MapViewInput } from "./layout.js";

/** The module that begins the game and gives its views. */
export const MAP_VIEWS = "/@loominate/map-views";
/** Its resolved ID. */
export const RESOLVED_MAP_VIEWS = "\0loominate-map-views";

/** What {@link MAP_VIEWS} exports. */
export type ViewsModule = { readonly views: readonly MapViewInput[] };

/** The code of {@link MAP_VIEWS}: the game, begun, and each registered view, or why it failed. */
export function mapViewsCode(config: ResolvedConfig): string {
  return [
    'import { createEventRecord, createStore, createStory, mapViews } from "@loominate-if/core";',
    ...gameModule(config, []),
    "const store = createStore();",
    `const story = createStory(store, createEventRecord(store), passages, { start: ${JSON.stringify(config.start)}, seed: "map" });`,
    "const said = (e) => (e instanceof Error ? e.message : String(e));",
    "let startError;",
    "try { story.begin(); } catch (e) { startError = said(e); }",
    "const game = { story, passages };",
    "export const views = mapViews.entries().map(({ key, value }) => {",
    "  const begun = startError === undefined ? {} : { error: `The game couldn't begin, so where it starts isn't marked: ${startError}` };",
    "  try {",
    "    const { nodes, edges } = value.view(game);",
    "    return { id: key, title: value.title, nodes, edges, ...begun };",
    "  } catch (e) {",
    "    return { id: key, title: value.title, nodes: [], edges: [], error: `This view couldn't be made: ${said(e)}` };",
    "  }",
    "});",
    "",
  ].join("\n");
}

/** A view saying why none of the packages' views could be read, as when the game won't load. */
export const unreadable = (error: unknown): MapViewInput => ({
  id: "unreadable",
  title: "Other views",
  nodes: [],
  edges: [],
  error: `The game couldn't be loaded to read its other views, as Rooms: ${error instanceof Error ? error.message : String(error)}`,
});
