// @vitest-environment jsdom
import {
  action,
  createEventRecord,
  createStore,
  createStory,
  menuLink,
  object,
} from "@loominate-if/core";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import { layouts, widgets } from "./layout.js";
import { mountPage, type ActionMove } from "./page.js";
import { menuWidget } from "./things.js";

const bell = object("menu-bell", { name: "brass bell", rung: 0, polished: false });
const ring = action<{ thing: typeof bell }>("ring", {
  on: bell,
  label: "Ring the bell",
  run: ({ thing }) => {
    thing.rung += 1;
  },
  report: "Ding!",
});
const polish = action<{ thing: typeof bell }>("polish", {
  on: bell,
  label: "Polish the bell",
  check: () => "You have no cloth.",
});
const hide = action<{ thing: typeof bell }>("hide", {
  for: (t) => t.id === bell.id,
  label: "Hide the bell",
  verify: () => "There's nowhere to hide it.",
});

function play() {
  const store = createStore();
  const record = createEventRecord(store);
  const story = createStory(
    store,
    record,
    [
      {
        id: "Hall",
        tags: [],
        body: () => [
          {
            type: "text",
            text: "A brass bell hangs here.",
            links: [
              {
                type: "link",
                label: "brass bell",
                target: "brass bell",
                guard: menuLink({ thing: bell }),
                start: 2,
                end: 12,
              },
            ],
          },
        ],
      },
    ],
    { start: "Hall" },
  );
  document.body.replaceChildren();
  const container = document.createElement("div");
  document.body.append(container);
  const moves: ActionMove[] = [];
  mountPage(
    container,
    { story, record },
    {
      onMove: (m) => {
        if (m.type === "action") moves.push(m);
      },
    },
  );
  const name = () => container.querySelector<HTMLButtonElement>(".loominate-menu-link");
  const items = () => [...container.querySelectorAll<HTMLElement>("[role=menuitem]")];
  const key = (k: string) => {
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  };
  return { container, story, moves, name, items, key };
}

describe("a thing's menu", () => {
  it("opens from its name, listing what's offered, and the keyboard moves through it", async () => {
    const { container, name, items, key } = play();
    expect(name()?.getAttribute("aria-haspopup")).toBe("menu");
    expect(name()?.getAttribute("aria-expanded")).toBe("false");
    name()?.click();
    expect(name()?.getAttribute("aria-expanded")).toBe("true");
    expect(items().map((i) => [i.textContent, i.getAttribute("aria-disabled")])).toEqual([
      ["Ring the bell", null],
      ["Polish the bell", "true"],
    ]);
    const why = document.getElementById(items()[1]?.getAttribute("aria-describedby") ?? "");
    expect(why?.textContent).toBe("You have no cloth.");
    expect(document.activeElement).toBe(items()[0]);
    key("ArrowDown");
    expect(document.activeElement).toBe(items()[1]);
    key("ArrowDown");
    expect(document.activeElement).toBe(items()[0]);
    key("End");
    expect(document.activeElement).toBe(items()[1]);
    const results = await axe.run(container, { rules: { region: { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
    key("Escape");
    expect(items()).toEqual([]);
    expect(document.activeElement).toBe(name());
  });

  it("takes the chosen action as a move, staying on the passage", () => {
    const { container, story, moves, name, items } = play();
    name()?.click();
    items()[0]?.click();
    expect(items()).toEqual([]);
    expect(bell.rung).toBe(1);
    expect(story.current).toBe("Hall");
    expect(story.actions.map((a) => a.type)).toEqual(["act"]);
    expect(moves).toEqual([{ type: "action", label: "Ring the bell" }]);
    expect(container.querySelector(".loominate-notice")?.textContent).toBe("Ding!");
  });

  it("opens aligned to its name's right edge when it would run past the page's (#399)", () => {
    const { name } = play();
    const menuRight = { value: 600 };
    // jsdom lays nothing out: a page 500px wide, and a menu ending where it's told.
    const rect = (left: number, right: number) =>
      ({ left, right, width: right - left, top: 0, bottom: 0, height: 0 }) as DOMRect;
    const spy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.classList.contains("loominate-page")) return rect(0, 500);
        if (this.classList.contains("loominate-menu"))
          return rect(menuRight.value - 200, menuRight.value);
        return rect(0, 0);
      });
    try {
      name()?.click();
      const menu = () => document.querySelector(".loominate-menu");
      expect(menu()?.classList.contains("loominate-menu-end")).toBe(true);
      document.body.click();
      menuRight.value = 300;
      name()?.click();
      expect(menu()?.classList.contains("loominate-menu-end")).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("closes on a click elsewhere, and a disabled item does nothing", () => {
    const { story, name, items } = play();
    name()?.click();
    items()[1]?.click();
    expect(story.actions).toEqual([]);
    document.body.click();
    expect(items()).toEqual([]);
  });
});

describe("a menu widget", () => {
  it("opens a menu of the choices it's given, with their own labels, and takes one", () => {
    widgets.register(
      "bell-menu",
      menuWidget({
        label: () => "Bell",
        choices: () => [
          { call: ring({ thing: bell }), label: "Give it a ring" },
          { call: polish({ thing: bell }) },
          { call: hide({ thing: bell }) },
        ],
      }),
    );
    const page = layouts.get("page");
    if (!page) throw new Error("no page layout");
    layouts.replace("page", { ...page, widgets: { header: ["bell-menu"] } });
    try {
      const { container, moves, items } = play();
      const button = container.querySelector<HTMLButtonElement>(".loominate-menu-widget button");
      expect(button?.textContent).toBe("Bell");
      expect(button?.getAttribute("aria-haspopup")).toBe("menu");
      button?.click();
      expect(items().map((i) => [i.textContent, i.getAttribute("aria-disabled")])).toEqual([
        ["Give it a ring", null],
        ["Polish the bell", "true"],
      ]);
      items()[0]?.click();
      expect(moves.at(-1)).toEqual({ type: "action", label: "Give it a ring" });
    } finally {
      layouts.replace("page", page);
    }
  });
});
