/**
 * The page model (#37): each move replaces the main view with the
 * new passage, and a "story so far" drawer shows what came before. The
 * drawer is drawn from the event record alone, so it shows exactly what the
 * player read, and undo, loading a save, or a replay change it just by
 * changing the record.
 */
import type {
  Choice,
  EventKind,
  EventRecord,
  RecordedEvent,
  RenderedInlineLink,
  RenderedLink,
  RenderedNode,
  Story,
  TextStyle,
} from "@loominate-if/core";
import {
  display,
  layouts,
  widgets,
  type LayoutDefinition,
  type MountedWidget,
  type WidgetDefinition,
  type WidgetHost,
} from "./layout.js";
import { appendProse } from "./prose.js";

/** What a page shows: a story and its event record. */
export type PageGame = {
  /** The story. The page begins it if it hasn't begun. */
  readonly story: Story;
  /** The story's event record, which the drawer is drawn from. */
  readonly record: EventRecord;
};

/** Options for {@link mountPage}. */
export type PageOptions = {
  /**
   * Called after each move the player makes on the page, with the choice
   * followed: a place to checkpoint undo history or autosave.
   */
  readonly onMove?: (choice: Choice) => void;
  /** The drawer's label. Defaults to "Story so far". */
  readonly drawerLabel?: string;
  /** The label for a continue point that has none. Defaults to "Continue". */
  readonly continueLabel?: string;
};

/** A story shown on a page. */
export interface Page {
  /** The page's root element. */
  readonly element: HTMLElement;
  /**
   * Redraws the page from the story and its record, after something outside
   * the page changed them, such as undo or loading a save.
   */
  refresh(): void;
  /** Removes the page from the document. */
  destroy(): void;
}

/** Event kinds the drawer shows: prose the player read. */
const PROSE_KINDS: readonly EventKind[] = ["narrative", "scene", "dialogue", "room-description"];

/**
 * Shows a story in `container`: the current passage in the main view, and
 * the story so far in a drawer, in the layout named by `display.layout`, with
 * its widgets.
 *
 * @remarks
 * The main view is a live region, so screen readers announce each new
 * passage, and it takes focus after each move.
 *
 * @example
 * ```ts
 * const page = mountPage(document.querySelector("#app")!, { story, record }, {
 *   onMove: () => history.checkpoint(),
 * });
 * ```
 */
export function mountPage(container: HTMLElement, game: PageGame, options: PageOptions = {}): Page {
  const { story, record } = game;
  const doc = container.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
  ): HTMLElementTagNameMap[K] => {
    const node = doc.createElement(tag);
    if (className !== undefined) node.className = className;
    return node;
  };

  const root = el("div", "loominate-page");
  const main = el("main", "loominate-main");
  main.tabIndex = -1;
  main.setAttribute("aria-live", "polite");
  const drawer = el("details", "loominate-drawer");
  const summary = el("summary");
  summary.textContent = options.drawerLabel ?? "Story so far";
  const scrollback = el("div", "loominate-drawer-content");
  drawer.append(summary, scrollback);
  container.append(root);

  let reasons = 0;
  const follow = (choice: Choice): void => {
    story.follow(choice);
    options.onMove?.(choice);
    draw();
    main.focus({ preventScroll: true });
  };

  /** A button for a link or continue point, disabled with its reason when it can't be followed. */
  const button = (
    node: RenderedLink | Extract<RenderedNode, { type: "continue" }>,
    label: Node[] | string,
    className: string,
  ): HTMLElement => {
    const b = el("button", className);
    b.type = "button";
    b.append(...(typeof label === "string" ? [label] : label));
    if (node.type === "link" && !node.available) {
      b.disabled = true;
      return b;
    }
    b.addEventListener("click", () => {
      follow(node);
    });
    return b;
  };

  /** A reason a link is disabled, linked to its button for screen readers. */
  const reason = (b: HTMLElement, text: string | undefined): HTMLElement | undefined => {
    if (text === undefined) return undefined;
    const r = el("span", "loominate-reason");
    r.id = `loominate-reason-${String(++reasons)}`;
    r.textContent = text;
    b.setAttribute("aria-describedby", r.id);
    return r;
  };

  const drawMain = (): void => {
    main.replaceChildren();
    for (const node of story.render().nodes) {
      if (node.type === "text") {
        const p = el("p");
        const after: HTMLElement[] = [];
        appendProse(
          p,
          node.text,
          node.styles ?? [],
          node.links ?? [],
          (link: RenderedInlineLink, label) => {
            const b = button(link, label, "loominate-link loominate-inline");
            const r = reason(b, link.reason);
            if (r) after.push(r);
            return b;
          },
        );
        main.append(p);
        // Reasons for disabled inline links follow the paragraph, so the sentence still reads.
        for (const r of after) {
          const note = el("p", "loominate-note");
          note.append(r);
          main.append(note);
        }
      } else {
        const p = el("p", "loominate-choice");
        if (node.type === "continue") {
          p.append(
            button(node, node.label ?? options.continueLabel ?? "Continue", "loominate-continue"),
          );
        } else {
          const b = button(node, node.label, "loominate-link");
          p.append(b);
          const r = reason(b, node.reason);
          if (r) p.append(" ", r);
        }
        main.append(p);
      }
    }
  };

  const drawDrawer = (): void => {
    const events = record.events({ kinds: [...PROSE_KINDS, "navigation"] });
    // Each move starts at a navigation; the last move is the one on screen.
    const turns: RecordedEvent[][] = [];
    for (const e of events) {
      if (e.kind === "navigation" || turns.length === 0) turns.push([]);
      if (e.kind !== "navigation") turns.at(-1)?.push(e);
    }
    turns.pop();
    scrollback.replaceChildren(
      ...turns
        .filter((t) => t.length > 0)
        .map((turn) => {
          const section = el("section", "loominate-turn");
          for (const e of turn) {
            const fields = e as RecordedEvent & { text: string; styles?: readonly TextStyle[] };
            const p = el("p");
            appendProse(p, fields.text, fields.styles ?? [], [], () => el("span"));
            section.append(p);
          }
          return section;
        }),
    );
    drawer.hidden = scrollback.childElementCount === 0;
  };

  // ---- Layout and widgets ------------------------------------------------

  type Mounted = {
    readonly name: string;
    readonly element: HTMLElement;
    readonly definition: WidgetDefinition;
    readonly view: MountedWidget<unknown>;
    data: unknown;
  };
  let layout: { readonly name: string; readonly definition: LayoutDefinition } | undefined;
  let mounted: Mounted[] = [];
  const host: WidgetHost = { story, record, follow };

  const mount = (region: HTMLElement, name: string): Mounted => {
    const definition = widgets.get(name);
    if (!definition) {
      throw new Error(
        `The widget "${name}" isn't registered. Register it with widgets.register("${name}", …).`,
      );
    }
    const element = el("div", `loominate-widget loominate-widget-${name}`);
    element.dataset.widget = name;
    region.append(element);
    const data = definition.data(game);
    return { name, element, definition, view: definition.view.mount(element, data, host), data };
  };
  const unmount = (w: Mounted): void => {
    w.view.unmount();
    w.element.remove();
  };

  /** Builds the regions of the layout `display.layout` names, if it changed. */
  const drawLayout = (): void => {
    const name = display.layout;
    const definition = layouts.get(name);
    if (layout?.name === name && layout.definition === definition) return;
    if (!definition) {
      throw new Error(
        `The layout "${name}" isn't registered. Register it with layouts.register("${name}", { regions: […] }), or set display.layout to one that is.`,
      );
    }
    if (!definition.regions.includes("main")) {
      throw new Error(
        `The layout "${name}" has no "main" region, where the passage goes. Add "main" to its regions.`,
      );
    }
    for (const region of Object.keys(definition.widgets ?? {})) {
      if (!definition.regions.includes(region)) {
        throw new Error(
          `The layout "${name}" puts widgets in "${region}", which isn't one of its regions.`,
        );
      }
    }
    for (const w of mounted) unmount(w);
    mounted = [];
    root.replaceChildren(
      ...definition.regions.map((region) => {
        const r = el("div", `loominate-region loominate-region-${region}`);
        r.dataset.region = region;
        if (region === "main") r.append(main, drawer);
        const names = definition.widgets?.[region] ?? [];
        for (const w of names) mounted.push(mount(r, w));
        r.hidden = region !== "main" && names.length === 0;
        return r;
      }),
    );
    root.dataset.layout = name;
    layout = { name, definition };
  };

  /** Updates each widget whose data changed, and remounts one whose definition was replaced. */
  const drawWidgets = (): void => {
    mounted = mounted.map((w) => {
      if (widgets.get(w.name) !== w.definition) {
        const region = w.element.parentElement;
        const next = region ? mount(region, w.name) : w;
        if (region) {
          w.element.replaceWith(next.element);
          w.view.unmount();
        }
        return next;
      }
      const data = w.definition.data(game);
      if (!same(data, w.data)) {
        w.view.update(data);
        w.data = data;
      }
      return w;
    });
  };

  const draw = (): void => {
    drawLayout();
    drawMain();
    drawDrawer();
    drawWidgets();
  };

  story.begin();
  draw();
  return {
    element: root,
    refresh: draw,
    destroy() {
      for (const w of mounted) unmount(w);
      mounted = [];
      root.remove();
    },
  };
}

/** Whether two pieces of plain data are the same. */
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) =>
      Object.hasOwn(b, k) &&
      same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}
