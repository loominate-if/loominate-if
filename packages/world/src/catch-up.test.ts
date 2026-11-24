import {
  createEventRecord,
  createStore,
  createStory,
  type EventRecord,
  type Passage,
  type StateStore,
  type Story,
} from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  actor,
  catchUp,
  clock,
  connect,
  enterRoom,
  everyTurn,
  move,
  place,
  registerRoom,
  startAs,
  startClock,
  thing,
  type Place,
} from "./index.js";

const hall = place("hall", { name: "hall" });
const study = place("study", { name: "study" });
connect(hall, { east: study });
connect(study, { west: hall });
const you = actor("you", { body: { name: "you", location: study } });
const butler = actor("butler", { body: { name: "butler", location: hall } });
const cake = thing("cake", { name: "cake", location: hall });
startAs(you);
startClock({ at: "20:00" });

const caught: { minutes: number; moves: number }[] = [];
const turns: string[] = [];
// #region catch-up
catchUp(butler, "tidied the hall", ({ npc, minutes, moves }) => {
  caught.push({ minutes, moves });
  // Long enough away, and the hall got tidied, unseen.
  if (minutes >= 30 && cake.location?.id === "hall") move(cake, npc);
});
// #endregion
everyTurn(butler, "notes the turn", () => {
  turns.push("turn");
});

const room = (id: string, r: Place, way: string, to: string): Passage => {
  registerRoom(r, { id, tags: [`room: ${r.id}`] });
  return {
    id,
    tags: [`room: ${r.id}`],
    effects: { enter: () => enterRoom(r) },
    body: () => [
      { type: "link", label: way, target: to },
      { type: "link", label: "Wait", target: id },
    ],
  };
};
const passages = [room("Hall", hall, "East", "Study"), room("Study", study, "West", "Hall")];

let store: StateStore;
let record: EventRecord;
let story: Story;
beforeEach(() => {
  caught.length = 0;
  turns.length = 0;
  store = createStore();
  record = createEventRecord(store);
  story = createStory(store, record, passages, { start: "Study", seed: "s" });
  story.begin();
});
const go = (label: string, target: string) => {
  story.follow({ type: "link", label, target });
};

describe("catching up an unseen NPC (#356)", () => {
  it("works out what they did while unseen, once, before their next turn", () => {
    go("Wait", "Study");
    clock.advance(40);
    go("Wait", "Study");
    expect(caught).toEqual([]); // unseen: no turn, no catching up yet
    go("West", "Hall");
    expect(caught).toEqual([{ minutes: 40, moves: 3 }]);
    // For the inspector's timeline (#108), never shown on the page.
    expect(
      record.events({ kinds: ["npc"] }).map((e) => [e.npc, e.what, e.minutes, e.moves]),
    ).toEqual([["butler:mind", "caughtUp", 40, 3]]);
    expect(cake.location?.id).toBe("butler"); // moved directly, not narrated
    expect(record.events({ kinds: ["perception"] }).map((e) => e.text)).not.toContain(
      "The butler takes the cake.",
    );
    expect(turns).toEqual(["turn"]);
    go("Wait", "Hall");
    expect(caught).toHaveLength(1); // seen all along since: no more catching up
    expect(turns).toEqual(["turn", "turn"]);
  });

  it("doesn't catch up an NPC who was in view all along", () => {
    go("West", "Hall");
    caught.length = 0;
    go("Wait", "Hall");
    go("Wait", "Hall");
    expect(caught).toEqual([]);
  });

  it("gives the same state for the same moves (determinism)", () => {
    go("Wait", "Study");
    go("West", "Hall");
    const snapshot = store.snapshot();
    const again = createStore();
    createStory(again, createEventRecord(again), passages, { start: "Study" }).playReplay(
      story.toReplay(),
    );
    expect(again.snapshot()).toEqual(snapshot);
  });
});
