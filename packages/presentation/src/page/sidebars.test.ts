// @vitest-environment jsdom
/** Sidebars, and how they collapse into drawers on narrow screens (#39). */
import { createEventRecord, createStore, createStory, type Passage } from "@loominate-if/core";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { display, layouts, widgets } from "./layout.js";
import { mountPage, type PageOptions } from "./page.js";

const passages: Passage[] = [
  {
    id: "Market",
    tags: [],
    body: () => [
      { type: "text", text: "Stalls and shouting." },
      { type: "link", label: "Haggle", target: "Market" },
    ],
  },
];

/** A stand-in for the browser's media query, which jsdom lacks. */
function screen(narrow: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: narrow,
    addEventListener: (_: string, f: () => void) => listeners.add(f),
    removeEventListener: (_: string, f: () => void) => listeners.delete(f),
  };
  const matchMedia = vi.fn(() => query);
  vi.stubGlobal("matchMedia", matchMedia);
  return {
    matchMedia,
    listeners,
    resize(to: boolean) {
      query.matches = to;
      for (const f of listeners) f();
    },
  };
}

const text = (name: string) => ({
  data: () => name,
  view: {
    mount: (element: HTMLElement, data: string) => {
      element.textContent = data;
      return { update: () => undefined, unmount: () => undefined };
    },
  },
});

const cleanup: (() => void)[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  for (const undo of cleanup.splice(0).reverse()) undo();
  display.layout = "page";
});

function play(options: PageOptions = {}) {
  widgets.register("map", text("A map"));
  widgets.register("purse", text("12 coins"));
  layouts.register("market", {
    regions: ["header", "map", "main", "inventory", "footer"],
    sidebars: { map: "start", inventory: "end" },
    widgets: { header: ["status-line"], map: ["map"], inventory: ["purse"] },
  });
  cleanup.push(() => {
    layouts.remove("market");
    widgets.remove("map");
    widgets.remove("purse");
  });
  const store = createStore();
  const record = createEventRecord(store);
  const story = createStory(store, record, passages, { start: "Market" });
  display.layout = "market";
  document.documentElement.lang = "en";
  document.title = "Market";
  document.body.replaceChildren();
  const container = document.createElement("div");
  document.body.append(container);
  const page = mountPage(container, { story, record }, options);
  const root = page.element;
  const toggle = (region: string) =>
    root.querySelector<HTMLButtonElement>(`[data-region="${region}"] .loominate-sidebar-toggle`);
  const panel = (region: string) =>
    root.querySelector<HTMLElement>(`[data-region="${region}"] .loominate-sidebar-panel`);
  const state = (region: string) => ({
    toggle: toggle(region)?.hidden
      ? "hidden"
      : (toggle(region)?.getAttribute("aria-expanded") ?? ""),
    panel: panel(region)?.hidden ? "hidden" : (panel(region)?.textContent ?? ""),
  });
  return { root, page, toggle, panel, state };
}

describe("sidebars", () => {
  it("sit beside main on wide screens, in visual order", () => {
    screen(false);
    const { root, state } = play();
    const shape = [...root.children].map((c) =>
      c.classList.contains("loominate-columns")
        ? [...c.children].map((r) => (r as HTMLElement).dataset.region)
        : (c as HTMLElement).dataset.region,
    );
    expect(shape).toEqual(["header", ["map", "main", "inventory"], "footer"]);
    expect(root.dataset.sidebars).toBe("start end");
    expect(root.hasAttribute("data-narrow")).toBe(false);
    expect(state("map")).toEqual({ toggle: "hidden", panel: "A map" });
    expect(state("inventory")).toEqual({ toggle: "hidden", panel: "12 coins" });
  });

  it("collapse into closed drawers on narrow screens, which the player opens", () => {
    screen(true);
    const { root, toggle, state } = play();
    expect(root.hasAttribute("data-narrow")).toBe(true);
    expect(state("map")).toEqual({ toggle: "false", panel: "hidden" });
    expect(toggle("map")?.textContent).toBe("Map");
    expect(toggle("inventory")?.textContent).toBe("Inventory");
    const panelId = toggle("map")?.getAttribute("aria-controls") ?? "";
    expect(document.getElementById(panelId)?.textContent).toBe("A map");
    toggle("map")?.click();
    expect(state("map")).toEqual({ toggle: "true", panel: "A map" });
    expect(state("inventory")).toEqual({ toggle: "false", panel: "hidden" });
  });

  it("stay open across moves, and follow the screen as it changes", () => {
    const media = screen(true);
    const { root, page, toggle, state } = play();
    toggle("inventory")?.click();
    [...root.querySelectorAll("button")].find((b) => b.textContent === "Haggle")?.click();
    expect(state("inventory")).toEqual({ toggle: "true", panel: "12 coins" });
    media.resize(false);
    expect(root.hasAttribute("data-narrow")).toBe(false);
    expect(state("map")).toEqual({ toggle: "hidden", panel: "A map" });
    media.resize(true);
    expect(state("map")).toEqual({ toggle: "false", panel: "hidden" });
    expect(state("inventory")).toEqual({ toggle: "true", panel: "12 coins" });
    page.destroy();
    expect(media.listeners.size).toBe(0);
  });

  it("use the game's own narrow-screen query", () => {
    const media = screen(false);
    play({ narrow: "(max-width: 60rem)" });
    expect(media.matchMedia).toHaveBeenCalledWith("(max-width: 60rem)");
  });

  it("only count when they have widgets", () => {
    screen(false);
    layouts.register("bare", { regions: ["main", "notes"], sidebars: { notes: "end" } });
    cleanup.push(() => {
      layouts.remove("bare");
    });
    const { root, page } = play();
    display.layout = "bare";
    page.refresh();
    expect(root.dataset.sidebars).toBeUndefined();
    expect(root.querySelector<HTMLElement>('[data-region="notes"]')?.hidden).toBe(true);
  });

  it("are checked against the layout's regions", () => {
    screen(false);
    const { page } = play();
    const tryLayout = (sidebars: Record<string, string>) => {
      layouts.register("odd", {
        regions: ["main", "notes"],
        sidebars: sidebars as Record<string, "start">,
      });
      display.layout = "odd";
      try {
        page.refresh();
      } finally {
        layouts.remove("odd");
        display.layout = "market";
      }
    };
    expect(() => {
      tryLayout({ map: "start" });
    }).toThrow('The layout "odd" makes "map" a sidebar, but it isn\'t one of its regions.');
    expect(() => {
      tryLayout({ main: "start" });
    }).toThrow('The layout "odd" makes "main" a sidebar. Only other regions can be sidebars.');
    expect(() => {
      tryLayout({ notes: "left" });
    }).toThrow('The layout "odd" puts the sidebar "notes" at "left". Use "start" or "end".');
  });

  it("pass automated accessibility checks, wide and narrow, open and closed", async () => {
    const check = async () => {
      const results = await axe.run(document, { rules: { "color-contrast": { enabled: false } } });
      return results.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html}`));
    };
    screen(false);
    play();
    expect(await check()).toEqual([]);
    vi.unstubAllGlobals();
    cleanup.splice(0).forEach((undo) => {
      undo();
    });
    screen(true);
    const { toggle } = play();
    expect(await check()).toEqual([]);
    toggle("map")?.click();
    expect(await check()).toEqual([]);
  });
});
