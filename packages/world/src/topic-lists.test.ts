import {
  createEventRecord,
  createStore,
  createStory,
  type ActionCall,
  type EventRecord,
  type ObjectRef,
  type Passage,
  type StateStore,
  type Story,
} from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import { actor, anything, ask, place, startAs, thing, topic, topics } from "./index.js";

const kitchen = place("kitchen", { name: "kitchen" });
const you = actor("you", { body: { name: "you", location: kitchen } });
const butler = actor("butler", { body: { name: "butler", location: kitchen } });
const maid = actor("maid", { body: { name: "maid", location: kitchen } });
const cook = actor("cook", { body: { name: "cook", location: kitchen } });
const letter = thing("letter", { name: "letter", location: kitchen });
const { weather } = topics({ weather: "the weather" });
startAs(you);

// #region lists
topic(butler, {
  ask: letter,
  says: [
    "“The letter, sir? On the desk.”",
    "“As I said, sir. On the desk.”",
    "He sighs. “The desk, sir.”",
  ], // order: "stop" by default
});
topic(maid, { ask: weather, order: "cycle", says: ["“Cold.”", "“Colder.”"] });
topic(cook, {
  askOrTell: anything,
  order: "shuffle",
  says: ["“I couldn't say.”", "She shrugs.", "“Ask the butler.”", "“Not now, dear.”"],
});
// #endregion
const gardener = actor("gardener", { body: { name: "gardener", location: kitchen } });
// #region again
topic(gardener, { ask: letter, says: "“A letter? I burned it with the leaves.”" });
topic(gardener, { ask: letter, again: true, says: "“Burned, I said.”" });
// #endregion

const passages: Passage[] = [
  { id: "Kitchen", tags: [], body: () => [{ type: "link", label: "Wait", target: "Kitchen" }] },
];
let store: StateStore;
let record: EventRecord;
let story: Story;
const begin = (seed: string) => {
  store = createStore();
  record = createEventRecord(store);
  story = createStory(store, record, passages, { start: "Kitchen", seed });
  story.begin();
};
beforeEach(() => {
  begin("s");
});
/** Asks `who` about `about` `times` times, and returns what they said, without greetings. */
const askTimes = (who: ObjectRef, about: ObjectRef, times: number): string[] => {
  const before = record.length;
  for (let i = 0; i < times; i++) {
    story.act(ask({ who, about }) as unknown as ActionCall);
  }
  return record
    .events({ kinds: ["action-result"], since: before })
    .filter((e) => !e.tags.includes("player"))
    .map((e) => e.text);
};

describe("topic event lists (#112)", () => {
  it("say each in turn, then stop at the last, by default", () => {
    expect(askTimes(butler, letter, 4)).toEqual([
      "“The letter, sir? On the desk.”",
      "“As I said, sir. On the desk.”",
      "He sighs. “The desk, sir.”",
      "He sighs. “The desk, sir.”",
    ]);
  });

  it("cycle back to the first", () => {
    expect(askTimes(maid, weather, 5)).toEqual([
      "“Cold.”",
      "“Colder.”",
      "“Cold.”",
      "“Colder.”",
      "“Cold.”",
    ]);
  });

  it("shuffle: every response once a round, and never twice running across rounds", () => {
    const said = askTimes(cook, letter, 40);
    for (let round = 0; round < 10; round++) {
      expect(new Set(said.slice(round * 4, round * 4 + 4)).size).toBe(4);
    }
    for (let i = 1; i < said.length; i++) expect(said[i]).not.toBe(said[i - 1]);
  });

  it("shuffle the same way for the same seed and moves, and replay it (determinism)", () => {
    const first = askTimes(cook, letter, 12);
    const snapshot = store.snapshot();
    const replay = story.toReplay();
    begin("s");
    expect(askTimes(cook, letter, 12)).toEqual(first);
    const again = createStore();
    createStory(again, createEventRecord(again), passages, {
      start: "Kitchen",
      seed: "s",
    }).playReplay(replay);
    expect(again.snapshot()).toEqual(snapshot);
    // Another seed, another order.
    begin("t");
    expect(askTimes(cook, letter, 12)).not.toEqual(first);
  });

  it("say what's wrong with a list", () => {
    expect(() => topic(butler, { tell: letter, says: [] })).toThrow(
      "its list of responses is empty",
    );
    expect(() => topic(butler, { tell: letter, order: "cycle", says: "Hm." })).toThrow(
      "`order` is for a list of responses",
    );
  });

  it("answer `again` entries only once the exchange has been answered, and prefer them then", () => {
    expect(askTimes(gardener, letter, 3)).toEqual([
      "“A letter? I burned it with the leaves.”",
      "“Burned, I said.”",
      "“Burned, I said.”",
    ]);
  });
});
