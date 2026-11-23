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
    effects: {
      enter: ({ state, emit }) => {
        state.set("lantern", "lit", true);
        emit("perception", { text: "Something skitters away.", sense: "hear" });
      },
    },
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
  const main = () => container.querySelector(".loominate-passage") as HTMLElement;
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
    expect(main().querySelector("p:not(.loominate-notice)")?.innerHTML).toBe(
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
    expect(down?.getAttribute("aria-disabled")).toBe("true");
    expect(down?.disabled).toBe(false);
    const reason = document.getElementById(down?.getAttribute("aria-describedby") ?? "");
    expect(reason?.textContent).toBe("It's too dark to see the steps.");
  });

  it("puts inline links in their sentence, and follows them", () => {
    const { main, click } = play();
    click("Go to the stairs");
    const paragraph = main().querySelector("p");
    // What reads on screen: the reason is a tooltip, hidden until it's wanted.
    const visible = paragraph?.cloneNode(true) as HTMLElement;
    for (const t of visible.querySelectorAll(".loominate-tooltip")) t.remove();
    expect(visible.textContent).toBe("The steps go down. You could go back or feel your way.");
    const inline = paragraph?.querySelectorAll<HTMLButtonElement>("button.loominate-inline");
    expect([...(inline ?? [])].map((b) => [b.textContent, b.ariaDisabled])).toEqual([
      ["go back", null],
      ["feel your way", "true"],
    ]);
    const feel = [...(inline ?? [])].at(-1);
    const tooltip = document.getElementById(feel?.getAttribute("aria-describedby") ?? "");
    expect(tooltip?.textContent).toBe("Too risky.");
    expect(tooltip?.getAttribute("role")).toBe("tooltip");
    expect(main().querySelector(".loominate-note")).toBeNull();
    click("go back");
    expect(main().textContent).toContain("Back in the kitchen");
  });
});

describe("a disabled link's reason", () => {
  it("is a tooltip, shown on a tap and hidden by Escape or a tap elsewhere", () => {
    const { main, click } = play();
    click("Go to the stairs");
    const down = [...main().querySelectorAll("button")].find((b) => b.textContent === "Go down");
    const holder = down?.closest(".loominate-has-reason");
    expect(holder?.querySelector(".loominate-tooltip")?.textContent).toBe(
      "It's too dark to see the steps.",
    );
    expect(holder?.hasAttribute("data-shown")).toBe(false);
    down?.click();
    expect(holder?.hasAttribute("data-shown")).toBe(true);
    main().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(holder?.hasAttribute("data-shown")).toBe(false);
    expect(holder?.hasAttribute("data-dismissed")).toBe(true);
    holder?.dispatchEvent(new Event("pointerleave"));
    expect(holder?.hasAttribute("data-dismissed")).toBe(false);
    down?.click();
    document.body.click();
    expect(holder?.hasAttribute("data-shown")).toBe(false);
  });

  it("stays after the link with reasons: inline", () => {
    const store = createStore();
    const record = createEventRecord(store);
    const story = createStory(store, record, passages, { start: "Stairs" });
    document.body.replaceChildren();
    const container = document.createElement("div");
    document.body.append(container);
    mountPage(container, { story, record }, { reasons: "inline" });
    expect(container.querySelector(".loominate-tooltip")).toBeNull();
    expect(container.querySelector(".loominate-choice .loominate-reason")?.textContent).toBe(
      "It's too dark to see the steps.",
    );
  });
});

describe("what the player noticed", () => {
  it("shows after the passage's text and before its choices, for the move it happened in", () => {
    const { main, click } = play();
    click("Take the lantern");
    expect([...main().children].map((c) => c.className || c.tagName).slice(0, 2)).toEqual([
      "P",
      "loominate-notice",
    ]);
    expect(main().querySelector(".loominate-notice")?.textContent).toBe("Something skitters away.");
    expect(main().lastElementChild?.querySelector("button")?.textContent).toBe("Continue");
    click("Continue");
    expect(main().querySelector(".loominate-notice")).toBeNull();
  });
});

describe("{notices}", () => {
  it("puts what the player noticed where the passage says", () => {
    const store = createStore();
    const record = createEventRecord(store);
    const story = createStory(
      store,
      record,
      [
        { id: "Porch", tags: [], body: () => [{ type: "link", label: "In", target: "Hall" }] },
        {
          id: "Hall",
          tags: [],
          effects: {
            enter: ({ emit }) => {
              emit("perception", { text: "A clock strikes.", sense: "hear" });
            },
          },
          body: () => [
            { type: "text", text: "The hall." },
            { type: "link", label: "Out", target: "Porch" },
            { type: "notices" },
          ],
        },
      ],
      { start: "Porch" },
    );
    document.body.replaceChildren();
    const container = document.createElement("div");
    document.body.append(container);
    mountPage(container, { story, record });
    container.querySelector("button")?.click();
    const shown = [...(container.querySelector(".loominate-passage")?.children ?? [])];
    expect(shown.map((c) => c.textContent)).toEqual(["The hall.", "Out", "A clock strikes."]);
  });
});

describe("atmosphere from fuses and daemons", () => {
  it("runs together in one paragraph, apart from what stands out, on the page and in the drawer", () => {
    const store = createStore();
    const record = createEventRecord(store);
    const story = createStory(
      store,
      record,
      [
        { id: "Porch", tags: [], body: () => [{ type: "link", label: "In", target: "Hall" }] },
        {
          id: "Hall",
          tags: [],
          effects: {
            enter: ({ emit }) => {
              emit("scheduled", { text: "Rain patters.", source: "rain" });
              emit("perception", { text: "A door slams.", sense: "hear" });
              emit("scheduled", { text: "You smell smoke!", source: "smoke", standsOut: true });
              emit("scheduled", { text: "An owl hoots.", source: "owl" });
            },
          },
          body: () => [
            { type: "text", text: "The hall." },
            { type: "link", label: "Out", target: "Porch" },
          ],
        },
      ],
      { start: "Porch" },
    );
    document.body.replaceChildren();
    const container = document.createElement("div");
    document.body.append(container);
    mountPage(container, { story, record });
    container.querySelector("button")?.click();
    const notices = [...container.querySelectorAll(".loominate-passage .loominate-notice")];
    expect(notices.map((c) => c.textContent)).toEqual([
      "Rain patters. An owl hoots.",
      "A door slams.",
      "You smell smoke!",
    ]);
    container.querySelector<HTMLButtonElement>(".loominate-passage button")?.click();
    const drawn = [...container.querySelectorAll(".loominate-turn")].at(-1);
    expect([...(drawn?.children ?? [])].map((c) => c.textContent)).toEqual([
      "The hall.",
      "Rain patters. An owl hoots.",
      "A door slams.",
      "You smell smoke!",
    ]);
  });
});

describe("an error in the story's code", () => {
  it("shows on the page, and the game stays where it was", () => {
    const store = createStore();
    const record = createEventRecord(store);
    const story = createStory(
      store,
      record,
      [
        {
          id: "Shelf",
          tags: [],
          body: () => [
            { type: "text", text: "A dusty shelf." },
            { type: "link", label: "Put the box in itself", target: "Box" },
          ],
        },
        {
          id: "Box",
          tags: [],
          effects: {
            enter: () => {
              throw new Error('move "box" to "box": that would put it inside itself.');
            },
          },
          body: () => [{ type: "text", text: "Done." }],
        },
      ],
      { start: "Shelf" },
    );
    document.body.replaceChildren();
    const container = document.createElement("div");
    document.body.append(container);
    const errors: unknown[] = [];
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      mountPage(container, { story, record }, { onError: (e) => errors.push(e) });
      store.commit(); // as the player shell does after each move, so a failed one rolls back
      container.querySelector("button")?.click();
      const alert = container.querySelector(".loominate-error");
      expect(alert?.getAttribute("role")).toBe("alert");
      expect(alert?.textContent).toContain(
        'Something went wrong: passage "Box" enter effect: move "box" to "box": that would put it inside itself.',
      );
      expect(story.current).toBe("Shelf");
      expect(container.textContent).toContain("A dusty shelf.");
      expect(errors).toHaveLength(1);
      expect(quiet).toHaveBeenCalled();
    } finally {
      quiet.mockRestore();
    }
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
    expect(turns()).toEqual([
      ["The kitchen is warm."],
      ["You light it. Finally light.", "Something skitters away."],
    ]);
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
    expect(loaded.turns()).toEqual([
      ["The kitchen is warm."],
      ["You light it. Finally light.", "Something skitters away."],
    ]);
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
