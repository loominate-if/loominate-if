// @vitest-environment jsdom
/** The auto-map widget (#394). */
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import { _roomToward, automapWidget, type AutomapFullMap, type AutomapView } from "./automap.js";
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

function mount(view: AutomapView | undefined, full?: AutomapFullMap) {
  const sizes: { columns: number; rows: number }[] = [];
  const definition = automapWidget({
    rooms: (_game, size) => {
      sizes.push(size);
      return view;
    },
    ...(full && { full: () => full }),
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

/** The whole map: the taproom with the kitchen east, the landing up a stair, and the bedroom past it. */
const FULL: AutomapFullMap = {
  columns: 3,
  rows: 2,
  view: {
    summary: VIEW.summary,
    rooms: [
      {
        id: "taproom",
        label: "taproom",
        x: 0,
        y: 1,
        current: true,
        ways: [
          { label: "East: the kitchen", to: "kitchen" },
          { label: "Up: the landing", to: "landing" },
          { label: "Out: not explored" },
        ],
      },
      {
        id: "kitchen",
        label: "kitchen",
        x: 1,
        y: 1,
        ways: [{ label: "West: the taproom", to: "taproom" }],
      },
      {
        id: "landing",
        label: "landing",
        x: 1,
        y: 0,
        ways: [
          { label: "Down: the taproom", to: "taproom" },
          { label: "East: the bedroom", to: "bedroom" },
        ],
      },
      {
        id: "bedroom",
        label: "the innkeeper's bedroom",
        x: 2,
        y: 0,
        ways: [{ label: "West: the landing", to: "landing" }],
      },
    ],
    links: [
      { from: "taproom", to: "kitchen" },
      { from: "taproom", to: "landing", label: "Up / Down" },
      { from: "landing", to: "bedroom" },
    ],
  },
};

const key = (target: Element, name: string): void => {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
  );
};
const focusedRoom = (): string | undefined =>
  (document.activeElement as HTMLElement | null)?.dataset.room;

describe("the full map (#395)", () => {
  it("is opened by the small map, a button that says what the picture shows", () => {
    const { element } = mount(VIEW, FULL);
    const open = element.querySelector<HTMLButtonElement>("button.loominate-automap-open");
    expect(open?.getAttribute("aria-label")).toBe(VIEW.summary);
    expect(open?.getAttribute("aria-haspopup")).toBe("dialog");
    expect(element.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    const dialog = element.querySelector("dialog");
    expect(dialog?.open).toBe(false);
    open?.click();
    expect(dialog?.open).toBe(true);
    expect(dialog?.querySelector("h2")?.textContent).toBe("Map");
    expect(document.documentElement.classList.contains("loominate-modal-open")).toBe(true);
  });

  it("puts focus on the player's room, read with its ways out", () => {
    const { element } = mount(VIEW, FULL);
    element.querySelector<HTMLButtonElement>(".loominate-automap-open")?.click();
    expect(focusedRoom()).toBe("taproom");
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "taproom, where you are. East: the kitchen. Up: the landing. Out: not explored.",
    );
    // One room at a time is in the tab order: the one with focus.
    const tabbable = [...element.querySelectorAll("dialog g[tabindex='0']")];
    expect(tabbable.map((g) => g.getAttribute("data-room"))).toEqual(["taproom"]);
  });

  it("moves between rooms on the grid with the arrow keys, and Home goes back", () => {
    const { element } = mount(VIEW, FULL);
    element.querySelector<HTMLButtonElement>(".loominate-automap-open")?.click();
    key(document.activeElement as Element, "ArrowRight");
    expect(focusedRoom()).toBe("kitchen");
    key(document.activeElement as Element, "ArrowUp");
    expect(focusedRoom()).toBe("landing");
    key(document.activeElement as Element, "ArrowRight");
    expect(focusedRoom()).toBe("bedroom");
    // Nothing further east: focus stays.
    key(document.activeElement as Element, "ArrowRight");
    expect(focusedRoom()).toBe("bedroom");
    key(document.activeElement as Element, "Home");
    expect(focusedRoom()).toBe("taproom");
    // Up from the taproom: the landing, up and to the right, is within 45 degrees.
    key(document.activeElement as Element, "ArrowUp");
    expect(focusedRoom()).toBe("landing");
  });

  it("shows a room's full name in a tooltip on focus and hover, as its box may shorten it", () => {
    const { element } = mount(VIEW, FULL);
    element.querySelector<HTMLButtonElement>(".loominate-automap-open")?.click();
    const bedroom = element.querySelector("dialog g[data-room='bedroom']");
    expect(bedroom?.querySelector("text")?.textContent).toBe("the innkeeper…");
    bedroom?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    bedroom?.dispatchEvent(new MouseEvent("mouseenter"));
    expect(element.querySelector(".loominate-automap-tip")?.textContent).toBe(
      "the innkeeper's bedroom",
    );
    bedroom?.dispatchEvent(new MouseEvent("mouseleave"));
    // Back to the room with focus.
    expect(element.querySelector(".loominate-automap-tip")?.textContent).toBe("taproom");
  });

  it("lists each room with its ways, the player's marked, unexplored ways unnamed", () => {
    const { element } = mount(VIEW, FULL);
    const list = element.querySelector(".loominate-automap-list");
    expect(list?.querySelector("h3")?.textContent).toBe("Rooms");
    const rooms = [...(list?.querySelectorAll(":scope > ul > li") ?? [])].map((li) =>
      [
        li.querySelector("button")?.textContent,
        ...[...li.querySelectorAll("li")].map((w) => w.textContent),
      ].join(" | "),
    );
    expect(rooms).toEqual([
      "taproom | East: the kitchen | Up: the landing | Out: not explored",
      "kitchen | West: the taproom",
      "landing | Down: the taproom | East: the bedroom",
      "the innkeeper's bedroom | West: the landing",
    ]);
    expect(list?.querySelector(".loominate-automap-here")?.textContent).toBe(" (you're here)");
    expect(list?.querySelector(".loominate-automap-unexplored")?.textContent).toBe(
      "Out: not explored",
    );
  });

  it("shows a room on the drawing when it's chosen in the list", () => {
    const { element } = mount(VIEW, FULL);
    element.querySelector<HTMLButtonElement>(".loominate-automap-open")?.click();
    const kitchen = [
      ...element.querySelectorAll<HTMLButtonElement>(".loominate-automap-list button"),
    ].find((b) => b.textContent === "kitchen");
    kitchen?.click();
    expect(focusedRoom()).toBe("kitchen");
  });

  it("closes, and gives focus back to the small map", () => {
    const { element } = mount(VIEW, FULL);
    const open = element.querySelector<HTMLButtonElement>(".loominate-automap-open");
    open?.click();
    const close = [...element.querySelectorAll<HTMLButtonElement>("dialog button")].find(
      (b) => b.textContent === "Close",
    );
    close?.click();
    expect(element.querySelector("dialog")?.open).toBe(false);
    expect(document.activeElement).toBe(open);
    expect(document.documentElement.classList.contains("loominate-modal-open")).toBe(false);
  });

  it("passes axe, open and closed", async () => {
    const { element } = mount(VIEW, FULL);
    const rules = { rules: { region: { enabled: false } } };
    let results = await axe.run(document.body, rules);
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    element.querySelector<HTMLButtonElement>(".loominate-automap-open")?.click();
    results = await axe.run(document.body, rules);
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});

describe("moving on the full map's grid", () => {
  const at = (id: string, x: number, y: number) => ({ id, label: id, x, y });
  const rooms = [at("a", 0, 0), at("b", 2, 0), at("c", 1, 1), at("d", 0, 3)];
  const from = rooms[0] ?? at("a", 0, 0);

  it("goes to the nearest room within 45 degrees, preferring one straight ahead", () => {
    // b is two steps straight ahead; c is one step along and one across, which counts as three.
    expect(_roomToward(rooms, from, [1, 0])?.id).toBe("b");
    expect(_roomToward([at("a", 0, 0), at("b", 2, 0), at("c", 2, 1)], from, [1, 0])?.id).toBe("b");
    // Level, the nearer wins: c, one along and one across, before d, three straight down.
    expect(_roomToward(rooms, from, [0, 1])?.id).toBe("c");
    // A room further across than along isn't that way at all.
    expect(_roomToward([at("a", 0, 0), at("b", 1, 2)], from, [1, 0])).toBeUndefined();
  });

  it("finds nothing where no room is", () => {
    expect(_roomToward(rooms, from, [-1, 0])).toBeUndefined();
    expect(_roomToward(rooms, from, [0, -1])).toBeUndefined();
  });
});

describe("markers and stubs (#396)", () => {
  const marked: AutomapFullMap = {
    columns: 2,
    rows: 1,
    view: {
      summary: VIEW.summary,
      rooms: [
        {
          id: "hall",
          label: "hall",
          x: 0,
          y: 0,
          current: true,
          ways: [{ label: "East: the kitchen", to: "kitchen" }, { label: "Down: not explored" }],
          stubs: [{ x: 1, y: 1, label: "Down" }],
          markers: [
            { label: "Tobias", person: true },
            { label: "key", icon: "icons/key.svg" },
            { label: "chest" },
            { label: "lamp" },
          ],
        },
        { id: "kitchen", label: "kitchen", x: 1, y: 0, ways: [] },
      ],
      links: [{ from: "hall", to: "kitchen" }],
    },
  };

  it("draws a room's markers on its box: icons, marks for people and things, and +1 for the rest", () => {
    const { element } = mount(VIEW, marked);
    const marks = element.querySelector("dialog g[data-room='hall'] .loominate-automap-marks");
    expect(marks?.getAttribute("aria-hidden")).toBe("true");
    expect(marks?.querySelector(".loominate-automap-person")).not.toBeNull();
    expect(marks?.querySelector("image")?.getAttribute("href")).toBe("icons/key.svg");
    expect(marks?.querySelector(".loominate-automap-thing")).not.toBeNull();
    expect(marks?.querySelector(".loominate-automap-more")?.textContent).toBe("+1");
  });

  it("draws a stub toward each way not yet taken, named on the full map", () => {
    const { element } = mount(VIEW, marked);
    const stub = element.querySelector("dialog g[data-room='hall'] .loominate-automap-stub");
    expect(stub?.querySelector("line")).not.toBeNull();
    expect(stub?.textContent).toBe("Down");
  });

  it("names the markers in the room's reading, tooltip, and list", () => {
    const { element } = mount(VIEW, marked);
    element.querySelector<HTMLButtonElement>(".loominate-automap-open")?.click();
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "hall, where you are. East: the kitchen. Down: not explored. Last seen here: Tobias, key, chest, lamp.",
    );
    expect(element.querySelector(".loominate-automap-tip")?.textContent).toBe(
      "hall: Tobias, key, chest, lamp",
    );
    expect(element.querySelector(".loominate-automap-seen")?.textContent).toBe(
      "Last seen here: Tobias, key, chest, lamp.",
    );
  });

  it("passes axe with markers and stubs", async () => {
    const { element } = mount(VIEW, marked);
    element.querySelector<HTMLButtonElement>(".loominate-automap-open")?.click();
    const results = await axe.run(document.body, { rules: { region: { enabled: false } } });
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
