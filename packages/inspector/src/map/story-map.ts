/**
 * The story map viewer (#149, ADR 0123): a laid-out map drawn as a picture,
 * beside an outline of the same places that a keyboard or screen reader can
 * follow. The picture follows the outline's focus, and is hidden from screen
 * readers, which have the outline. The CLI lays the map out and gives it here.
 */
import { MAP_STYLES } from "./styles.js";

/** Where something is written, counting lines and columns from 1. */
export type MapSource = { readonly file: string; readonly line: number; readonly column: number };

/** A place, with where the layout put it. */
export type DrawnNode = {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly tags: readonly string[];
  readonly source?: MapSource;
  readonly start?: true;
  readonly unreachable?: true;
  readonly missing?: true;
};

/** A way between places, with the route the layout gave it. */
export type DrawnEdge = {
  readonly from: string;
  readonly to: string;
  /** `link`, or the directive that names the target, as `continue`. */
  readonly kind: string;
  readonly label?: string;
  readonly guarded?: true;
  readonly conditional?: true;
  /** True if it doesn't run straight in its direction on a grid view, as `up`: it's drawn bent. */
  readonly bent?: true;
  /** Where it's written, when it's written in a passage. */
  readonly source?: MapSource;
  /** The route, from the edge of `from` to the edge of `to`. */
  readonly points: readonly { readonly x: number; readonly y: number }[];
};

/** One view of a laid-out map, as Passages. */
export type DrawnView = {
  readonly id: string;
  readonly title: string;
  readonly width: number;
  readonly height: number;
  readonly nodes: readonly DrawnNode[];
  readonly edges: readonly DrawnEdge[];
  /**
   * True for a view laid out on a grid, as rooms by compass: ways are named
   * by their labels, as "North", and a way both directions is one line.
   */
  readonly grid?: true;
  /** Why the view couldn't be made, as when the game couldn't begin. */
  readonly error?: string;
};

/** A laid-out story map, as the CLI gives it to {@link mountStoryMap}. */
export type MapDrawing = {
  /** The game's title, for the page. */
  readonly title?: string;
  readonly views: readonly DrawnView[];
};

/** Options for {@link mountStoryMap}. */
export type StoryMapOptions = {
  /** Opens a place's source, as in the author's editor. Without it, sources are shown as text. */
  readonly open?: (source: MapSource) => void;
  /** The view to show first, by its id, as `rooms`. Defaults to the first. */
  readonly view?: string;
  /** Called with a view's id when the reader chooses it, as to put it in the page's address. */
  readonly onView?: (id: string) => void;
};

/** A mounted story map. */
export type StoryMapView = {
  /** Draws a new map, as after an edit, keeping the view, the selection, and focus. */
  update(drawing: MapDrawing): void;
  /** Selects a place in the current view, focusing it in the outline. */
  select(id: string): void;
  /** Removes the map. */
  destroy(): void;
};

const SVG = "http://www.w3.org/2000/svg";

/** An element with attributes and children. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...children);
  return e;
}

/** An SVG element with attributes. */
function svg(tag: string, attrs: Record<string, string | number> = {}): SVGElement {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** Class names, leaving out those that are `false` or `undefined`. */
const classes = (...names: (string | false | undefined)[]): string =>
  names.filter(Boolean).join(" ");

/** What a place is, in words: "start", "unreachable", "missing". */
function marks(node: DrawnNode): string[] {
  return [
    ...(node.start ? ["start"] : []),
    ...(node.unreachable ? ["unreachable"] : []),
    ...(node.missing ? ["missing: nothing has this name"] : []),
  ];
}

/** How a way is qualified, in words: "guarded", "sometimes", "by continue". */
function qualifiers(edge: DrawnEdge): string[] {
  return [
    ...(edge.kind !== "link" ? [`by ${edge.kind}`] : []),
    ...(edge.guarded ? ["guarded"] : []),
    ...(edge.conditional ? ["sometimes"] : []),
  ];
}

/** A file's name without its folders. */
const fileName = (file: string): string => file.split(/[\\/]/).at(-1) ?? file;

/** A stable id for a place's element, from the view and the place. */
const domId = (view: string, id: string): string =>
  `map-${view}-${[...id].map((c) => (/[\w-]/.test(c) ? c : `_${c.codePointAt(0)?.toString(16) ?? ""}`)).join("")}`;

/**
 * Draws `drawing` into `container`: a toolbar, an outline of the current
 * view's places, and its picture. Returns the map, to update after edits.
 */
export function mountStoryMap(
  container: HTMLElement,
  drawing: MapDrawing,
  options: StoryMapOptions = {},
): StoryMapView {
  const style = el("style", {}, MAP_STYLES);
  const status = el("p", { class: "map-status", role: "status", "aria-live": "polite" });
  const tabs = el("div", { class: "map-tabs", role: "tablist", "aria-label": "Views" });
  const zoomIn = el("button", { type: "button", "aria-label": "Zoom in" }, "+");
  const zoomOut = el("button", { type: "button", "aria-label": "Zoom out" }, "−");
  const fit = el("button", { type: "button" }, "Fit");
  const title = el("h1", { class: "map-title" });
  const toolbar = el(
    "div",
    { class: "map-toolbar" },
    title,
    tabs,
    el("div", { class: "map-zoom", role: "group", "aria-label": "Picture" }, zoomOut, fit, zoomIn),
  );
  const outline = el("nav", { class: "map-outline" });
  const picture = svg("svg", { class: "map-picture", "aria-hidden": "true" }) as SVGSVGElement;
  const frame = el("div", { class: "map-frame" });
  frame.append(picture);
  const root = el(
    "div",
    { class: "loominate-map" },
    toolbar,
    status,
    el("div", { class: "map-body" }, outline, frame),
  );
  container.append(style, root);

  let current = drawing;
  let viewId = drawing.views.find((v) => v.id === options.view)?.id ?? drawing.views[0]?.id ?? "";
  let selected: string | undefined;
  // The picture's viewBox: what part of the drawing shows, and at what zoom.
  let box = { x: 0, y: 0, w: 1, h: 1 };
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

  const view = (): DrawnView | undefined =>
    current.views.find((v) => v.id === viewId) ?? current.views[0];

  const setBox = (next: typeof box): void => {
    box = next;
    picture.setAttribute(
      "viewBox",
      `${String(box.x)} ${String(box.y)} ${String(box.w)} ${String(box.h)}`,
    );
  };
  const fitAll = (): void => {
    const v = view();
    if (!v) return;
    const pad = 24;
    const w = Math.max(v.width, 1) + pad * 2;
    const h = Math.max(v.height, 1) + pad * 2;
    // Never larger than life: a small map sits in the middle at its own size.
    const fw = Math.max(w, picture.clientWidth);
    const fh = Math.max(h, picture.clientHeight);
    setBox({ x: -pad - (fw - w) / 2, y: -pad - (fh - h) / 2, w: fw, h: fh });
  };
  const zoom = (factor: number, cx = box.x + box.w / 2, cy = box.y + box.h / 2): void => {
    const w = box.w * factor;
    const h = box.h * factor;
    setBox({ x: cx - (cx - box.x) * factor, y: cy - (cy - box.y) * factor, w, h });
  };
  /** Moves the picture so `node` is in the middle, keeping the zoom. */
  const centerOn = (node: DrawnNode): void => {
    setBox({
      ...box,
      x: node.x + node.width / 2 - box.w / 2,
      y: node.y + node.height / 2 - box.h / 2,
    });
  };

  /** Selects `id`: highlights it in both, and moves the picture to it. */
  const choose = (id: string, focus: boolean): void => {
    const v = view();
    const node = v?.nodes.find((n) => n.id === id);
    if (!v || !node) return;
    selected = id;
    for (const g of picture.querySelectorAll(".map-node")) {
      g.classList.toggle("selected", g.getAttribute("data-id") === id);
    }
    for (const g of picture.querySelectorAll(".map-edge")) {
      g.classList.toggle(
        "touching",
        g.getAttribute("data-from") === id || g.getAttribute("data-to") === id,
      );
    }
    for (const s of outline.querySelectorAll(".map-place")) {
      s.classList.toggle("selected", s.getAttribute("data-id") === id);
    }
    centerOn(node);
    const heading = outline.querySelector<HTMLElement>(`#${domId(v.id, id)}`);
    if (focus && heading) {
      heading.focus();
      heading.scrollIntoView?.({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
    }
  };

  /** A button that goes to the place `id` in the outline. */
  const goTo = (id: string, text: string, extra: string[]): HTMLButtonElement => {
    const b = el("button", { type: "button", class: "map-go", "data-go": id }, text);
    if (extra.length > 0) b.append(el("span", { class: "map-note" }, ` (${extra.join(", ")})`));
    b.addEventListener("click", () => {
      choose(id, true);
    });
    return b;
  };

  const drawOutline = (v: DrawnView): void => {
    outline.setAttribute("aria-label", v.title);
    const list = el("ul", { class: "map-places" });
    const names = new Map(v.nodes.map((n) => [n.id, n.label]));
    const nameOf = (id: string): string => names.get(id) ?? id;
    for (const node of v.nodes) {
      const heading = el("h2", { id: domId(v.id, node.id), tabindex: "-1" }, node.label);
      const notes = marks(node);
      if (notes.length > 0)
        heading.append(el("span", { class: "map-note" }, ` (${notes.join(", ")})`));
      const item = el("li", { class: "map-place", "data-id": node.id }, heading);
      if (node.tags.length > 0)
        item.append(el("p", { class: "map-tags" }, `Tags: ${node.tags.join(", ")}`));
      const out = v.edges.filter((e) => e.from === node.id);
      const into = v.edges.filter((e) => e.to === node.id && e.from !== node.id);
      /** The places `edges` lead to (`forward`) or come from, each a button that goes there. */
      const section = (label: string, edges: readonly DrawnEdge[], forward: boolean) => {
        if (edges.length === 0) return el("p", { class: "map-none" }, `${label}: nothing.`);
        const ul = el("ul", { "aria-label": label });
        for (const e of edges) {
          const other = forward ? e.to : e.from;
          // On a grid the label is the way, "North: library"; elsewhere it's a link's words.
          const text = v.grid
            ? forward
              ? `${e.label ?? e.kind}: ${nameOf(other)}`
              : `${nameOf(other)}, by its ${e.label ?? e.kind} exit`
            : e.label !== undefined
              ? `${nameOf(other)}: “${e.label}”`
              : nameOf(other);
          ul.append(el("li", {}, goTo(other, text, v.grid ? [] : qualifiers(e))));
        }
        return el("div", {}, el("p", { class: "map-label" }, `${label}:`), ul);
      };
      if (v.grid) {
        // On a grid, a way back is the other room's exit, so only one-way ways in are listed.
        const oneWay = into.filter((e) => !v.edges.some((r) => r.from === e.to && r.to === e.from));
        item.append(section("Exits", out, true));
        if (oneWay.length > 0) item.append(section("One-way in from", oneWay, false));
      } else {
        item.append(section("Leads to", out, true), section("Reached from", into, false));
      }
      if (node.source) {
        const where = `${fileName(node.source.file)}, line ${String(node.source.line)}`;
        const open = options.open;
        if (open) {
          const source = node.source;
          const b = el("button", { type: "button", class: "map-open" }, `Open ${where}`);
          b.addEventListener("click", () => {
            open(source);
          });
          item.append(b);
        } else {
          item.append(el("p", { class: "map-where" }, where));
        }
      }
      heading.addEventListener("focus", () => {
        if (selected !== node.id) choose(node.id, false);
      });
      list.append(item);
    }
    outline.replaceChildren(
      ...(v.error !== undefined ? [el("p", { class: "map-error" }, v.error)] : []),
      list,
    );
  };

  const drawPicture = (v: DrawnView): void => {
    const defs = svg("defs");
    const marker = svg("marker", {
      id: "map-arrow",
      viewBox: "0 0 10 10",
      refX: 9,
      refY: 5,
      markerWidth: 8,
      markerHeight: 8,
      orient: "auto-start-reverse",
    });
    marker.append(svg("path", { d: "M 0 0 L 10 5 L 0 10 z", class: "map-arrowhead" }));
    defs.append(marker);
    const edges = svg("g");
    // On a grid, a way both directions between two rooms is one line, without arrows.
    const pair = (e: DrawnEdge): string => `${e.from}\u0000${e.to}`;
    const both = new Set(
      v.grid
        ? v.edges.filter((e) => v.edges.some((r) => r.from === e.to && r.to === e.from)).map(pair)
        : [],
    );
    const drawn = new Set<string>();
    const order = new Map(v.nodes.map((n, i) => [n.id, i]));
    for (const e of v.edges) {
      if (e.points.length < 2) continue;
      const twoWay = both.has(pair(e));
      // A pair is drawn once, from the room the reader meets first, so it reads "up / down" from there.
      if (twoWay && (order.get(e.to) ?? 0) < (order.get(e.from) ?? 0)) continue;
      if (twoWay && drawn.has(`${e.to}\u0000${e.from}`)) continue;
      drawn.add(pair(e));
      const d = e.points
        .map((p, i) => `${i === 0 ? "M" : "L"} ${String(p.x)} ${String(p.y)}`)
        .join(" ");
      const path = svg("path", {
        d,
        class: classes(
          "map-edge",
          e.guarded && "guarded",
          e.conditional && "conditional",
          e.bent && "bent",
        ),
        "data-from": e.from,
        "data-to": e.to,
        ...(!twoWay && { "marker-end": "url(#map-arrow)" }),
      });
      const tip = svg("title");
      tip.textContent = `${e.from} → ${e.to}${e.label !== undefined ? `: “${e.label}”` : ""}${qualifiers(e).length > 0 ? ` (${qualifiers(e).join(", ")})` : ""}`;
      path.append(tip);
      edges.append(path);
      // A way that isn't a compass step says which way it is, as "up / down".
      if (v.grid && e.bent) {
        const back = twoWay ? v.edges.find((r) => r.from === e.to && r.to === e.from) : undefined;
        const at =
          e.points.length === 3
            ? e.points[1]
            : {
                x: ((e.points[0]?.x ?? 0) + (e.points.at(-1)?.x ?? 0)) / 2,
                y: ((e.points[0]?.y ?? 0) + (e.points.at(-1)?.y ?? 0)) / 2,
              };
        const label = svg("text", {
          x: at?.x ?? 0,
          y: at?.y ?? 0,
          class: "map-way",
          "text-anchor": "middle",
          "dominant-baseline": "central",
        });
        label.textContent = back ? `${e.kind} / ${back.kind}` : e.kind;
        edges.append(label);
      }
    }
    const nodes = svg("g");
    for (const n of v.nodes) {
      const g = svg("g", {
        class: classes(
          "map-node",
          n.start && "start",
          n.unreachable && "unreachable",
          n.missing && "missing",
        ),
        "data-id": n.id,
        transform: `translate(${String(n.x)} ${String(n.y)})`,
      });
      g.append(svg("rect", { width: n.width, height: n.height, rx: 6 }));
      const label = svg("text", {
        x: n.width / 2,
        y: n.height / 2,
        "dominant-baseline": "central",
        "text-anchor": "middle",
      });
      // The start is marked in words too, not only by its outline.
      label.textContent = n.start ? `▶ ${n.label}` : n.label;
      const tip = svg("title");
      tip.textContent = [n.label, ...marks(n)].join(", ");
      g.append(label, tip);
      g.addEventListener("click", () => {
        choose(n.id, true);
      });
      nodes.append(g);
    }
    picture.replaceChildren(defs, edges, nodes);
  };

  const drawTabs = (): void => {
    tabs.hidden = current.views.length < 2;
    tabs.replaceChildren(
      ...current.views.map((v) => {
        const tab = el(
          "button",
          { type: "button", role: "tab", "aria-selected": String(v.id === viewId) },
          v.title,
        );
        tab.addEventListener("click", () => {
          viewId = v.id;
          selected = undefined;
          render(true);
          options.onView?.(v.id);
        });
        return tab;
      }),
    );
  };

  /** Draws the current view; refits the picture if `refit`, as for a new view. */
  const render = (refit: boolean): void => {
    title.textContent = current.title !== undefined ? `Story map: ${current.title}` : "Story map";
    drawTabs();
    const v = view();
    if (!v) {
      outline.replaceChildren(el("p", {}, "There are no passages yet."));
      picture.replaceChildren();
      return;
    }
    drawOutline(v);
    drawPicture(v);
    if (refit) fitAll();
    if (selected !== undefined && v.nodes.some((n) => n.id === selected)) choose(selected, false);
  };

  // Panning and zooming the picture by mouse, touch, and wheel.
  let drag: { x: number; y: number; box: typeof box } | undefined;
  const scale = (): number => box.w / Math.max(picture.clientWidth, 1);
  picture.addEventListener("pointerdown", (event) => {
    if ((event.target as Element).closest(".map-node")) return;
    drag = { x: event.clientX, y: event.clientY, box };
    picture.setPointerCapture?.(event.pointerId);
  });
  picture.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const s = scale();
    setBox({
      ...drag.box,
      x: drag.box.x - (event.clientX - drag.x) * s,
      y: drag.box.y - (event.clientY - drag.y) * s,
    });
  });
  const stop = (): void => {
    drag = undefined;
  };
  picture.addEventListener("pointerup", stop);
  picture.addEventListener("pointercancel", stop);
  picture.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const rect = picture.getBoundingClientRect();
      const s = scale();
      zoom(
        event.deltaY > 0 ? 1.15 : 1 / 1.15,
        box.x + (event.clientX - rect.left) * s,
        box.y + (event.clientY - rect.top) * s,
      );
    },
    { passive: false },
  );
  zoomIn.addEventListener("click", () => {
    zoom(1 / 1.25);
  });
  zoomOut.addEventListener("click", () => {
    zoom(1.25);
  });
  fit.addEventListener("click", fitAll);

  render(true);

  return {
    update(next) {
      // Keep focus where it was, on the same place's heading or button, when the outline is redrawn.
      const active = document.activeElement;
      const focusedHeading =
        active instanceof HTMLElement && active.closest(".map-outline") ? active : undefined;
      const focusKey = focusedHeading?.id || focusedHeading?.getAttribute("data-go");
      const before = view()?.nodes.length;
      current = next;
      if (!current.views.some((v) => v.id === viewId)) viewId = current.views[0]?.id ?? "";
      render(false);
      if (focusKey) {
        const again =
          outline.querySelector<HTMLElement>(`[id="${focusKey}"]`) ??
          outline.querySelector<HTMLElement>(`[data-go="${CSS.escape(focusKey)}"]`);
        again?.focus();
      }
      const after = view()?.nodes.length;
      status.textContent = `Map updated${after !== before ? `: ${String(after ?? 0)} places` : ""}.`;
    },
    select(id) {
      choose(id, true);
    },
    destroy() {
      style.remove();
      root.remove();
    },
  };
}
