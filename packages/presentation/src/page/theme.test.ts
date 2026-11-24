// @vitest-environment jsdom
import { createEventRecord, createStore, createStory, type Passage } from "@loominate-if/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  display,
  layouts,
  statusLine,
  widgets,
  type StatusLineData,
  type WidgetView,
} from "./layout.js";
import { mountPage } from "./page.js";
import { themeTokens } from "./tokens.js";

const passages: Passage[] = [
  {
    id: "Deck",
    tags: [],
    body: () => [
      { type: "text", text: "Salt spray." },
      { type: "link", label: "Go below", target: "Hold" },
    ],
  },
  { id: "Hold", tags: [], body: () => [{ type: "text", text: "Barrels." }] },
];

function play(options: { styles?: boolean } = {}) {
  const store = createStore();
  const record = createEventRecord(store);
  const story = createStory(store, record, passages, { start: "Deck" });
  const container = document.createElement("div");
  document.body.append(container);
  const page = mountPage(container, { story, record }, options);
  return { story, page };
}

const styleSheets = () => document.querySelectorAll("style[data-loominate-styles]");

afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
});

describe("the default styles", () => {
  it("are added once per document, first in its head, in the loominate layer", () => {
    const authors = document.createElement("style");
    document.head.append(authors);
    play();
    play();
    expect(styleSheets()).toHaveLength(1);
    const css = styleSheets()[0]?.textContent ?? "";
    expect(document.head.firstElementChild).toBe(styleSheets()[0]);
    expect(css.startsWith("@layer loominate {")).toBe(true);
    expect(css).toContain("color-scheme: light dark;");
    for (const token of themeTokens) expect(css).toContain(`${token.name}: ${token.value};`);
  });

  it("can be left out", () => {
    play({ styles: false });
    expect(styleSheets()).toHaveLength(0);
  });

  it("use only declared tokens, and every token is used", () => {
    play();
    const css = styleSheets()[0]?.textContent ?? "";
    const used = new Set([...css.matchAll(/var\((--loominate-[\w-]+)\)/g)].map((m) => m[1]));
    expect([...used].sort()).toEqual(themeTokens.map((t) => t.name).sort());
  });
});

describe("a replaced widget template", () => {
  afterEach(() => {
    widgets.replace("status-line", statusLine(), { source: "@loominate-if/presentation" });
    layouts.remove("ship");
    display.layout = "page";
  });

  it("draws the same status-line data its own way", () => {
    layouts.register("ship", { regions: ["header", "main"], widgets: { header: ["status-line"] } });
    {
      // #region ship-status: shown in docs/guide/theming.md, kept in step by scripts/docs.test.ts
      // A ship's log instead of a bar: the same data, drawn as a definition list.
      const shipsLog: WidgetView<StatusLineData> = {
        mount(element, data) {
          const doc = element.ownerDocument;
          const log = doc.createElement("dl");
          log.className = "ships-log";
          const place = doc.createElement("dd");
          const watch = doc.createElement("dd");
          const term = (text: string) =>
            Object.assign(doc.createElement("dt"), { textContent: text });
          log.append(term("Position"), place, term("Watch"), watch);
          element.append(log);
          const show = (d: StatusLineData) => {
            place.textContent = d.left;
            watch.textContent = d.right;
          };
          show(data);
          return { update: show, unmount: () => log.remove() };
        },
      };
      widgets.replace("status-line", { ...statusLine(), view: shipsLog });
      // #endregion
    }
    const { page } = play();
    display.layout = "ship";
    page.refresh();
    const log = () => document.querySelector(".ships-log")?.textContent;
    expect(log()).toBe("PositionDeckWatchMoves: 0");
    expect(document.querySelector(".loominate-status")).toBeNull();
    (document.querySelector<HTMLElement>("a, button") as HTMLButtonElement).click();
    expect(log()).toBe("PositionHoldWatchMoves: 1");
  });
});
