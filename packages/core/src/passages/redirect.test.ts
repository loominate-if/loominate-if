import { describe, expect, it } from "vitest";
import { createEventRecord, type EventRecord } from "../events/record.js";
import { readReplay, writeReplay } from "../replay/replay.js";
import { createHistory } from "../state/history.js";
import { createStore, type StateStore } from "../state/store.js";
import { createStory, redirect, type Passage, type Story } from "./story.js";

let floorRotten = true;
const passages: Passage[] = [
  {
    id: "Hall",
    tags: [],
    body: () => [
      { type: "text", text: "A hall." },
      { type: "link", label: "Cross the floor", target: "Landing" },
      { type: "link", label: "Loop", target: "Loop A" },
    ],
  },
  {
    id: "Landing",
    tags: [],
    effects: {
      // #region trapdoor
      enter: ({ emit }) => {
        if (floorRotten) {
          emit("perception", { text: "The floor gives way!", sense: "see" });
          redirect("Cellar");
        }
      },
      // #endregion
    },
    body: () => [{ type: "text", text: "A landing." }],
  },
  {
    id: "Cellar",
    tags: [],
    body: () => [{ type: "text", text: "You land in the cellar." }],
  },
  { id: "Loop A", tags: [], effects: { enter: () => redirect("Loop B") }, body: () => [] },
  { id: "Loop B", tags: [], effects: { enter: () => redirect("Loop A") }, body: () => [] },
];

let store: StateStore;
let record: EventRecord;
const begin = (): Story => {
  store = createStore();
  record = createEventRecord(store);
  const story = createStory(store, record, passages, { start: "Hall" });
  return story;
};
const choose = (story: Story, label: string) => {
  const c = story.render().choices.find((x) => x.label === label);
  if (!c) throw new Error(`no ${label}`);
  story.follow(c);
};

describe("redirect", () => {
  it("sends the player on once the move is done, as part of the same move", () => {
    const story = begin();
    story.begin();
    const history = createHistory(store);
    history.checkpoint("begun");
    choose(story, "Cross the floor");
    history.checkpoint("fell");
    expect(story.current).toBe("Cellar");
    expect(story.moves).toBe(1);
    const nav = record
      .events({ kinds: ["navigation"] })
      .map((e) => `${e.to}${e.redirected === true ? " (redirected)" : ""}`);
    expect(nav).toEqual(["Hall", "Landing", "Cellar (redirected)"]);
    history.undo();
    expect(story.current).toBe("Hall");
    history.redo();
    expect(story.current).toBe("Cellar");
  });

  it("is replayed the same way", () => {
    const story = begin();
    story.begin();
    choose(story, "Cross the floor");
    const replay = readReplay(writeReplay(story.toReplay()));
    const again = begin();
    again.playReplay(replay);
    expect(again.current).toBe("Cellar");
  });

  it("explains a redirect outside a move, or one that loops", () => {
    expect(() => {
      redirect("Cellar");
    }).toThrow('redirect "Cellar": there\'s no move to redirect.');
    const story = begin();
    story.begin();
    store.commit();
    expect(() => {
      choose(story, "Loop");
    }).toThrow("passages are probably redirecting to each other");
    expect(story.current).toBe("Hall"); // the move is rolled back
    floorRotten = false;
    choose(story, "Cross the floor");
    expect(story.current).toBe("Landing"); // nothing left over from the failed move
  });
});
