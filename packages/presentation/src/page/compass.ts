/**
 * A compass (#81, ADR 0063): buttons for the ways out of where the player
 * is, laid out by direction, which keys can take too. It's generic: a
 * package that knows the ways, such as the world model, supplies them as
 * plain data, and says how to take one, so the view can be replaced
 * entirely, as a brass ship's compass or a subway map, keeping the data.
 */
import { message } from "@loominate-if/core";
import "../messages.js";
import { widget, type WidgetDefinition, type WidgetHost } from "./layout.js";
import type { PageGame } from "./page.js";

/** One way a compass shows. */
export type CompassWay = {
  /** Its direction's name, as `"north"` or `"up"`, which places it and keys take it by. */
  readonly direction: string;
  /** What its button says: "N", "Up". */
  readonly label: string;
  /** What it is in full, for screen readers and tooltips: "North, to the library". */
  readonly title: string;
  /** Whether it can be taken now. */
  readonly available: boolean;
  /** Why it can't, if it can't: "The cellar door is locked." */
  readonly reason?: string;
};

/** The data a compass shows: plain, so a game can draw it its own way. */
export type CompassData = {
  /** What the compass is, for screen readers: "Compass". */
  readonly label: string;
  /** The ways out, as the package gives them. */
  readonly ways: readonly CompassWay[];
};

/** How {@link compassWidget} finds and takes ways. */
export type CompassOptions = {
  /** The ways out of where the player is now. */
  readonly ways: (game: PageGame) => readonly CompassWay[];
  /** Takes the way in `direction`, as a move, through the page. */
  readonly take: (host: WidgetHost, direction: string) => void;
  /**
   * Which keys take a way, when focus isn't in a text field: the numpad's
   * 8 2 4 6, 7 9 1 3, + and - (`"numpad"`, the default), vi-style h j k l
   * y u b n (`"vi"`), `"both"`, or `"none"`.
   */
  readonly keys?: "numpad" | "vi" | "both" | "none";
};

/** Where each of the eight compass points goes in a 3 by 3 grid. */
const GRID: Readonly<Record<string, readonly [number, number]>> = {
  northwest: [1, 1],
  north: [2, 1],
  northeast: [3, 1],
  west: [1, 2],
  east: [3, 2],
  southwest: [1, 3],
  south: [2, 3],
  southeast: [3, 3],
};
const NUMPAD: Readonly<Record<string, string>> = {
  Numpad8: "north",
  Numpad2: "south",
  Numpad4: "west",
  Numpad6: "east",
  Numpad7: "northwest",
  Numpad9: "northeast",
  Numpad1: "southwest",
  Numpad3: "southeast",
  NumpadAdd: "up",
  NumpadSubtract: "down",
};
const VI: Readonly<Record<string, string>> = {
  k: "north",
  j: "south",
  h: "west",
  l: "east",
  y: "northwest",
  u: "northeast",
  b: "southwest",
  n: "southeast",
};

/** Whether a key press is someone typing, which the compass leaves alone. */
const typing = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  return (
    el !== null &&
    (el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.tagName === "SELECT" ||
      el.isContentEditable)
  );
};

/**
 * A compass: a button for each way out, the eight compass points in a grid
 * and the rest (up, down, in, out, and a game's own) beside it, disabled
 * with why when a way can't be taken. Keys take ways too.
 */
export function compassWidget(options: CompassOptions): WidgetDefinition<CompassData> {
  const keys = options.keys ?? "numpad";
  return widget({
    data: (game) => ({ label: message("compass.label"), ways: options.ways(game) }),
    view: {
      mount(element, data, host) {
        const doc = element.ownerDocument;
        const box = doc.createElement("nav");
        box.className = "loominate-compass";
        element.append(box);
        let current = data;
        const take = (way: CompassWay | undefined): boolean => {
          if (!way?.available) return false;
          options.take(host, way.direction);
          return true;
        };
        const show = (d: CompassData): void => {
          current = d;
          box.setAttribute("aria-label", d.label);
          box.replaceChildren();
          const grid = doc.createElement("div");
          grid.className = "loominate-compass-points";
          const rest = doc.createElement("div");
          rest.className = "loominate-compass-others";
          for (const [i, way] of d.ways.entries()) {
            const b = doc.createElement("button");
            b.type = "button";
            b.className = "loominate-compass-way";
            b.dataset.direction = way.direction;
            b.textContent = way.label;
            b.setAttribute("aria-label", way.title);
            if (way.available) {
              b.title = way.title;
              b.addEventListener("click", () => take(way));
            } else {
              b.setAttribute("aria-disabled", "true");
              b.title = way.reason ?? way.title;
              if (way.reason !== undefined) {
                const why = doc.createElement("span");
                why.className = "loominate-compass-reason";
                why.id = `loominate-compass-why-${String(i)}`;
                why.textContent = way.reason;
                b.setAttribute("aria-describedby", why.id);
                box.append(why);
              }
            }
            const at = GRID[way.direction];
            if (at) {
              b.style.gridColumn = String(at[0]);
              b.style.gridRow = String(at[1]);
              grid.append(b);
            } else rest.append(b);
          }
          box.prepend(grid, rest);
        };
        const onKey = (event: KeyboardEvent): void => {
          if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
          if (typing(event.target)) return;
          const direction =
            (keys === "numpad" || keys === "both" ? NUMPAD[event.code] : undefined) ??
            (keys === "vi" || keys === "both" ? VI[event.key] : undefined);
          if (direction === undefined) return;
          if (take(current.ways.find((w) => w.direction === direction))) event.preventDefault();
        };
        if (keys !== "none") doc.addEventListener("keydown", onKey);
        show(data);
        return {
          update: show,
          unmount: () => {
            doc.removeEventListener("keydown", onKey);
            box.remove();
          },
        };
      },
    },
  });
}
