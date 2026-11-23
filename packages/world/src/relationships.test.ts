import {
  createEventRecord,
  createHistory,
  createStore,
  createStory,
  readReplay,
  writeReplay,
  type EventRecord,
  type Passage,
  type StateStore,
  type Story,
} from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  actor,
  changeRelationship,
  place,
  relationship,
  relationships,
  setRelationship,
  startAs,
  threshold,
} from "./index.js";

// #region dimensions
declare module "@loominate-if/world" {
  interface Dimensions {
    affection: true;
    trust: true;
  }
}
relationships({ affection: { min: -10, max: 10 }, trust: { start: 2 } });
// #endregion

const garden = place("garden", { name: "garden" });
export const you = actor("you", { body: { name: "you", location: garden } });
export const mira = actor("mira", { body: { name: "Mira", isProper: true, location: garden } });
startAs(you);
setRelationship(mira, you, { affection: 4 }); // how she feels about you, as the game begins

// #region thresholds
threshold("smitten", { dimension: "affection", reaches: 8 }, ({ observer }) =>
  observer.id === "mira:mind" ? "Mira can't stop smiling at you." : undefined,
);
threshold("wary", { dimension: "trust", falls: 0 }, () => "Mira watches you warily now.");
// #endregion

const passages: Passage[] = [
  {
    id: "Garden",
    tags: [],
    body: () => [
      { type: "link", label: "Compliment her", target: "Compliment" },
      { type: "link", label: "Tease her", target: "Tease" },
      { type: "link", label: "Lie to her", target: "Lie" },
    ],
  },
  {
    id: "Compliment",
    tags: [],
    effects: { enter: () => void changeRelationship(mira, you, { affection: 2 }) },
    body: () => [{ type: "continue", target: "Garden" }],
  },
  {
    id: "Tease",
    tags: [],
    effects: { enter: () => void changeRelationship(mira, you, { affection: -3 }) },
    body: () => [{ type: "continue", target: "Garden" }],
  },
  {
    id: "Lie",
    tags: [],
    effects: { enter: () => void changeRelationship(mira, you, { trust: -2 }) },
    body: () => [{ type: "continue", target: "Garden" }],
  },
];

let store: StateStore;
let record: EventRecord;
let story: Story;
const begin = () => {
  store = createStore();
  record = createEventRecord(store);
  story = createStory(store, record, passages, { start: "Garden" });
};
beforeEach(() => {
  begin();
  story.begin();
});
const choose = (label: string) => {
  const c = story
    .render()
    .choices.find((x) => (x.type === "continue" ? "Continue" : x.label) === label);
  if (!c) throw new Error(`no ${label}`);
  story.follow(c);
};
const visit = (label: string) => {
  choose(label);
  choose("Continue");
};
const told = () => record.events({ kinds: ["scheduled"] }).map((e) => e.text);

describe("relationships", () => {
  it("are directed pairs of minds, in declared dimensions, starting as story.ts says", () => {
    // #region pairs
    expect(relationship(mira, you)).toEqual({ affection: 4, trust: 2 });
    expect(relationship(you, mira)).toEqual({ affection: 0, trust: 2 }); // the other way round
    // #endregion
  });

  it("fire a threshold once as a pair crosses it, and again only after going back", () => {
    // #region smitten
    visit("Compliment her"); // 6
    visit("Compliment her"); // 8: smitten
    visit("Compliment her"); // 10, the most it can be: already smitten
    expect([relationship(mira, you).affection, told()]).toEqual([
      10,
      ["Mira can't stop smiling at you."],
    ]);
    // #endregion
    visit("Tease her"); // 7: below, so it re-arms
    visit("Compliment her"); // 9
    expect(told()).toEqual(["Mira can't stop smiling at you.", "Mira can't stop smiling at you."]);
  });

  it("fire as a value falls to a threshold", () => {
    visit("Lie to her"); // trust 0
    expect([relationship(mira, you).trust, told()]).toEqual([0, ["Mira watches you warily now."]]);
  });

  it("are undone and replayed with the game", () => {
    const history = createHistory(store);
    history.checkpoint("begun");
    visit("Compliment her");
    visit("Compliment her");
    history.checkpoint("smitten");
    history.undo();
    expect(relationship(mira, you).affection).toBe(4);
    history.redo();
    const replay = readReplay(writeReplay(story.toReplay()));
    const before = told();
    begin();
    story.playReplay(replay);
    expect([relationship(mira, you).affection, told()]).toEqual([8, before]);
  });

  it("explain a dimension that isn't declared", () => {
    expect(() => changeRelationship(mira, you, { charm: 1 } as never)).toThrow(
      'there\'s no relationship dimension "charm"',
    );
  });
});
