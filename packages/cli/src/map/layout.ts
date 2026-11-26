/**
 * Lays out a story map (#149, #426; ADRs 0123 and 0124): a view of passages
 * as a layered graph, top to bottom from the start, with ELK; a view whose
 * places come with grid cells, as rooms by compass, on that grid. The
 * inspector's viewer draws the result.
 */
import type { StoryMapEdge, StoryMapNode, StoryMapSource } from "@loominate-if/compiler";
import type { ElkNode } from "elkjs/lib/elk-api.js";
// A CommonJS module whose class TypeScript sees as `.default`, as Node gives it too.
import elkjs from "elkjs/lib/elk.bundled.js";

/** How tall a place's box is, and roughly how wide a character of its label. */
const BOX_HEIGHT = 36;
const CHARACTER = 7.5;
const PADDING = 28;
const MIN_WIDTH = 80;
/** The space between grid cells, across and down. */
const GRID_GAP_X = 56;
const GRID_GAP_Y = 56;

const elk = new elkjs.default();

/** A point in the drawing. */
type Point = { readonly x: number; readonly y: number };

/**
 * A view to lay out: the compiler's Passages view, or one a package adds
 * (core's `MapViewContent`), whose places may come with grid cells.
 */
export type MapViewInput = {
  readonly id: string;
  readonly title: string;
  readonly nodes: readonly (Omit<StoryMapNode, "tags"> & {
    readonly tags?: readonly string[];
    readonly cell?: Point;
  })[];
  readonly edges: readonly (Omit<StoryMapEdge, "source"> & {
    readonly source?: StoryMapSource;
    readonly bent?: true;
  })[];
  /** Why the view couldn't be made. */
  readonly error?: string;
};

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
  readonly nodes: readonly (Omit<MapViewInput["nodes"][number], "cell" | "tags"> & {
    tags: readonly string[];
    x: number;
    y: number;
    width: number;
    height: number;
  })[];
  readonly edges: readonly (MapViewInput["edges"][number] & { points: readonly Point[] })[];
  readonly grid?: true;
  readonly error?: string;
};

/** A laid-out story map: the inspector's `MapDrawing`. */
export type MapDrawing = { readonly title?: string; readonly views: readonly DrawnView[] };

/** How wide a place's box is, for its label. */
const widthOf = (label: string): number =>
  Math.max(MIN_WIDTH, Math.round(label.length * CHARACTER + PADDING));

/** A node as drawn, without its grid cell. */
function drawnNode(
  n: MapViewInput["nodes"][number],
  box: { x: number; y: number; width: number; height: number },
): DrawnView["nodes"][number] {
  // The cell has served: the drawing has the box.
  const { cell, ...rest } = n;
  void cell;
  return { ...rest, tags: n.tags ?? [], ...box };
}

/** A view laid out by ELK, layered from the top. */
async function layered(view: MapViewInput): Promise<DrawnView> {
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
      width: widthOf(n.label),
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
      return drawnNode(n, {
        x: at?.x ?? 0,
        y: at?.y ?? 0,
        width: at?.width ?? MIN_WIDTH,
        height: at?.height ?? BOX_HEIGHT,
      });
    }),
    edges: view.edges.map((e, i) => {
      const route = routes.get(`e${String(i)}`);
      return {
        ...e,
        points: route ? [route.startPoint, ...(route.bendPoints ?? []), route.endPoint] : [],
      };
    }),
    ...(view.error !== undefined && { error: view.error }),
  };
}

/** Where the line from a box's centre toward `toward` leaves the box. */
function boxEdge(
  center: Point,
  half: { readonly w: number; readonly h: number },
  toward: Point,
): Point {
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (dx === 0 && dy === 0) return center;
  const scale = Math.min(
    dx === 0 ? Infinity : half.w / Math.abs(dx),
    dy === 0 ? Infinity : half.h / Math.abs(dy),
  );
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

/** A view on its grid: each place in its cell, ways straight between them, bent ones curved. */
function onGrid(view: MapViewInput): DrawnView {
  const cells = view.nodes.map((n) => n.cell ?? { x: 0, y: 0 });
  const minX = Math.min(...cells.map((c) => c.x));
  const minY = Math.min(...cells.map((c) => c.y));
  const cellWidth = Math.max(...view.nodes.map((n) => widthOf(n.label))) + GRID_GAP_X;
  const cellHeight = BOX_HEIGHT + GRID_GAP_Y;
  const boxes = new Map<string, { center: Point; half: { w: number; h: number } }>();
  const nodes = view.nodes.map((n, i) => {
    const cell = cells[i] ?? { x: 0, y: 0 };
    const width = widthOf(n.label);
    const center = {
      x: (cell.x - minX) * cellWidth + cellWidth / 2,
      y: (cell.y - minY) * cellHeight + cellHeight / 2,
    };
    boxes.set(n.id, { center, half: { w: width / 2, h: BOX_HEIGHT / 2 } });
    return drawnNode(n, {
      x: center.x - width / 2,
      y: center.y - BOX_HEIGHT / 2,
      width,
      height: BOX_HEIGHT,
    });
  });
  const edges = view.edges.map((e) => {
    const from = boxes.get(e.from);
    const to = boxes.get(e.to);
    if (!from || !to) return { ...e, points: [] };
    // A bent way between neighbouring cells, as up a ladder to the room beside, is drawn straight.
    const a = view.nodes.find((n) => n.id === e.from)?.cell;
    const b = view.nodes.find((n) => n.id === e.to)?.cell;
    const neighbours =
      a &&
      b &&
      Math.abs(a.x - b.x) <= 1 &&
      Math.abs(a.y - b.y) <= 1 &&
      (a.x !== b.x || a.y !== b.y);
    if (!e.bent || neighbours) {
      return {
        ...e,
        points: [
          boxEdge(from.center, from.half, to.center),
          boxEdge(to.center, to.half, from.center),
        ],
      };
    }
    // Bent: out through a point off to the side, so it doesn't run over the rooms between.
    const mid = { x: (from.center.x + to.center.x) / 2, y: (from.center.y + to.center.y) / 2 };
    const dx = to.center.x - from.center.x;
    const dy = to.center.y - from.center.y;
    const length = Math.hypot(dx, dy) || 1;
    const offset = Math.min(cellHeight, length / 3) + (dx === 0 && dy === 0 ? cellHeight : 0);
    const side = { x: mid.x - (dy / length) * offset, y: mid.y + (dx / length) * offset };
    return {
      ...e,
      points: [boxEdge(from.center, from.half, side), side, boxEdge(to.center, to.half, side)],
    };
  });
  const across = Math.max(...cells.map((c) => c.x)) - minX + 1;
  const down = Math.max(...cells.map((c) => c.y)) - minY + 1;
  return {
    id: view.id,
    title: view.title,
    width: across * cellWidth,
    height: down * cellHeight,
    nodes,
    edges,
    grid: true,
    ...(view.error !== undefined && { error: view.error }),
  };
}

/** A view laid out: on its grid if every place has a cell, layered otherwise. */
async function layoutView(view: MapViewInput): Promise<DrawnView> {
  return view.nodes.length > 0 && view.nodes.every((n) => n.cell !== undefined)
    ? onGrid(view)
    : layered(view);
}

/** A story map's views laid out for drawing, with the game's title. */
export async function layoutStoryMap(
  map: { readonly views: readonly MapViewInput[] },
  title?: string,
): Promise<MapDrawing> {
  const views = await Promise.all(map.views.map(layoutView));
  return { ...(title !== undefined && { title }), views };
}
