// @vitest-environment jsdom
/** The command line on the page (#131): typing what the page offers. */
import {
  action,
  createEventRecord,
  createStore,
  createStory,
  menuLink,
  object,
  type Passage,
} from "@loominate-if/core";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commandSources } from "./command.js";
import { actionListWidget } from "./conversation.js";
import { layouts, widgets } from "./layout.js";
import { mountPage } from "./page.js";

const bell = object("cl-bell", { name: "brass bell", rung: 0 });
action<{ thing: typeof bell }>("cl-ring", {
  on: bell,
  label: "Ring the bell",
  verbs: ["ring {thing}", "pull (on) {thing}"],
  run: ({ thing }) => {
    thing.rung += 1;
  },
  report: "Ding!",
});
action<{ thing: typeof bell }>("cl-polish", {
  on: bell,
  label: "Polish the bell",
  check: () => "You have no cloth.",
});
const asked: string[] = [];

const passages: Passage[] = [
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
      { type: "link", label: "Climb the tower", target: "Tower" },
      {
        type: "link",
        label: "Cellar",
        target: "Hall",
        guard: {
          open: false,
          condition: "lamp",
          mode: "disabled-with-reason",
          reason: "It's too dark.",
        },
      },
    ],
  },
  {
    id: "Tower",
    tags: [],
    body: () => [
      { type: "text", text: "Wind howls at the top." },
      { type: "link", label: "Down", target: "Hall" },
    ],
  },
];

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const undo of cleanup.splice(0).reverse()) undo();
});

function play(commandLine = true) {
  const store = createStore();
  const record = createEventRecord(store);
  const story = createStory(store, record, passages, {
    start: "Hall",
    guardMode: "disabled-with-reason",
  });
  document.body.replaceChildren();
  document.title = "Bell tower";
  document.documentElement.lang = "en";
  const container = document.createElement("div");
  document.body.append(container);
  const page = mountPage(container, { story, record }, { commandLine });
  const input = () => container.querySelector<HTMLInputElement>(".loominate-command-input");
  const type = (text: string) => {
    const field = input();
    if (!field) throw new Error("no command line");
    field.focus();
    field.value = text;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const key = (k: string) => {
    input()?.dispatchEvent(
      new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }),
    );
  };
  const said = () => container.querySelector(".loominate-command-said")?.textContent ?? "";
  const options = () =>
    [...container.querySelectorAll(".loominate-command-option")].map((o) => o.textContent);
  const announced = () => container.querySelector(".loominate-announce")?.textContent ?? "";
  return { story, page, container, input, type, key, said, options, announced };
}

describe("the command line (#131)", () => {
  it("isn't there unless it's turned on, and can be turned on and off", () => {
    const { page, input } = play(false);
    expect(input()).toBeNull();
    page.showCommandLine(true);
    expect(document.activeElement).toBe(input());
    page.showCommandLine(false);
    expect(input()).toBeNull();
  });

  it("suggests what's on offer as the player types, and does what's typed, keeping focus", async () => {
    const { story, type, key, options, input, announced } = play();
    type("cl");
    expect(options()).toEqual(["Climb the tower"]);
    expect(input()?.getAttribute("aria-expanded")).toBe("true");
    key("Enter");
    expect(story.current).toBe("Tower");
    expect(document.activeElement).toBe(input());
    expect(input()?.value).toBe("");
    // What's new is read where the player is, a moment later, as after any move.
    await vi.waitFor(() => {
      expect(announced()).toContain("Wind howls at the top.");
    });
  });

  it("reads the suggestions once typing pauses, since a screen reader only echoes the typing", async () => {
    const { type, key, said } = play();
    commandSources.register("cl-extra", () => [{ label: "Ring for help", run: () => undefined }]);
    cleanup.push(() => {
      commandSources.remove("cl-extra");
    });
    type("r");
    type("ring");
    expect(said()).toBe("");
    await vi.waitFor(() => {
      expect(said()).toBe("2 suggestions: Ring the bell, Ring for help.");
    });
    type("xyzzy");
    await vi.waitFor(() => {
      expect(said()).toBe("No suggestions.");
    });
    // Taken before the pause is over: what it did is read, not the suggestions.
    type("ring bell");
    key("Enter");
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(said()).toBe("");
  });

  it("takes things' menu actions by label or verb phrase, and says why one can't be done", () => {
    const { type, key, said, story } = play();
    type("pull on bell");
    key("Enter");
    expect(bell.rung).toBe(1);
    expect(story.current).toBe("Hall");
    type("polish");
    key("Enter");
    expect(said()).toBe("Polish the bell: You have no cloth.");
    type("cellar");
    key("Enter");
    expect(said()).toBe("Cellar: It's too dark.");
  });

  it("lists what it could mean, or what's possible, never \"I don't understand\"", () => {
    const { type, key, said, options, input } = play();
    commandSources.register("cl-extra", () => [{ label: "Ring for help", run: () => undefined }]);
    cleanup.push(() => {
      commandSources.remove("cl-extra");
    });
    type("ring");
    key("Enter");
    expect(said()).toBe("Did you mean Ring the bell or Ring for help?");
    expect(options()).toEqual(["Ring the bell", "Ring for help"]);
    // Offered twice, once by a source: listed once.
    commandSources.register("cl-again", () => [{ label: "Ring the bell", run: () => undefined }]);
    cleanup.push(() => {
      commandSources.remove("cl-again");
    });
    type("ring bell");
    expect(options()).toEqual(["Ring the bell"]);
    type("ring");
    key("Enter");
    // The first is picked; Down picks the next, which Enter does.
    expect(input()?.getAttribute("aria-activedescendant")).toMatch(/-option-0$/);
    type("xyzzy");
    key("Enter");
    expect(said()).toBe(
      "That isn't something you can do here. You could: Climb the tower, Ring the bell, Ring for help.",
    );
  });

  it("picks suggestions with the arrow keys, completes with Tab, and recalls earlier commands", () => {
    const { type, key, input, story } = play();
    type("down"); // nothing to go down from here
    type("climb");
    key("ArrowDown");
    expect(input()?.getAttribute("aria-activedescendant")).toMatch(/-option-0$/);
    key("Tab");
    expect(input()?.value).toBe("Climb the tower");
    key("Enter");
    expect(story.current).toBe("Tower");
    key("ArrowUp");
    expect(input()?.value).toBe("Climb the tower");
    key("Escape");
    expect(input()?.value).toBe("");
  });

  it("takes a layout's action lists, as a conversation's topics", () => {
    layouts.register("cl-talk", {
      regions: ["main", "topics"],
      widgets: { topics: ["cl-topics"] },
    });
    widgets.register(
      "cl-topics",
      actionListWidget({
        label: () => "Topics",
        items: () => [
          { label: "Ask about the weather", available: true },
          { label: "Say goodbye", available: false, reason: "Not yet." },
        ],
        take: (_host, i) => asked.push(String(i)),
      }),
    );
    const page = layouts.get("page");
    layouts.replace("page", { regions: ["main", "topics"], widgets: { topics: ["cl-topics"] } });
    cleanup.push(() => {
      if (page) layouts.replace("page", page);
      layouts.remove("cl-talk");
      widgets.remove("cl-topics");
    });
    const { type, key, said } = play();
    type("ask weather");
    key("Enter");
    expect(asked).toEqual(["0"]);
    type("goodbye");
    key("Enter");
    expect(said()).toBe("Say goodbye: Not yet.");
  });

  it("passes automated accessibility checks with suggestions showing", async () => {
    const { type } = play();
    type("r");
    const results = await axe.run(document, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html}`))).toEqual([]);
  });
});
