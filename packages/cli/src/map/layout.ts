/**
 * Lays out a story map (#149, ADR 0123): each view as a layered graph, top to
 * bottom from the start, with ELK, for the inspector's viewer to draw.
 */
import type { StoryMap, StoryMapEdge, StoryMapNode, StoryMapView } from "@loominate-if/compiler";
import type { ElkNode } from "elkjs/lib/elk-api.js";
// A CommonJS module whose class TypeScript sees as `.default`, as Node gives it too.
import elkjs from "elkjs/lib/elk.bundled.js";

/** How tall a place's box is, and roughly how wide a character of its label. */
const BOX_HEIGHT = 36;
const CHARACTER = 7.5;
const PADDING = 28;
const MIN_WIDTH = 80;

const elk = new elkjs.default();

/**
 * A view as drawn: the inspector's `DrawnView`, which reaches the browser as
 * JSON. It's written out here, as importing the inspector's types would bring
 * its DOM-typed sources into the CLI's program.
 */
export type DrawnView = {
  readonly id: string;
  readonly title: string;
  readonly width: number;
  readonly height: number;
  readonly nodes: readonly (StoryMapNode & {
    x: number;
    y: number;
    width: number;
    height: number;
  })[];
  readonly edges: readonly (StoryMapEdge & { points: readonly { x: number; y: number }[] })[];
};

/** A laid-out story map: the inspector's `MapDrawing`. */
export type MapDrawing = { readonly title?: string; readonly views: readonly DrawnView[] };

/** A view, laid out. */
async function layoutView(view: StoryMapView): Promise<DrawnView> {
  const sizes = new Map(
    view.nodes.map((n) => [
      n.id,
      Math.max(MIN_WIDTH, Math.round(n.label.length * CHARACTER + PADDING)),
    ]),
  );
  const input: ElkNode = {
    id: view.id,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.edgeRouting": "POLYLINE",
      "elk.layered.spacing.nodeNodeBetweenLayers": "48",
      "elk.spacing.nodeNode": "28",
      // In reading order (the compiler's), so a map changes little between edits.
      "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    },
    children: view.nodes.map((n) => ({
      id: n.id,
      width: sizes.get(n.id) ?? MIN_WIDTH,
      height: BOX_HEIGHT,
      // The start alone at the top.
      ...(n.start === true && {
        layoutOptions: { "elk.layered.layering.layerConstraint": "FIRST_SEPARATE" },
      }),
    })),
    edges: view.edges.map((e, i) => ({ id: `e${String(i)}`, sources: [e.from], targets: [e.to] })),
  };
  const graph = await elk.layout(input);
  const placed = new Map((graph.children ?? []).map((c) => [c.id, c]));
  const routes = new Map((graph.edges ?? []).map((e) => [e.id, e.sections?.[0]]));
  return {
    id: view.id,
    title: view.title,
    width: graph.width ?? 0,
    height: graph.height ?? 0,
    nodes: view.nodes.map((n) => {
      const at = placed.get(n.id);
      return {
        ...n,
        x: at?.x ?? 0,
        y: at?.y ?? 0,
        width: at?.width ?? MIN_WIDTH,
        height: at?.height ?? BOX_HEIGHT,
      };
    }),
    edges: view.edges.map((e, i) => {
      const route = routes.get(`e${String(i)}`);
      return {
        ...e,
        points: route ? [route.startPoint, ...(route.bendPoints ?? []), route.endPoint] : [],
      };
    }),
  };
}

/** A story map laid out for drawing, with the game's title. */
export async function layoutStoryMap(map: StoryMap, title?: string): Promise<MapDrawing> {
  const views = await Promise.all(map.views.map(layoutView));
  return { ...(title !== undefined && { title }), views };
}
