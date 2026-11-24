// @vitest-environment jsdom
/** The story log and full transcript (#127). */
import {
  createEventRecord,
  createHistory,
  createStore,
  createStory,
  type Passage,
} from "@loominate-if/core";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import { createLogDialog, nameSpeakers, storyLog, transcript, transcriptText } from "./log.js";

const passages: Passage[] = [
  {
    id: "Hall",
    tags: ["room: hall"],
    effects: {
      enter: ({ emit, visits }) => {
        if (visits === 1) emit("system", { text: "Autosaved." });
        emit("action-result", { text: "“Yes, miss?”" }, ["topic", "speaker:maid"]);
      },
    },
    body: () => [
      { type: "text", text: "A long hall." },
      { type: "link", label: "Again", target: "Hall" },
      { type: "link", label: "Ask", target: "Asked" },
    ],
  },
  {
    id: "Asked",
    tags: [],
    effects: {
      enter: ({ emit }) => {
        emit("action-result", { text: "You ask the maid about the gold." }, ["topic", "player"]);
        emit("action-result", { text: "“Gone, miss.”" }, ["topic", "speaker:maid"]);
        emit("action-result", { text: "A secret aside." }, ["no-log"]);
        emit("system", { text: "Chapter one ends." }, ["log"]);
      },
    },
    body: () => [{ type: "text", text: "You wait for more." }],
  },
];

function play() {
  const store = createStore();
  const record = createEventRecord(store);
  const story = createStory(store, record, passages, { start: "Hall" });
  story.begin();
  const follow = (label: string, target: string) => {
    story.follow({ type: "link", label, target });
  };
  return { store, record, story, follow };
}

afterEach(() => {
  nameSpeakers(() => undefined);
});

describe("the story log (#127)", () => {
  it("is the narrative: prose once a room, what was noticed and said, each line by its speaker", () => {
    nameSpeakers((id) => ({ maid: "Maid" })[id]);
    const { record, follow } = play();
    follow("Again", "Hall");
    follow("Ask", "Asked");
    expect(
      storyLog(record.events()).map((e) => [e.speaker ?? (e.player ? "(player)" : ""), e.text]),
    ).toEqual([
      ["", "A long hall."],
      ["Maid", "“Yes, miss?”"],
      // The hall again: its prose isn't repeated, but what was said is.
      ["Maid", "“Yes, miss?”"],
      // As the page shows a move: the passage's prose, then what came of it.
      ["", "You wait for more."],
      ["(player)", "You ask the maid about the gold."],
      ["Maid", "“Gone, miss.”"],
      // Tagged log, though a system message; the aside tagged no-log is left out.
      ["", "Chapter one ends."],
    ]);
  });

  it("leaves out a paragraph that's only a link, as a name opening a menu: it's a choice", () => {
    const store = createStore();
    const record = createEventRecord(store);
    createStory(
      store,
      record,
      [
        {
          id: "Study",
          tags: [],
          body: () => [
            { type: "text", text: "A quiet study." },
            {
              type: "text",
              text: "Rex",
              links: [{ type: "link", label: "Rex", target: "Study", start: 0, end: 3 }],
            },
          ],
        },
      ],
      { start: "Study" },
    ).begin();
    expect(storyLog(record.events()).map((e) => e.text)).toEqual(["A quiet study."]);
  });

  it("follows undo, since it's read from the record", () => {
    const { store, record, follow } = play();
    const history = createHistory(store);
    history.clear();
    store.commit();
    follow("Ask", "Asked");
    history.checkpoint();
    history.undo();
    expect(storyLog(record.events()).map((e) => e.text)).not.toContain("“Gone, miss.”");
  });
});

describe("the full transcript (#127)", () => {
  it("lists every event, with its kind and text or fields", () => {
    const { record } = play();
    const lines = transcript(record.events());
    expect(lines.map((l) => l.kind)).toContain("navigation");
    expect(lines.find((l) => l.kind === "system")?.text).toBe("Autosaved.");
    expect(lines.find((l) => l.kind === "navigation")?.text).toBe("to: Hall");
    expect(transcriptText(lines).split("\n")[0]).toMatch(/^0 \[\w+\] /);
  });
});

describe("the log dialog (#127)", () => {
  function open(view: "log" | "transcript") {
    const { record } = play();
    document.body.replaceChildren();
    document.documentElement.lang = "en";
    document.title = "Log";
    const dialog = createLogDialog(document.body, () => record.events());
    dialog.open(view);
    return dialog.element;
  }

  it("shows the story log, with a filter for dialogue only, focused when it opens", () => {
    nameSpeakers((id) => ({ maid: "Maid" })[id]);
    const element = open("log");
    expect(element.querySelector("h2")?.textContent).toBe("Story log");
    expect(document.activeElement?.tagName).toBe("SELECT");
    const entries = () =>
      [...element.querySelectorAll(".loominate-log-entry")].map((p) => p.textContent);
    expect(entries()).toEqual(["A long hall.", "Maid: “Yes, miss?”"]);
    const filter = element.querySelector("select");
    if (!filter) throw new Error("no filter");
    filter.value = "dialogue";
    filter.dispatchEvent(new Event("change"));
    expect(entries()).toEqual(["Maid: “Yes, miss?”"]);
  });

  it("shows the transcript, filtered by kind", () => {
    const element = open("transcript");
    expect(element.querySelector("h2")?.textContent).toBe("Transcript");
    const filter = element.querySelector("select");
    if (!filter) throw new Error("no filter");
    filter.value = "system";
    filter.dispatchEvent(new Event("change"));
    expect([...element.querySelectorAll(".loominate-log-line")].map((p) => p.textContent)).toEqual([
      expect.stringMatching(/\[system\] Autosaved\.$/),
    ]);
  });

  it("scrolls the log with the mouse wheel anywhere on it, and keeps the page behind still (#127)", () => {
    const element = open("log");
    expect(document.documentElement.classList.contains("loominate-modal-open")).toBe(true);
    const body = element.querySelector<HTMLElement>(".loominate-log-body");
    if (!body) throw new Error("no body");
    body.scrollTop = 100;
    const wheel = new WheelEvent("wheel", { deltaY: -40, bubbles: true, cancelable: true });
    element.querySelector("h2")?.dispatchEvent(wheel);
    expect([body.scrollTop, wheel.defaultPrevented]).toEqual([60, true]);
    element.querySelector<HTMLButtonElement>("button:last-of-type")?.click();
    expect(document.documentElement.classList.contains("loominate-modal-open")).toBe(false);
  });

  it("passes automated accessibility checks", async () => {
    const element = open("log");
    expect((await axe.run(element)).violations).toEqual([]);
  });
});
