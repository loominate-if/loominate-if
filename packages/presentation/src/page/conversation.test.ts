// @vitest-environment jsdom
/** Conversation widgets (#118): a cast of portraits and a list of action buttons, on the page. */
import {
  createEventRecord,
  createStore,
  createStory,
  emit,
  type Passage,
} from "@loominate-if/core";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import { actionListWidget, castWidget, type CastMember } from "./conversation.js";
import { display, layouts, widgets } from "./layout.js";
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
