// @vitest-environment jsdom
import {
  createEventRecord,
  createHistory,
  createStore,
  createStory,
  emphasis,
  prose,
  strong,
  type Passage,
  type StateSnapshot,
} from "@loominate-if/core";
import { describe, expect, it, vi } from "vitest";
import { mountPage } from "./page.js";

const passages: Passage[] = [
  {
    id: "Kitchen",
    tags: [],
    body: ({ firstVisit }) => [
      prose([firstVisit ? "The kitchen is " : "Back in the kitchen, ", emphasis("warm"), "."]),
      { type: "link", label: "Take the lantern", target: "Lantern" },
      { type: "link", label: "Go to the stairs", target: "Stairs" },
    ],
  },
  {
    id: "Lantern",
    tags: [],
    effects: { enter: ({ state }) => state.set("lantern", "lit", true) },
    body: () => [
      prose(["You light it. ", strong("Finally", emphasis(" light")), "."]),
      { type: "continue", target: "Kitchen" },
    ],
  },
  {
    id: "Stairs",
    tags: [],
    body: ({ state }) => [
      prose([
        "The steps go down. You could ",
        { type: "link", label: "go back", target: "Kitchen" },
        " or ",
        {
          type: "link",
          label: "feel your way",
          target: "Cellar",
          guard: {
            open: false,
            condition: "never",
            mode: "disabled-with-reason",
            reason: "Too risky.",
          },
        },
        ".",
      ]),
      {
        type: "link",
        label: "Go down",
        target: "Cellar",
        guard: {
          open: state.get("lantern", "lit") === true,
          condition: "lantern.isLit",
          mode: "disabled-with-reason",
          reason: "It's too dark to see the steps.",
        },
      },
    ],
  },
  { id: "Cellar", tags: [], body: () => [{ type: "text", text: "The end." }] },
];

function play(snapshot?: StateSnapshot, onMove?: () => void) {
  const store = createStore(snapshot);
  const record = createEventRecord(store);
  const story = createStory(store, record, passages, { start: "Kitchen" });
  const history = createHistory(store);
  document.body.replaceChildren();
  const container = document.createElement("div");
  document.body.append(container);
  const page = mountPage(
    container,
    { story, record },
    {
      onMove: () => {
        history.checkpoint();
        onMove?.();
      },
    },
  );
  history.checkpoint();
  const main = () => container.querySelector("main") as HTMLElement;
  const drawer = () => container.querySelector("details") as HTMLDetailsElement;
  const click = (label: string) => {
    const b = [...main().querySelectorAll("button")].find((x) => x.textContent === label);
    if (!b) throw new Error(`no button "${label}"`);
    b.click();
  };
  const turns = () =>
    [...drawer().querySelectorAll("section")].map((s) =>
      [...s.querySelectorAll("p")].map((p) => p.textContent),
    );
  return { store, story, history, page, main, drawer, click, turns };
}

describe("the page", () => {
  it("shows the current passage: prose with its styles, links, and continue points", () => {
    const { main, click } = play();
    expect(main().getAttribute("aria-live")).toBe("polite");
    expect(main().querySelector("p")?.innerHTML).toBe("The kitchen is <em>warm</em>.");
    expect([...main().querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "Take the lantern",
      "Go to the stairs",
    ]);
    click("Take the lantern");
    expect(main().querySelector("p")?.innerHTML).toBe(
      "You light it. <strong>Finally<em> light</em></strong>.",
    );
    expect(main().querySelector("button.loominate-continue")?.textContent).toBe("Continue");
  });

  it("replaces the main view on each move, focuses it, and reports the move", () => {
    const moved = vi.fn();
    const { main, click } = play(undefined, moved);
    click("Go to the stairs");
    expect(main().textContent).toContain("The steps go down.");
    expect(main().textContent).not.toContain("kitchen");
    expect(document.activeElement).toBe(main());
    expect(moved).toHaveBeenCalledTimes(1);
  });

  it("shows disabled links with their reasons, for sight and for screen readers", () => {
    const { main, click } = play();
    click("Go to the stairs");
    const down = [...main().querySelectorAll("button")].find((b) => b.textContent === "Go down");
    expect(down?.disabled).toBe(true);
    const reason = document.getElementById(down?.getAttribute("aria-describedby") ?? "");
    expect(reason?.textContent).toBe("It's too dark to see the steps.");
  });

  it("puts inline links in their sentence, and follows them", () => {
    const { main, click } = play();
    click("Go to the stairs");
    const paragraph = main().querySelector("p");
    expect(paragraph?.textContent).toBe("The steps go down. You could go back or feel your way.");
    const inline = paragraph?.querySelectorAll<HTMLButtonElement>("button.loominate-inline");
    expect([...(inline ?? [])].map((b) => [b.textContent, b.disabled])).toEqual([
      ["go back", false],
      ["feel your way", true],
    ]);
    expect(main().querySelector(".loominate-note")?.textContent).toBe("Too risky.");
    click("go back");
    expect(main().textContent).toContain("Back in the kitchen");
  });
});

describe("the story-so-far drawer", () => {
  it("shows earlier moves from the event record, not the one on screen", () => {
    const { drawer, click, turns } = play();
    expect(drawer().hidden).toBe(true);
    click("Take the lantern");
    click("Continue");
    expect(drawer().hidden).toBe(false);
    expect(drawer().querySelector("summary")?.textContent).toBe("Story so far");
    expect(turns()).toEqual([["The kitchen is warm."], ["You light it. Finally light."]]);
    expect(drawer().querySelector("strong")?.textContent).toBe("Finally light");
  });

  it("follows the record through undo, and after loading", () => {
    const { store, history, page, click, turns, main } = play();
    click("Take the lantern");
    click("Continue");
    drawerOpen(page.element);
    history.undo();
    page.refresh();
    expect(main().textContent).toContain("You light it.");
    expect(turns()).toEqual([["The kitchen is warm."]]);
    expect(page.element.querySelector("details")?.open).toBe(true);

    // A page over a loaded game shows the story so far from its record.
    click("Continue");
    const loaded = play(store.snapshot());
    expect(loaded.turns()).toEqual([["The kitchen is warm."], ["You light it. Finally light."]]);
    expect(loaded.main().textContent).toContain("Back in the kitchen");
  });

  it("goes away with the page", () => {
    const { page } = play();
    page.destroy();
    expect(document.querySelector(".loominate-page")).toBeNull();
  });
});

function drawerOpen(root: HTMLElement): void {
  const details = root.querySelector("details");
  if (details) details.open = true;
}
