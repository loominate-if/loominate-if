// @vitest-environment jsdom
/** The auto-map widget (#394). */
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import { automapWidget, type AutomapView } from "./automap.js";
import type { WidgetHost } from "./layout.js";

let unmount: (() => void) | undefined;
afterEach(() => {
  unmount?.();
  unmount = undefined;
  document.body.replaceChildren();
});

const VIEW: AutomapView = {
  summary: "Map: you're in the taproom. Visited nearby: the kitchen to the east.",
  rooms: [
    { id: "taproom", label: "taproom", x: 2, y: 1, current: true },
    { id: "kitchen", label: "kitchen", x: 3, y: 1 },
    { id: "landing", label: "landing", x: 3, y: 0 },
    // Just past the window's edge: its way runs off the map, but it isn't drawn.
    { id: "yard", label: "yard", x: 5, y: 1 },
  ],
  links: [
    { from: "taproom", to: "kitchen" },
    { from: "taproom", to: "landing", label: "Up" },
    { from: "kitchen", to: "yard", oneWay: true },
  ],
};

function mount(view: AutomapView | undefined) {
  const sizes: { columns: number; rows: number }[] = [];
  const definition = automapWidget({
    rooms: (_game, size) => {
      sizes.push(size);
      return view;
    },
  });
  const element = document.createElement("div");
  document.body.append(element);
  const shown = definition.view.mount(element, definition.data({} as never), {} as WidgetHost);
  unmount = shown.unmount;
  return { element, sizes };
}

describe("an auto-map", () => {
  it("asks for a 5 by 3 window, and draws the rooms in it, the player's marked", () => {
    const { element, sizes } = mount(VIEW);
    expect(sizes).toEqual([{ columns: 5, rows: 3 }]);
    expect(element.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 320 120");
    const rooms = [...element.querySelectorAll(".loominate-automap-room")];
    expect(rooms.map((r) => r.getAttribute("data-room"))).toEqual([
      "taproom",
      "kitchen",
      "landing",
    ]);
    expect(element.querySelector(".loominate-automap-current")?.getAttribute("data-room")).toBe(
      "taproom",
    );
  });

  it("draws ways as lines: one-way with an arrow, and the rest named", () => {
    const { element } = mount(VIEW);
    const links = [...element.querySelectorAll("[data-from]")];
    expect(
      links.map((l) => [
        l.getAttribute("data-to"),
        l.querySelector("line")?.getAttribute("marker-end") ?? null,
      ]),
    ).toEqual([
      ["kitchen", null],
      ["landing", null],
      ["yard", "url(#loominate-automap-arrow)"],
    ]);
    expect(element.querySelector(".loominate-automap-way")?.textContent).toBe("Up");
  });

  it("is one image for a screen reader, with a summary", async () => {
    const { element } = mount(VIEW);
    const figure = element.querySelector("figure");
    expect(figure?.getAttribute("role")).toBe("img");
    expect(figure?.getAttribute("aria-label")).toBe(VIEW.summary);
    expect(element.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    const results = await axe.run(document.body, { rules: { region: { enabled: false } } });
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });

  it("says so when the player isn't on the map", () => {
    const { element } = mount(undefined);
    expect(element.textContent).toBe("Nowhere on the map.");
    expect(element.querySelector("svg")).toBeNull();
  });
});
