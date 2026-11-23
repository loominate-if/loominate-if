/**
 * Layouts, regions, and headless widgets (#38, ADR 0017).
 *
 * A layout names its regions in order; widgets live in regions. Both are
 * registered by name in registries (ADR 0012), so a game or kit can add its
 * own or replace a built-in one. Which layout is showing is game state, on
 * {@link display}, so effects switch it and undo, saves, and replays restore it.
 *
 * A widget is headless: `data` computes plain data from the game, purely, and
 * `view` draws it through a small mount/update/unmount contract that any UI
 * framework can meet (ADR 0003).
 */
import { message, object, registry, type Choice, type Registry } from "@loominate-if/core";
import "../messages.js";
import type { MenuSource } from "./menus.js";
import type { PageGame } from "./page.js";

/** The package that registers presentation's built-in layouts and widgets. */
const SOURCE = "@loominate-if/presentation";

/** A layout: named regions in document order, and the widgets in each. */
export type LayoutDefinition = {
  /**
   * Region names, in document order. One must be `main`, where the passage
   * and the story-so-far drawer go. Each region is a
   * `<div class="loominate-region" data-region="…">` for themes to place.
   */
  readonly regions: readonly string[];
  /** The widgets in each region, by registered name, in order. */
  readonly widgets?: Readonly<Record<string, readonly string[]>>;
  /**
   * Regions shown beside `main` rather than above or below it, at its
   * `start` (left, in left-to-right languages) or `end`. On narrow screens
   * each collapses into a drawer the player opens with a button named after
   * it: start sidebars above the passage, end sidebars below it.
   */
  readonly sidebars?: Readonly<Record<string, "start" | "end">>;
};

/** What a widget's view can do: read the game, and make a move as the player would. */
export type WidgetHost = PageGame & {
  /** Follows a choice, as clicking a link on the page does, and redraws the page. */
  follow(choice: Choice): void;
  /**
   * Makes `anchor` a button that opens a menu: for the thing with ID
   * `source`, as a name in the text does, or of the choices a function gives.
   */
  menu(anchor: HTMLElement, source: MenuSource): void;
};

/** A widget's view once mounted. */
export interface MountedWidget<D> {
  /** Shows new data. Called only when the data changed. */
  update(data: D): void;
  /** Removes the view. Its element is removed after. */
  unmount(): void;
}

/**
 * How a widget is drawn: mounted into an element with its first data, then
 * updated. A view written with a UI framework meets this through an adapter.
 */
export interface WidgetView<D> {
  /** Draws the widget into `element`. */
  mount(element: HTMLElement, data: D, host: WidgetHost): MountedWidget<D>;
}

/**
 * A widget: headless data and a view. Replace a registered widget's `view`
 * to restyle it completely while keeping its data.
 */
export type WidgetDefinition<D = unknown> = {
  /**
   * The widget's data, computed from the game after each move. It must be
   * pure, and plain data (strings, numbers, booleans, null, arrays, objects),
   * so the page can tell when it changed.
   */
  readonly data: (game: PageGame) => D;
  /** How it's drawn. */
  readonly view: WidgetView<D>;
};

/**
 * Defines a widget, inferring its data type from `data`, so `view` sees it
 * typed even when the widget is written inline in a registration.
 *
 * @example
 * ```ts
 * widgets.register("notes", widget({
 *   data: ({ story }) => [story.visits("Lit") > 0 ? "A lit lantern" : "An unlit lantern"],
 *   view: {
 *     mount(element, items) {
 *       // items: string[]
 *       const show = (next: string[]) => { element.textContent = next.join(", "); };
 *       show(items);
 *       return { update: show, unmount: () => { element.textContent = ""; } };
 *     },
 *   },
 * }));
 * ```
 */
export function widget<D>(definition: WidgetDefinition<D>): WidgetDefinition<D> {
  return definition;
}

/** Layouts by name. `page` (header, main, footer) is registered by default. */
export const layouts: Registry<LayoutDefinition> = registry<LayoutDefinition>("layouts");

/** Widgets by name. `status-line` is registered by default. */
export const widgets: Registry<WidgetDefinition> = registry<WidgetDefinition>("widgets");

/**
 * What the page shows, as game state. Set `display.layout` in an effect to
 * switch layouts: `{on enter: display.layout = "conversation"}`.
 */
export const display = object("loominate:display", {
  /** The registered layout to show. */
  layout: "page",
});

/** The data the status line shows. */
export type StatusLineData = {
  /** Text at the start of the line. */
  readonly left: string;
  /** Text at the end of the line. */
  readonly right: string;
};

/** Options for {@link statusLine}. */
export type StatusLineOptions = {
  /** The left text. Defaults to the current passage's name. */
  readonly left?: (game: PageGame) => string;
  /** The right text. Defaults to the number of moves made, not counting continues, as `Moves: 3`. */
  readonly right?: (game: PageGame) => string;
};

/** The status line's view: two spans in a bar. */
export const statusLineView: WidgetView<StatusLineData> = {
  mount(element, data) {
    const doc = element.ownerDocument;
    const bar = doc.createElement("div");
    bar.className = "loominate-status";
    const left = doc.createElement("span");
    left.className = "loominate-status-left";
    const right = doc.createElement("span");
    right.className = "loominate-status-right";
    bar.append(left, right);
    element.append(bar);
    const show = (d: StatusLineData): void => {
      left.textContent = d.left;
      right.textContent = d.right;
    };
    show(data);
    return {
      update: show,
      unmount() {
        bar.remove();
      },
    };
  },
};

/**
 * A status line: a bar with text at each end, such as the location and the
 * score.
 *
 * @example
 * ```ts
 * widgets.replace("status-line", statusLine({ right: () => `Score: ${String(score.points)}` }));
 * ```
 */
export function statusLine(options: StatusLineOptions = {}): WidgetDefinition<StatusLineData> {
  return {
    data: (game) => ({
      left: options.left?.(game) ?? game.story.current ?? "",
      right: options.right?.(game) ?? message("status.moves", { count: game.story.moves }),
    }),
    view: statusLineView,
  };
}

layouts.register("page", { regions: ["header", "main", "footer"] }, { source: SOURCE });
widgets.register("status-line", statusLine(), { source: SOURCE });
