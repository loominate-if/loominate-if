/**
 * An auto-map (#394, ADR 0125): the rooms around the player on a grid, drawn
 * small. It's generic, like the compass: a package that knows the rooms,
 * such as the world model, supplies them as plain data in cells, and the
 * view can be replaced entirely, keeping the data. For a screen reader it's
 * one image with a spoken summary; the full map (#395) is where to browse.
 */
import { message } from "@loominate-if/core";
import "../messages.js";
import { componentView } from "./view.js";
import { widget, type WidgetDefinition } from "./layout.js";
import type { PageGame } from "./page.js";

/** A room on the map, in its cell: x to the east, y to the south, counted from the window's top left. */
export type AutomapRoom = {
  /** A stable ID, as the room's object ID. */
  readonly id: string;
  /** Its name, as shown. */
  readonly label: string;
  readonly x: number;
  readonly y: number;
  /** True for the room the player is in. */
  readonly current?: true;
};

/** A way between two rooms on the map. */
export type AutomapLink = {
  readonly from: string;
  readonly to: string;
  /** True if it goes only from `from` to `to`. */
  readonly oneWay?: true;
  /** What to write on a way that isn't a compass step, as "Up", which is drawn bent. */
  readonly label?: string;
};

/** The rooms a map shows now. Rooms just outside the window may be listed, for ways that run off its edge. */
export type AutomapView = {
  /** What a screen reader says for the map: "Map: you're in the taproom. Visited nearby: …". */
  readonly summary: string;
  readonly rooms: readonly AutomapRoom[];
  readonly links: readonly AutomapLink[];
};

/** The data an auto-map shows: plain, so a game can draw it its own way. */
export type AutomapData = {
  /** How many cells across and down the map shows. */
  readonly columns: number;
  readonly rows: number;
  /** What it shows now, or `undefined` when the player isn't anywhere on the map. */
  readonly view?: AutomapView;
};

/** How {@link automapWidget} finds the rooms. */
export type AutomapOptions = {
  /** The rooms around the player now, in a window of `columns` by `rows` cells. */
  readonly rooms: (
    game: PageGame,
    size: { columns: number; rows: number },
  ) => AutomapView | undefined;
  /** Cells across, odd so the player's room is in the middle. Defaults to 5. */
  readonly columns?: number;
  /** Cells down, odd. Defaults to 3. */
  readonly rows?: number;
};

/** A cell's size in the drawing, and the box a room is drawn as in it. */
const CELL_W = 64;
const CELL_H = 40;
const BOX_W = 52;
const BOX_H = 24;

/** Where the line from a box's centre toward a point leaves the box. */
function edgeOf(cx: number, cy: number, tx: number, ty: number): [number, number] {
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const scale = Math.min(
    dx === 0 ? Infinity : BOX_W / 2 / Math.abs(dx),
    dy === 0 ? Infinity : BOX_H / 2 / Math.abs(dy),
  );
  return [cx + dx * scale, cy + dy * scale];
}

/** A label short enough for a small box: the first word or so, with an ellipsis. */
const short = (label: string): string => (label.length <= 8 ? label : `${label.slice(0, 7)}…`);

/**
 * An auto-map: the visited rooms in a small window around the player's room,
 * the player's room marked, two-way ways as lines, one-way ways with an
 * arrow, and ways that aren't compass steps bent and named.
 */
export function automapWidget(options: AutomapOptions): WidgetDefinition<AutomapData> {
  const columns = options.columns ?? 5;
  const rows = options.rows ?? 3;
  return widget({
    data: (game) => {
      const view = options.rooms(game, { columns, rows });
      return { columns, rows, ...(view && { view }) };
    },
    view: componentView<AutomapData>(({ data }) => {
      const d = data.value;
      const view = d.view;
      const label = message("automap.label");
      if (!view) {
        return (
          <figure className="loominate-automap" aria-label={label}>
            <p className="loominate-automap-empty">{message("automap.nowhere")}</p>
          </figure>
        );
      }
      const at = new Map(view.rooms.map((r) => [r.id, r]));
      const centre = (r: AutomapRoom): [number, number] => [
        r.x * CELL_W + CELL_W / 2,
        r.y * CELL_H + CELL_H / 2,
      ];
      const shown = (r: AutomapRoom): boolean =>
        r.x >= 0 && r.y >= 0 && r.x < d.columns && r.y < d.rows;
      return (
        <figure className="loominate-automap" role="img" aria-label={view.summary}>
          <svg
            className="loominate-automap-picture"
            viewBox={`0 0 ${String(d.columns * CELL_W)} ${String(d.rows * CELL_H)}`}
            aria-hidden="true"
            focusable="false"
          >
            <defs>
              <marker
                id="loominate-automap-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" className="loominate-automap-arrowhead" />
              </marker>
            </defs>
            {view.links.map((l) => {
              const a = at.get(l.from);
              const b = at.get(l.to);
              if (!a || !b) return null;
              const [ax, ay] = centre(a);
              const [bx, by] = centre(b);
              const [x1, y1] = edgeOf(ax, ay, bx, by);
              const [x2, y2] = edgeOf(bx, by, ax, ay);
              return (
                <g key={`${l.from}>${l.to}`} data-from={l.from} data-to={l.to}>
                  <line
                    className={`loominate-automap-link${l.label !== undefined ? " loominate-automap-bent" : ""}`}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    {...(l.oneWay && { "marker-end": "url(#loominate-automap-arrow)" })}
                  />
                  {l.label !== undefined && (
                    <text
                      className="loominate-automap-way"
                      x={(x1 + x2) / 2}
                      y={(y1 + y2) / 2}
                      text-anchor="middle"
                      dominant-baseline="central"
                    >
                      {l.label}
                    </text>
                  )}
                </g>
              );
            })}
            {view.rooms.filter(shown).map((r) => {
              const [cx, cy] = centre(r);
              return (
                <g
                  key={r.id}
                  className={`loominate-automap-room${r.current ? " loominate-automap-current" : ""}`}
                  data-room={r.id}
                >
                  <title>{r.label}</title>
                  <rect x={cx - BOX_W / 2} y={cy - BOX_H / 2} width={BOX_W} height={BOX_H} rx="4" />
                  <text x={cx} y={cy} text-anchor="middle" dominant-baseline="central">
                    {short(r.label)}
                  </text>
                </g>
              );
            })}
          </svg>
        </figure>
      );
    }),
  });
}
