import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEventRecord } from "../events/record.js";
import { object } from "../objects/objects.js";
import { useVisitMemory } from "./memory.js";
import { createHistory } from "../state/history.js";
import { createStore, type StateSnapshot } from "../state/store.js";
import { createStory, type Passage } from "./story.js";

const passages: Passage[] = [
  {
    id: "Hall",
    tags: [],
    body: ({ firstVisit, visits, visited }) => [
      {
        type: "text",
        text: firstVisit ? "A grand hall." : `The hall again (visit ${String(visits)}).`,
      },
      ...(visited("Cellar") ? [{ type: "text" as const, text: "Dust from the cellar." }] : []),
      { type: "link", label: "Down", target: "Cellar" },
      { type: "link", label: "Wait", target: "Hall" },
    ],
  },
  {
    id: "Cellar",
    tags: [],
    body: () => [{ type: "link", label: "Up", target: "Hall" }],
  },
];

function setup(snapshot: StateSnapshot = {}) {
  const store = createStore(snapshot);
  const story = createStory(store, createEventRecord(store), passages, { start: "Hall" });
  return { store, story };
}

const go = (story: ReturnType<typeof setup>["story"], label: string): void => {
  const choice = story.render().choices.find((c) => c.label === label);
  if (!choice) throw new Error(`no choice ${label}`);
  story.follow(choice);
};

const prose = (story: ReturnType<typeof setup>["story"]): string[] =>
  story.render().nodes.flatMap((n) => (n.type === "text" ? [n.text] : []));

describe("visit tracking", () => {
  it("counts visits per passage, including links back to the same passage", () => {
    const { story } = setup();
    expect(story.visits("Hall")).toBe(0);
    expect(story.visited("Hall")).toBe(false);
    story.begin();
    go(story, "Wait");
    go(story, "Down");
    expect(story.visits("Hall")).toBe(2);
    expect(story.visits("Cellar")).toBe(1);
    expect(story.visited("Cellar")).toBe(true);
    expect(story.visits("Nowhere")).toBe(0);
  });

  it("gives passage bodies visits, firstVisit, and visited()", () => {
    const { story } = setup();
    story.begin();
    expect(prose(story)).toEqual(["A grand hall."]);
    go(story, "Wait");
    expect(prose(story)).toEqual(["The hall again (visit 2)."]);
    go(story, "Down");
    go(story, "Up");
    expect(prose(story)).toEqual(["The hall again (visit 3).", "Dust from the cellar."]);
  });

  it("doesn't count re-renders as visits", () => {
    const { story } = setup();
    story.begin();
    for (let i = 0; i < 10; i++) story.render();
    expect(story.visits("Hall")).toBe(1);
    expect(prose(story)).toEqual(["A grand hall."]);
  });

  it("survives save and load", () => {
    const { store, story } = setup();
    story.begin();
    go(story, "Down");
    go(story, "Up");
    const loaded = setup(JSON.parse(JSON.stringify(store.snapshot())));
    loaded.story.begin();
    expect(loaded.story.visits("Hall")).toBe(2);
    expect(loaded.story.visits("Cellar")).toBe(1);
    expect(prose(loaded.story)).toEqual(["The hall again (visit 2).", "Dust from the cellar."]);
  });

  it("rolls back with undo and forward with redo", () => {
    const { store, story } = setup();
    const history = createHistory(store);
    story.begin();
    history.checkpoint();
    go(story, "Down");
    history.checkpoint();
    go(story, "Up");
    history.checkpoint();

    history.undo();
    expect(story.visits("Hall")).toBe(1);
    history.undo();
    expect(story.visited("Cellar")).toBe(false);
    expect(prose(story)).toEqual(["A grand hall."]);
    history.redo();
    history.redo();
    expect(story.visits("Hall")).toBe(2);
  });
});

describe("visit memory", () => {
  // A memory with two players, as the world model's minds would be.
  const memo = object("memo", {
    who: "a",
    counts: {} as Record<string, number>,
    welcomes: 0,
  });
  const key = (passage: string) => `${memo.who}/${passage}`;
  const withWelcome: Passage[] = [
    {
      ...(passages[0] as Passage),
      effects: {
        firstVisit: () => {
          memo.welcomes += 1;
        },
      },
    },
    passages[1] as Passage,
  ];
  beforeEach(() => {
    useVisitMemory({
      count: (passage) => (memo.who === "nobody" ? undefined : (memo.counts[key(passage)] ?? 0)),
      record: (passage) => {
        if (memo.who !== "nobody") memo.counts[key(passage)] = (memo.counts[key(passage)] ?? 0) + 1;
      },
    });
  });
  afterEach(() => {
    useVisitMemory(undefined);
  });

  it("answers passages and first visits from memory, while totalVisits counts every visit", () => {
    const store = createStore();
    const story = createStory(store, createEventRecord(store), withWelcome, { start: "Hall" });
    story.begin();
    go(story, "Wait");
    expect(story.visits("Hall")).toBe(2);
    memo.who = "b"; // another player, who has never been here
    go(story, "Wait");
    expect(prose(story)).toEqual(["A grand hall."]);
    expect(story.visits("Hall")).toBe(1);
    expect(story.totalVisits("Hall")).toBe(3);
    expect(memo.welcomes).toBe(2); // the first visit ran again, for the new player
    memo.who = "nobody"; // no memory: the real count
    expect(story.visits("Hall")).toBe(3);
  });
});
