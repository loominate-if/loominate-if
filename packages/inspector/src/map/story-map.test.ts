// @vitest-environment jsdom
/** The story map viewer (#149). */
import { userEvent } from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountStoryMap, type DrawnNode, type MapDrawing } from "./story-map.js";

const node = (id: string, x: number, extra: Partial<DrawnNode> = {}): DrawnNode => ({
  id,
  label: id,
  x,
  y: 0,
  width: 80,
  height: 30,
  tags: [],
  source: { file: "/game/story.weft", line: 1, column: 4 },
  ...extra,
});

const MAP: MapDrawing = {
  title: "The Lamp Room",
  views: [
    {
      id: "passages",
      title: "Passages",
      width: 400,
      height: 100,
      nodes: [
        node("Hall", 0, { start: true, tags: ["scene"] }),
        node("Cellar", 120),
        node("Attic", 240, { unreachable: true }),
        {
          id: "Landing",
          label: "Landing",
          x: 360,
          y: 0,
          width: 80,
          height: 30,
          tags: [],
          missing: true,
        },
      ],
      edges: [
        {
          from: "Hall",
          to: "Cellar",
          kind: "link",
          label: "Go down",
          guarded: true,
          source: { file: "/game/story.weft", line: 3, column: 1 },
          points: [
            { x: 80, y: 15 },
            { x: 120, y: 15 },
          ],
        },
        {
          from: "Cellar",
          to: "Hall",
          kind: "continue",
          source: { file: "/game/story.weft", line: 7, column: 1 },
          points: [
            { x: 120, y: 20 },
            { x: 80, y: 20 },
          ],
        },
        {
          from: "Hall",
          to: "Landing",
          kind: "link",
          conditional: true,
          source: { file: "/game/story.weft", line: 4, column: 1 },
          points: [
            { x: 80, y: 10 },
            { x: 360, y: 10 },
          ],
        },
      ],
    },
  ],
};

afterEach(() => {
  document.body.replaceChildren();
});

/** The outline entry for a place. */
const place = (id: string) => document.querySelector<HTMLElement>(`.map-place[data-id="${id}"]`);

describe("the story map viewer", () => {
  it("outlines each place, with what it leads to and is reached from", () => {
    mountStoryMap(document.body, MAP);
    expect(document.querySelector("h1")?.textContent).toBe("Story map: The Lamp Room");
    expect([...document.querySelectorAll(".map-place h2")].map((h) => h.textContent)).toEqual([
      "Hall (start)",
      "Cellar",
      "Attic (unreachable)",
      "Landing (missing: nothing has this name)",
    ]);
    const hall = place("Hall");
    expect(hall?.querySelector('[aria-label="Leads to"]')?.textContent).toBe(
      "Cellar: “Go down” (guarded)Landing (sometimes)",
    );
    expect(hall?.querySelector('[aria-label="Reached from"]')?.textContent).toBe(
      "Cellar (by continue)",
    );
    expect(place("Attic")?.textContent).toContain("Reached from: nothing.");
    expect(hall?.textContent).toContain("Tags: scene");
    expect(hall?.textContent).toContain("story.weft, line 1");
  });

  it("follows a way by keyboard, moving focus and the picture to the place", async () => {
    mountStoryMap(document.body, MAP);
    const user = userEvent.setup();
    const go = place("Hall")?.querySelector<HTMLButtonElement>('[data-go="Cellar"]');
    go?.focus();
    await user.keyboard("{Enter}");
    expect(document.activeElement?.textContent).toBe("Cellar");
    expect(place("Cellar")?.classList.contains("selected")).toBe(true);
    expect(
      document.querySelector('.map-node[data-id="Cellar"]')?.classList.contains("selected"),
    ).toBe(true);
    // The picture is centred on the place: its middle is the viewBox's middle.
    const [x, y, w, h] = (document.querySelector("svg")?.getAttribute("viewBox") ?? "")
      .split(" ")
      .map(Number);
    expect([(x ?? 0) + (w ?? 0) / 2, (y ?? 0) + (h ?? 0) / 2]).toEqual([160, 15]);
  });

  it("draws the picture for the eye only, marking guarded and conditional ways", () => {
    mountStoryMap(document.body, MAP);
    expect(document.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect([...document.querySelectorAll(".map-edge")].map((e) => e.getAttribute("class"))).toEqual(
      ["map-edge guarded", "map-edge", "map-edge conditional"],
    );
    expect(document.querySelector('.map-node[data-id="Landing"]')?.getAttribute("class")).toBe(
      "map-node missing",
    );
  });

  it("opens a place's source when it can, and says where it is when it can't", async () => {
    const open = vi.fn();
    mountStoryMap(document.body, MAP, { open });
    const user = userEvent.setup();
    const button = place("Cellar")?.querySelector<HTMLButtonElement>(".map-open");
    expect(button?.textContent).toBe("Open story.weft, line 1");
    if (button) await user.click(button);
    expect(open).toHaveBeenCalledWith({ file: "/game/story.weft", line: 1, column: 4 });
    expect(place("Landing")?.querySelector(".map-open")).toBeNull();
  });

  it("keeps focus and says so when the map is updated", () => {
    const map = mountStoryMap(document.body, MAP);
    map.select("Cellar");
    const [view] = MAP.views;
    if (!view) throw new Error("no view");
    map.update({ ...MAP, views: [{ ...view, nodes: [...view.nodes, node("Yard", 480)] }] });
    expect(document.activeElement?.textContent).toBe("Cellar");
    expect(place("Cellar")?.classList.contains("selected")).toBe(true);
    expect(document.querySelector('[role="status"]')?.textContent).toBe("Map updated: 5 places.");
  });

  it("offers views as tabs when there are more than one", async () => {
    const [view] = MAP.views;
    if (!view) throw new Error("no view");
    mountStoryMap(document.body, {
      views: [
        view,
        {
          id: "rooms",
          title: "Rooms",
          width: 100,
          height: 50,
          nodes: [node("hall", 0)],
          edges: [],
        },
      ],
    });
    const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.map((t) => [t.textContent, t.getAttribute("aria-selected")])).toEqual([
      ["Passages", "true"],
      ["Rooms", "false"],
    ]);
    await userEvent.setup().click(tabs[1] as HTMLButtonElement);
    expect(document.querySelector("nav")?.getAttribute("aria-label")).toBe("Rooms");
  });

  it("has no accessibility problems axe can find", async () => {
    mountStoryMap(document.body, MAP, { open: () => undefined });
    const results = await axe.run(document.body, { rules: { region: { enabled: false } } });
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });

  describe("on a grid, as rooms", () => {
    const cell = (
      id: string,
      label: string,
      x: number,
      y: number,
      extra: Partial<DrawnNode> = {},
    ): DrawnNode => ({
      id,
      label,
      x: x * 150,
      y: y * 100,
      width: 100,
      height: 36,
      tags: [],
      ...extra,
    });
    const line = {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    };
    const ROOMS: MapDrawing = {
      views: [
        {
          id: "rooms",
          title: "Rooms",
          width: 300,
          height: 200,
          grid: true,
          nodes: [
            cell("hall", "great hall", 0, 0, { start: true }),
            cell("library", "library", 0, -1),
            cell("cellar", "cellar", 1, 0),
          ],
          edges: [
            { from: "hall", to: "library", kind: "north", label: "North", ...line },
            { from: "library", to: "hall", kind: "south", label: "South", ...line },
            {
              from: "cellar",
              to: "hall",
              kind: "up",
              label: "Up, through the trapdoor",
              guarded: true,
              bent: true,
              ...line,
            },
          ],
        },
      ],
    };

    it("lists exits by their direction, and only one-way ways in", () => {
      mountStoryMap(document.body, ROOMS);
      const hall = place("hall");
      expect(hall?.querySelector('[aria-label="Exits"]')?.textContent).toBe("North: library");
      expect(hall?.querySelector('[aria-label="One-way in from"]')?.textContent).toBe(
        "cellar, by its Up, through the trapdoor exit",
      );
      expect(place("library")?.querySelector('[aria-label="One-way in from"]')).toBeNull();
    });

    it("draws a way both directions as one line without arrows", () => {
      mountStoryMap(document.body, ROOMS);
      const edges = [...document.querySelectorAll(".map-edge")];
      expect(edges.map((e) => [e.getAttribute("data-from"), e.getAttribute("marker-end")])).toEqual(
        [
          ["hall", null],
          ["cellar", "url(#map-arrow)"],
        ],
      );
      expect(edges[1]?.getAttribute("class")).toBe("map-edge guarded bent");
    });

    it("says why a view couldn't be made", () => {
      const [rooms] = ROOMS.views;
      if (!rooms) throw new Error("no view");
      mountStoryMap(document.body, { views: [{ ...rooms, error: "The game couldn't begin." }] });
      expect(document.querySelector(".map-error")?.textContent).toBe("The game couldn't begin.");
    });

    it("opens on the view it's asked for, and says when the reader chooses another", async () => {
      const [rooms] = ROOMS.views;
      const [passages] = MAP.views;
      if (!rooms || !passages) throw new Error("no view");
      const chosen = vi.fn();
      mountStoryMap(document.body, { views: [passages, rooms] }, { view: "rooms", onView: chosen });
      expect(document.querySelector("nav")?.getAttribute("aria-label")).toBe("Rooms");
      const tab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
        (t) => t.textContent === "Passages",
      );
      if (tab) await userEvent.setup().click(tab);
      expect(chosen).toHaveBeenCalledWith("passages");
    });
  });
});
