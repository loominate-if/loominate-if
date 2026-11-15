import { describe, expect, it } from "vitest";
import { createEventRecord } from "../events/record.js";
import { createHistory } from "../state/history.js";
import { createStore, type StateSnapshot } from "../state/store.js";
import { StateError } from "../state/value.js";
import { createStory, type Passage, type PassageNode } from "./story.js";

const text = (t: string, line?: string): PassageNode => ({
  type: "text",
  text: t,
  ...(line !== undefined && { line }),
});
const link = (label: string, target: string): PassageNode => ({ type: "link", label, target });

/** Hand-written compiled passages, standing in for compiler output. */
const passages: Passage[] = [
  {
    id: "Arrival",
    tags: ["scene"],
    body: () => [
      text("The train is gone before you've finished stepping down.", "arrival#1"),
      text("You are not, it seems, expected.", "arrival#2"),
      { type: "continue", target: "Platform" },
    ],
  },
  {
    id: "Platform",
    tags: [],
    body: ({ state }) => [
      text("Fog has swallowed the platform.", "platform#1"),
      ...(state.get("lamp", "lit") === true ? [text("The lamp burns.", "platform#2")] : []),
      link("Enter the station", "Station"),
      link("Wait", "Platform"),
    ],
  },
  {
    id: "Station",
    tags: [],
    body: () => [
      text("Low, grey, and older than the railway.", "station#1"),
      link("Back", "Platform"),
    ],
  },
];

function setup(snapshot: StateSnapshot = {}) {
  const store = createStore(snapshot);
  const record = createEventRecord(store);
  const story = createStory(store, record, passages, { start: "Arrival" });
  return { store, record, story };
}

function choose(story: ReturnType<typeof setup>["story"], label: string): void {
  const choice = story
    .render()
    .choices.find((c) => (c.label ?? (c.type === "continue" ? "Continue" : "")) === label);
  if (!choice) throw new Error(`no choice ${label}`);
  story.follow(choice);
}

describe("createStory", () => {
  it("begins in the start passage and records its prose", () => {
    const { story, record } = setup();
    expect(story.current).toBeUndefined();
    story.begin();
    expect(story.current).toBe("Arrival");
    expect(record.events().map((e) => [e.kind, "text" in e ? e.text : e.to])).toEqual([
      ["navigation", "Arrival"],
      ["narrative", "The train is gone before you've finished stepping down."],
      ["narrative", "You are not, it seems, expected."],
    ]);
  });

  it("carries line IDs from text nodes onto narrative events", () => {
    const { story, record } = setup();
    story.begin();
    expect(record.events({ kinds: ["narrative"] }).map((e) => e.line)).toEqual([
      "arrival#1",
      "arrival#2",
    ]);
  });

  it("renders text, links, and continue points in reading order", () => {
    const { story } = setup();
    story.begin();
    choose(story, "Continue");
    const page = story.render();
    expect(page.passage.id).toBe("Platform");
    expect(page.nodes.map((n) => n.type)).toEqual(["text", "link", "link"]);
    expect(page.choices.map((c) => c.target)).toEqual(["Station", "Platform"]);
  });

  it("renders a passage any number of times without changing state", () => {
    const { store, story } = setup();
    story.begin();
    store.commit();
    const before = store.snapshot();
    const first = story.render();
    for (let i = 0; i < 50; i++) expect(story.render()).toEqual(first);
    expect(store.dirty).toBe(false);
    expect(store.snapshot()).toEqual(before);
  });

  it("re-renders conditional text from current state", () => {
    const { store, story } = setup();
    story.begin();
    choose(story, "Continue");
    expect(story.render().nodes).toHaveLength(3);
    store.set("lamp", "lit", true);
    expect(story.render().nodes.map((n) => (n.type === "text" ? n.text : n.type))).toEqual([
      "Fog has swallowed the platform.",
      "The lamp burns.",
      "link",
      "link",
    ]);
  });

  it("records navigation as events, from and to", () => {
    const { story, record } = setup();
    story.begin();
    choose(story, "Continue");
    choose(story, "Enter the station");
    choose(story, "Back");
    expect(record.events({ kinds: ["navigation"] }).map((e) => [e.from, e.to])).toEqual([
      [undefined, "Arrival"],
      ["Arrival", "Platform"],
      ["Platform", "Station"],
      ["Station", "Platform"],
    ]);
  });

  it("follows a link back to the same passage", () => {
    const { story, record } = setup();
    story.begin();
    choose(story, "Continue");
    const before = record.length;
    choose(story, "Wait");
    expect(story.current).toBe("Platform");
    expect(record.events({ since: before }).map((e) => e.kind)).toEqual([
      "navigation",
      "narrative",
    ]);
  });

  it("refuses choices the current passage doesn't offer", () => {
    const { story } = setup();
    story.begin();
    expect(() => story.follow({ type: "link", label: "Cheat", target: "Station" })).toThrow(
      `follow: "Cheat" isn't a choice in passage "Arrival".`,
    );
    expect(story.current).toBe("Arrival");
  });

  it("goes straight to a passage from author code", () => {
    const { story } = setup();
    story.begin();
    story.goTo("Station");
    expect(story.current).toBe("Station");
    expect(() => story.goTo("Nowhere")).toThrow(`goTo: there's no passage named "Nowhere".`);
  });

  it("reports missing passages and duplicate names when created", () => {
    const store = createStore();
    const record = createEventRecord(store);
    expect(() => createStory(store, record, passages, { start: "Nope" })).toThrow(
      /start: there's no passage named "Nope"/,
    );
    expect(() =>
      createStory(store, record, [...passages, passages[0] as Passage], { start: "Arrival" }),
    ).toThrow(/two passages are named "Arrival"/);
    const broken: Passage = { id: "A", tags: [], body: () => [link("Go", "Missing")] };
    const story = createStory(store, record, [broken], { start: "A" });
    story.begin();
    expect(() => story.follow({ type: "link", label: "Go", target: "Missing" })).toThrow(
      /follow from "A": there's no passage named "Missing"/,
    );
  });

  it("refuses to render before begin", () => {
    expect(() => setup().story.render()).toThrow(/call begin\(\) first/);
  });

  it("catches a passage body that changes state, and undoes the change", () => {
    const store = createStore();
    const record = createEventRecord(store);
    const impure: Passage = {
      id: "Bad",
      tags: [],
      body: () => {
        store.set("player", "fear", 1);
        return [text("Boo.")];
      },
    };
    const story = createStory(store, record, [impure, ...passages], { start: "Arrival" });
    story.begin();
    // Entering records events, so the store is already dirty and the write slips
    // through once. Clear it, then render from a clean store, where it's caught.
    story.goTo("Bad");
    store.delete("player", "fear");
    store.commit();
    expect(() => story.render()).toThrow(StateError);
    expect(() => story.render()).toThrow(/rendering changed state. Rendering must be pure/);
    expect(store.has("player", "fear")).toBe(false);
  });
});

describe("a playthrough", () => {
  it("resumes from a save where it left off", () => {
    const { store, story, record } = setup();
    story.begin();
    choose(story, "Continue");
    choose(story, "Enter the station");
    const loaded = setup(JSON.parse(JSON.stringify(store.snapshot())));
    loaded.story.begin();
    expect(loaded.story.current).toBe("Station");
    expect(loaded.record.events()).toEqual(record.events());
    choose(loaded.story, "Back");
    expect(loaded.story.current).toBe("Platform");
  });

  it("undoes a move: back to the previous passage, with its events trimmed", () => {
    const { store, story, record } = setup();
    const history = createHistory(store);
    story.begin();
    history.checkpoint("begin");
    choose(story, "Continue");
    history.checkpoint("Platform");
    const afterPlatform = record.length;
    choose(story, "Enter the station");
    history.checkpoint("Station");

    history.undo();
    expect(story.current).toBe("Platform");
    expect(record.length).toBe(afterPlatform);
    history.undo();
    expect(story.current).toBe("Arrival");
    history.redo();
    history.redo();
    expect(story.current).toBe("Station");
  });

  it("replays identically from the same choices", () => {
    const run = () => {
      const { store, story } = setup();
      story.begin();
      for (const label of ["Continue", "Wait", "Enter the station", "Back"]) choose(story, label);
      return JSON.stringify(store.snapshot());
    };
    expect(run()).toBe(run());
  });
});
