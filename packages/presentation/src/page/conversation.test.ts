// @vitest-environment jsdom
/** Conversation widgets (#118): a cast of portraits and a list of action buttons, on the page. */
import {
  createEventRecord,
  createHistory,
  createStore,
  createStory,
  emit,
  object,
  type Passage,
} from "@loominate-if/core";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import { actionListWidget, castWidget, type CastMember } from "./conversation.js";
import { display, layouts, widgets } from "./layout.js";
import { nameSpeakers } from "./log.js";
import { mountPage } from "./page.js";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const undo of cleanup.splice(0).reverse()) undo();
});
const register = <T>(
  registry: { register(n: string, v: T): void; remove(n: string): void },
  name: string,
  value: T,
) => {
  registry.register(name, value);
  cleanup.push(() => {
    registry.remove(name);
  });
};

let members: CastMember[] = [];
let items = [
  { label: "Ask about the letter", available: true },
  { label: "Say goodbye", available: false, reason: "You can't leave until you answer." },
];
const addressed: string[] = [];
const taken: number[] = [];

const passages: Passage[] = [
  {
    id: "Study",
    tags: [],
    effects: {
      enter: () => {
        display.layout = "talk";
        emit("action-result", { text: "“Sir?”" }, ["topic"]);
      },
    },
    body: () => [{ type: "text", text: "A quiet study." }, { type: "notices" }],
  },
];

function play() {
  register(layouts, "talk", {
    regions: ["header", "cast", "main", "topics"],
    widgets: { cast: ["test-cast"], topics: ["test-topics"] },
    standardHeader: true,
  });
  register(
    widgets,
    "test-cast",
    castWidget({
      label: () => "In the conversation",
      members: () => members,
      address: (_host, id) => addressed.push(id),
    }),
  );
  register(
    widgets,
    "test-topics",
    actionListWidget({
      label: () => "Topics",
      items: () => items,
      take: (_host, i) => taken.push(i),
    }),
  );
  // The page layout's header, which a standard header shares.
  const page = layouts.get("page");
  layouts.replace("page", {
    regions: ["header", "main", "footer"],
    widgets: { header: ["status-line"] },
  });
  cleanup.push(() => {
    if (page) layouts.replace("page", page);
  });
  const store = createStore();
  const record = createEventRecord(store);
  const story = createStory(store, record, passages, { start: "Study" });
  document.body.replaceChildren();
  document.documentElement.lang = "en";
  document.title = "Study";
  const container = document.createElement("div");
  document.body.append(container);
  return mountPage(container, { story, record }).element;
}

describe("conversation widgets (#118)", () => {
  it("show a cast of portraits, the one addressed pressed, and address another when chosen", () => {
    members = [
      {
        id: "butler",
        name: "butler",
        initials: "B",
        addressed: true,
        image: "b.png",
        expression: "stern",
      },
      { id: "maid", name: "maid", initials: "M", addressed: false },
    ];
    const root = play();
    const cast = root.querySelector('[data-region="cast"] .loominate-cast');
    expect(cast?.getAttribute("aria-label")).toBe("In the conversation");
    const buttons = [...root.querySelectorAll<HTMLButtonElement>(".loominate-portrait")];
    expect(buttons.map((b) => [b.textContent, b.getAttribute("aria-pressed")])).toEqual([
      ["butler, stern", "true"],
      ["Mmaid", "false"],
    ]);
    expect(root.querySelector(".loominate-portrait-image")?.getAttribute("alt")).toBe("");
    buttons[1]?.click();
    buttons[0]?.click(); // already addressed: nothing
    expect(addressed).toEqual(["maid"]);
  });

  it("make the cast one stop, a toolbar the arrow keys move through (#141)", async () => {
    addressed.length = 0;
    members = [
      { id: "butler", name: "butler", initials: "B", addressed: false },
      { id: "maid", name: "maid", initials: "M", addressed: true },
      { id: "cook", name: "cook", initials: "C", addressed: false },
    ];
    const root = play();
    const cast = root.querySelector<HTMLElement>(".loominate-cast");
    expect(cast?.getAttribute("role")).toBe("toolbar");
    const buttons = [...root.querySelectorAll<HTMLButtonElement>(".loominate-portrait")];
    // Tab reaches the one addressed.
    expect(buttons.map((b) => b.tabIndex)).toEqual([-1, 0, -1]);
    const key = (k: string) => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }),
      );
    };
    buttons[1]?.focus();
    key("ArrowRight");
    expect(document.activeElement).toBe(buttons[2]);
    key("ArrowRight"); // round to the first
    expect(document.activeElement).toBe(buttons[0]);
    key("ArrowLeft");
    expect(document.activeElement).toBe(buttons[2]);
    key("Home");
    expect([document.activeElement, buttons.map((b) => b.tabIndex)]).toEqual([
      buttons[0],
      [0, -1, -1],
    ]);
    key("End");
    expect(document.activeElement).toBe(buttons[2]);
    // Moving doesn't address; choosing does, as Enter and Space do on a button.
    expect(addressed).toEqual([]);
    buttons[2]?.click();
    expect(addressed).toEqual(["cook"]);
    const results = await axe.run(document, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html}`))).toEqual([]);
  });

  it("list actions as buttons, taking the one chosen; one that can't be taken is disabled, with why", () => {
    const root = play();
    const list = root.querySelector('[data-region="topics"] .loominate-action-list');
    expect(list?.getAttribute("aria-label")).toBe("Topics");
    const [ask, bye] = [...root.querySelectorAll<HTMLButtonElement>(".loominate-action-list-item")];
    ask?.click();
    bye?.click();
    expect(taken).toEqual([0]);
    expect(bye?.getAttribute("aria-disabled")).toBe("true");
    const why = root.querySelector(`#${bye?.getAttribute("aria-describedby") ?? ""}`);
    expect(why?.textContent).toBe("You can't leave until you answer.");
  });

  it("give a layout with a standard header the page's header widgets, and tag notices for themes", () => {
    const root = play();
    expect(root.dataset.layout).toBe("talk");
    expect(root.querySelector('[data-region="header"] .loominate-status')).not.toBeNull();
    expect(root.querySelector(".loominate-notice")?.getAttribute("data-tags")).toBe("topic");
  });

  it("are keyboard operable and pass automated accessibility checks", async () => {
    items = [{ label: "Ask about the letter", available: true }];
    const root = play();
    const ask = root.querySelector<HTMLButtonElement>(".loominate-action-list-item");
    ask?.focus();
    expect(document.activeElement).toBe(ask);
    expect(ask?.tagName).toBe("BUTTON"); // Enter and Space take it, as any button
    const results = await axe.run(document, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html}`))).toEqual([]);
  });
});

describe("a layout placing the passage's parts (#118)", () => {
  const said = object("transcriptTest", { n: 0 });
  const quiet = { on: false };
  const talk: Passage[] = [
    {
      id: "Talk",
      tags: [],
      effects: {
        enter: () => {
          display.layout = "placed";
          if (quiet.on) return;
          said.n += 1;
          emit("action-result", { text: `Line ${String(said.n)}` }, ["topic"]);
        },
      },
      body: () => [
        { type: "text", text: "A quiet study." },
        { type: "link", label: "Again", target: "Talk" },
      ],
    },
  ];
  function playPlaced() {
    register(layouts, "placed", {
      regions: ["context", "main", "more", "history"],
      passage: {
        prose: "context",
        choices: "more",
        choicesLabel: () => "In the study",
        transcriptSince: () => 0,
        drawer: "history",
        transcriptLabel: () => "The conversation so far",
      },
    });
    const store = createStore();
    const record = createEventRecord(store);
    const story = createStory(store, record, talk, { start: "Talk" });
    const history = createHistory(store);
    document.body.replaceChildren();
    const container = document.createElement("div");
    document.body.append(container);
    const page = mountPage(container, { story, record }, { onMove: () => history.checkpoint() });
    history.clear();
    store.commit();
    const root = page.element;
    const region = (name: string) => root.querySelector<HTMLElement>(`[data-region="${name}"]`);
    const again = () => {
      const link = region("more")?.querySelector<HTMLElement>("a");
      link?.click();
    };
    return { root, region, again, history, page };
  }

  it("put the prose above, the links in a disclosure below, and keep a transcript in main", () => {
    const { region, again } = playPlaced();
    expect(region("context")?.textContent).toBe("A quiet study.");
    const more = region("more")?.querySelector("details");
    expect([more?.open, more?.querySelector("summary")?.textContent]).toEqual([
      false,
      "In the study",
    ]);
    again();
    again();
    const main = region("main");
    expect(
      [...(main?.querySelectorAll(".loominate-notice") ?? [])].map((p) => p.textContent),
    ).toEqual(["Line 1", "Line 2", "Line 3"]);
    expect(main?.querySelector(".loominate-passage")?.textContent).not.toContain("A quiet study.");
    // The transcript scrolls, so keyboard players can reach it, by its name.
    const passage = main?.querySelector<HTMLElement>(".loominate-passage");
    expect([
      passage?.classList.contains("loominate-transcript"),
      passage?.tabIndex,
      passage?.getAttribute("aria-label"),
    ]).toEqual([true, 0, "The conversation so far"]);
    // The story so far is in its own region, last.
    expect(main?.querySelector(".loominate-drawer")).toBeNull();
    expect(region("history")?.querySelector("details.loominate-drawer")).not.toBeNull();
    // Focus is on the heading just before what's new, in main.
    expect(document.activeElement?.textContent).toBe("Passage");
    expect(document.activeElement?.nextElementSibling?.textContent).toBe("Line 3");
  });

  it("show the last exchange after a move that says nothing, with focus before it", () => {
    const { region, again } = playPlaced();
    again();
    quiet.on = true; // the next arrival says nothing, as coming back from a cut scene
    again();
    const notices = [...(region("main")?.querySelectorAll(".loominate-notice") ?? [])];
    expect(notices.map((p) => p.textContent)).toEqual(["Line 1", "Line 2"]);
    expect(document.activeElement?.textContent).toBe("Passage");
    expect(document.activeElement?.nextElementSibling?.textContent).toBe("Line 2");
    quiet.on = false;
  });

  it("follow undo: the transcript comes from the record", () => {
    const { region, again, history, page } = playPlaced();
    again();
    again();
    history.undo();
    page.refresh();
    expect(
      [...(region("main")?.querySelectorAll(".loominate-notice") ?? [])].map((p) => p.textContent),
    ).toEqual(["Line 1", "Line 2"]);
  });
});

describe("who's talking, on the page (#142)", () => {
  const lines: Passage[] = [
    {
      id: "Kitchen",
      tags: [],
      effects: {
        enter: () => {
          emit("action-result", { text: "You ask about the letter." }, [
            "topic",
            "player",
            "speaker:you",
          ]);
          emit("action-result", { text: "“I never!”" }, ["topic", "speaker:maid"]);
          emit("action-result", { text: "“Don't ask me.”" }, ["topic", "speaker:stranger"]);
        },
      },
      body: () => [{ type: "notices" }],
    },
  ];
  const show = () => {
    const store = createStore();
    const record = createEventRecord(store);
    const story = createStory(store, record, lines, { start: "Kitchen" });
    document.body.replaceChildren();
    const container = document.createElement("div");
    document.body.append(container);
    return mountPage(container, { story, record }).element;
  };

  it("names the speaker before each line, as the story log does, but not the player's own", () => {
    nameSpeakers((id) => ({ maid: "Maid" })[id]);
    cleanup.push(() => {
      nameSpeakers(() => undefined);
    });
    const root = show();
    const texts = [...root.querySelectorAll(".loominate-notice")].map((p) => p.textContent);
    expect(texts.join(" ")).toContain("Maid: “I never!”");
    expect(texts.join(" ")).not.toContain("you: ");
    // A speaker the game doesn't name gets no name, rather than their ID.
    expect(texts.join(" ")).not.toContain("stranger:");
    expect(root.querySelector(".loominate-speaker")?.textContent).toBe("Maid: ");
  });

  it("marks who spoke last in the cast", () => {
    members = [
      { id: "butler", name: "butler", initials: "B", addressed: true },
      { id: "maid", name: "maid", initials: "M", addressed: false, speaking: true },
    ];
    const root = play();
    const speaking = [...root.querySelectorAll(".loominate-portrait")].map((b) =>
      b.getAttribute("data-speaking"),
    );
    expect(speaking).toEqual([null, "true"]);
  });
});
