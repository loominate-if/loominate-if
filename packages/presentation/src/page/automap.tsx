/**
 * An auto-map (#394, #395; ADR 0125): the rooms around the player on a
 * grid, drawn small, which opens the whole map in a dialog. It's generic,
 * like the compass: a package that knows the rooms, such as the world
 * model, supplies them as plain data in cells, and the view can be replaced
 * entirely, keeping the data. For a screen reader the small map is one
 * button with a spoken summary; the full map has rooms to move between
 * with the arrow keys, each read with its ways out, and a list beside them.
 */
import { message } from "@loominate-if/core";
import "../messages.js";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { componentView, now } from "./view.js";
import { widget, type WidgetDefinition } from "./layout.js";
import type { PageGame } from "./page.js";

/** A way out of a room, as the full map's list shows it. */
export type AutomapWay = {
  /** What it says: "East: the kitchen", "North: not explored". */
  readonly label: string;
  /** The room it leads to, by ID, if the player knows it. */
  readonly to?: string;
};

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
  /** Its ways out, for the full map. */
  readonly ways?: readonly AutomapWay[];
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

/** The whole map, as the full map shows it: every room the player knows, each with its ways. */
export type AutomapFullMap = {
  /** How many cells across and down it takes. */
  readonly columns: number;
  readonly rows: number;
  readonly view: AutomapView;
};

/** The data an auto-map shows: plain, so a game can draw it its own way. */
export type AutomapData = {
  /** How many cells across and down the map shows. */
  readonly columns: number;
  readonly rows: number;
  /** What it shows now, or `undefined` when the player isn't anywhere on the map. */
  readonly view?: AutomapView;
  /** The whole map, which the small one opens, if there's one to open. */
  readonly full?: AutomapFullMap;
};

/** How {@link automapWidget} finds the rooms. */
export type AutomapOptions = {
  /** The rooms around the player now, in a window of `columns` by `rows` cells. */
  readonly rooms: (
    game: PageGame,
    size: { columns: number; rows: number },
  ) => AutomapView | undefined;
  /** The whole map, for the dialog the small map opens. Without it, the small map is only a picture. */
  readonly full?: (game: PageGame) => AutomapFullMap | undefined;
  /** Cells across, odd so the player's room is in the middle. Defaults to 5. */
  readonly columns?: number;
  /** Cells down, odd. Defaults to 3. */
  readonly rows?: number;
};

/** A cell's size in a drawing, the box a room is drawn as in it, and how long a name fits. */
type Scale = {
  readonly cellW: number;
  readonly cellH: number;
  readonly boxW: number;
  readonly boxH: number;
  readonly letters: number;
};
const SMALL: Scale = { cellW: 64, cellH: 40, boxW: 52, boxH: 24, letters: 8 };
const FULL: Scale = { cellW: 128, cellH: 72, boxW: 104, boxH: 36, letters: 14 };

/** Where the line from a box's centre toward a point leaves the box. */
function edgeOf(scale: Scale, cx: number, cy: number, tx: number, ty: number): [number, number] {
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const k = Math.min(
    dx === 0 ? Infinity : scale.boxW / 2 / Math.abs(dx),
    dy === 0 ? Infinity : scale.boxH / 2 / Math.abs(dy),
  );
  return [cx + dx * k, cy + dy * k];
}

/** A label short enough for its box, with an ellipsis. */
const shortened = (label: string, letters: number): string =>
  label.length <= letters ? label : `${label.slice(0, letters - 1)}…`;

/** The direction each arrow key moves on the grid. */
const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * The room an arrow key moves to from `from`: the nearest in that
 * direction, within 45 degrees of it, preferring rooms straight ahead, then
 * reading order. Every room is within 45 degrees of some direction, so
 * each can be reached from any other.
 * @internal
 */
export function _roomToward(
  rooms: readonly AutomapRoom[],
  from: AutomapRoom,
  [dx, dy]: readonly [number, number],
): AutomapRoom | undefined {
  let best: { room: AutomapRoom; score: number; along: number } | undefined;
  for (const room of rooms) {
    const along = (room.x - from.x) * dx + (room.y - from.y) * dy;
    const across = Math.abs((room.x - from.x) * dy - (room.y - from.y) * dx);
    if (room.id === from.id || along <= 0 || across > along) continue;
    const score = along + 2 * across;
    if (!best || score < best.score || (score === best.score && along < best.along)) {
      best = { room, score, along };
    }
  }
  return best?.room;
}

/** A map's rooms and ways, drawn: hidden from screen readers when small, rooms to move between when full. */
function Drawing(props: {
  readonly scale: Scale;
  readonly columns: number;
  readonly rows: number;
  readonly view: AutomapView;
  /** For the full map: the room with focus, and what to do as it moves. */
  readonly focus?: {
    readonly at: string | undefined;
    readonly label: (room: AutomapRoom) => string;
    readonly onFocus: (room: AutomapRoom) => void;
    readonly onHover: (room: AutomapRoom | undefined) => void;
    readonly onKey: (event: KeyboardEvent, room: AutomapRoom) => void;
  };
}) {
  const { scale, columns, rows, view, focus } = props;
  const at = new Map(view.rooms.map((r) => [r.id, r]));
  const centre = (r: AutomapRoom): [number, number] => [
    r.x * scale.cellW + scale.cellW / 2,
    r.y * scale.cellH + scale.cellH / 2,
  ];
  const shown = (r: AutomapRoom): boolean => r.x >= 0 && r.y >= 0 && r.x < columns && r.y < rows;
  const width = columns * scale.cellW;
  const height = rows * scale.cellH;
  const arrow = focus ? "loominate-automap-arrow-full" : "loominate-automap-arrow";
  return (
    <svg
      className="loominate-automap-picture"
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      {...(focus
        ? { width, height, role: "group" as const, "aria-label": message("automap.keys") }
        : { "aria-hidden": "true", focusable: "false" })}
    >
      <defs>
        <marker
          id={arrow}
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
      <g aria-hidden="true">
        {view.links.map((l) => {
          const a = at.get(l.from);
          const b = at.get(l.to);
          if (!a || !b) return null;
          const [ax, ay] = centre(a);
          const [bx, by] = centre(b);
          const [x1, y1] = edgeOf(scale, ax, ay, bx, by);
          const [x2, y2] = edgeOf(scale, bx, by, ax, ay);
          return (
            <g key={`${l.from}>${l.to}`} data-from={l.from} data-to={l.to}>
              <line
                className={`loominate-automap-link${l.label !== undefined ? " loominate-automap-bent" : ""}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                {...(l.oneWay && { "marker-end": `url(#${arrow})` })}
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
      </g>
      {view.rooms.filter(shown).map((r) => {
        const [cx, cy] = centre(r);
        const focusable = focus && {
          tabindex: r.id === focus.at ? 0 : -1,
          role: "img" as const,
          "aria-label": focus.label(r),
          onFocus: () => {
            focus.onFocus(r);
          },
          onMouseEnter: () => {
            focus.onHover(r);
          },
          onMouseLeave: () => {
            focus.onHover(undefined);
          },
          onKeyDown: (event: KeyboardEvent) => {
            focus.onKey(event, r);
          },
        };
        return (
          <g
            key={r.id}
            className={`loominate-automap-room${r.current ? " loominate-automap-current" : ""}`}
            data-room={r.id}
            {...focusable}
          >
            {!focus && <title>{r.label}</title>}
            <rect
              x={cx - scale.boxW / 2}
              y={cy - scale.boxH / 2}
              width={scale.boxW}
              height={scale.boxH}
              rx="4"
            />
            <text x={cx} y={cy} text-anchor="middle" dominant-baseline="central" aria-hidden="true">
              {shortened(r.label, scale.letters)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** What a screen reader hears for a room on the full map, with its ways out. */
const roomLabel = (r: AutomapRoom): string =>
  message("automap.room", {
    room: r.label,
    current: r.current === true,
    ways: (r.ways ?? []).map((w) => w.label),
  });

/** The full map, in a modal dialog: the drawing, rooms to move between, and the list beside it. */
function FullMap(props: {
  readonly map: AutomapFullMap;
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  const { map, open, onClose } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const current = map.view.rooms.find((r) => r.current) ?? map.view.rooms[0];
  const [at, setAt] = useState<string | undefined>(current?.id);
  const [tip, setTip] = useState<AutomapRoom | undefined>(undefined);
  const [hover, setHover] = useState<AutomapRoom | undefined>(undefined);
  const focusRoom = (id: string | undefined): void => {
    if (id === undefined) return;
    setAt(id);
    const rooms = dialog.current?.querySelectorAll<SVGGElement>("g.loominate-automap-room") ?? [];
    [...rooms].find((g) => g.dataset.room === id)?.focus();
  };
  /** Closes it: natively, which fires `close`, or by hand where there's no `close()`. */
  const shut = (): void => {
    const d = dialog.current;
    if (!d) return;
    if (typeof d.close === "function") {
      d.close();
      return;
    }
    d.open = false;
    d.ownerDocument.documentElement.classList.remove("loominate-modal-open");
    onClose();
  };
  useLayoutEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === "function") d.showModal();
      else d.open = true;
      d.ownerDocument.documentElement.classList.add("loominate-modal-open");
      // The player's room takes focus, so a screen reader reads where they are first.
      focusRoom(current?.id);
    } else if (!open && d.open) {
      shut();
    }
  }, [open]);
  useLayoutEffect(() => {
    const d = dialog.current;
    if (!d) return undefined;
    // However it closes, by Close or Escape, the page behind can scroll again.
    const closed = (): void => {
      d.ownerDocument.documentElement.classList.remove("loominate-modal-open");
      onClose();
    };
    d.addEventListener("close", closed);
    return () => {
      d.removeEventListener("close", closed);
    };
  }, [onClose]);
  const onKey = (event: KeyboardEvent, from: AutomapRoom): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const step = ARROWS[event.key];
    const to =
      step !== undefined
        ? _roomToward(map.view.rooms, from, step)
        : event.key === "Home"
          ? current
          : undefined;
    if (step === undefined && to === undefined) return;
    event.preventDefault();
    if (to) focusRoom(to.id);
  };
  const shownTip = hover ?? tip;
  const names = new Map(map.view.rooms.map((r) => [r.id, r]));
  return (
    <dialog
      ref={dialog}
      className="loominate-automap-dialog"
      aria-labelledby="loominate-automap-title"
    >
      <h2 id="loominate-automap-title">{message("automap.title")}</h2>
      <p className="loominate-automap-summary">{map.view.summary}</p>
      <div className="loominate-automap-full">
        <div className="loominate-automap-scroll">
          <div className="loominate-automap-canvas">
            <Drawing
              scale={FULL}
              columns={map.columns}
              rows={map.rows}
              view={map.view}
              focus={{
                at,
                label: roomLabel,
                onFocus: (r) => {
                  now(() => {
                    setAt(r.id);
                    setTip(r);
                  });
                },
                onHover: (r) => {
                  now(() => {
                    setHover(r);
                  });
                },
                onKey,
              }}
            />
            {shownTip && (
              <div
                className="loominate-automap-tip"
                aria-hidden="true"
                style={{
                  left: `${String(shownTip.x * FULL.cellW + FULL.cellW / 2)}px`,
                  top: `${String(shownTip.y * FULL.cellH + FULL.cellH / 2 + FULL.boxH / 2 + 4)}px`,
                }}
              >
                {shownTip.label}
              </div>
            )}
          </div>
        </div>
        <section className="loominate-automap-list" aria-labelledby="loominate-automap-rooms">
          <h3 id="loominate-automap-rooms">{message("automap.rooms")}</h3>
          <ul>
            {map.view.rooms.map((r) => (
              <li key={r.id} data-room={r.id}>
                <button
                  type="button"
                  className="loominate-link"
                  onClick={() => {
                    focusRoom(r.id);
                  }}
                >
                  {r.label}
                </button>
                {r.current && (
                  <span className="loominate-automap-here">{` (${message("automap.here")})`}</span>
                )}
                {(r.ways ?? []).length > 0 && (
                  <ul>
                    {(r.ways ?? []).map((w) => (
                      <li
                        key={w.label}
                        {...(w.to === undefined && { className: "loominate-automap-unexplored" })}
                        {...(w.to !== undefined && names.has(w.to) && { "data-to": w.to })}
                      >
                        {w.label}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
      <button
        type="button"
        onClick={() => {
          shut();
        }}
      >
        {message("automap.close")}
      </button>
    </dialog>
  );
}

/**
 * An auto-map: the visited rooms in a small window around the player's room,
 * the player's room marked, two-way ways as lines, one-way ways with an
 * arrow, and ways that aren't compass steps bent and named. Given the whole
 * map, it's a button that opens it.
 */
export function automapWidget(options: AutomapOptions): WidgetDefinition<AutomapData> {
  const columns = options.columns ?? 5;
  const rows = options.rows ?? 3;
  return widget({
    data: (game) => {
      const view = options.rooms(game, { columns, rows });
      const full = options.full?.(game);
      return { columns, rows, ...(view && { view }), ...(full && { full }) };
    },
    view: componentView<AutomapData>(({ data }) => {
      const d = data.value;
      const view = d.view;
      const [open, setOpen] = useState(false);
      const opener = useRef<HTMLButtonElement>(null);
      const label = message("automap.label");
      if (!view) {
        return (
          <figure className="loominate-automap" aria-label={label}>
            <p className="loominate-automap-empty">{message("automap.nowhere")}</p>
          </figure>
        );
      }
      const picture = <Drawing scale={SMALL} columns={d.columns} rows={d.rows} view={view} />;
      if (!d.full) {
        return (
          <figure className="loominate-automap" role="img" aria-label={view.summary}>
            {picture}
          </figure>
        );
      }
      return (
        <div className="loominate-automap">
          <button
            ref={opener}
            type="button"
            className="loominate-automap-open"
            aria-label={view.summary}
            aria-haspopup="dialog"
            onClick={() => {
              now(() => {
                setOpen(true);
              });
            }}
          >
            {picture}
          </button>
          <FullMap
            map={d.full}
            open={open}
            onClose={() => {
              now(() => {
                setOpen(false);
              });
              // Back to the small map, which opened it.
              opener.current?.focus();
            }}
          />
        </div>
      );
    }),
  });
}
