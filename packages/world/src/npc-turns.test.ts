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
  actAs,
  actor,
  connect,
  enterRoom,
  everyTurn,
  getsTurn,
  isSimulated,
  place,
  registerRoom,
  simulate,
  startAs,
  take,
  thing,
  type Place,
} from "./index.js";

const hall = place("hall", { name: "hall" });
const study = place("study", { name: "study" });
const vault = place("vault", { name: "vault" });
connect(hall, { east: study });
connect(study, { west: hall });
const you = actor("you", { body: { name: "you", location: hall } });
const butler = actor("butler", { body: { name: "butler", location: hall } });
const villain = actor("villain", { body: { name: "villain", location: vault } });
const cake = thing("cake", { name: "cake", location: hall });
const gold = thing("gold", { name: "gold", location: vault });
startAs(you);

// #region turns
everyTurn(butler, "tidies the hall", ({ npc }) => {
  if (cake.location?.id === "hall") actAs(npc, take({ thing: cake }));
});
// The villain is simulated: they act wherever they are.
simulate(villain);
everyTurn(villain, "steals", ({ npc }) => {
  if (gold.location?.id === "vault") actAs(npc, take({ thing: gold }));
});
// #endregion

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
const start = (from: string) => {
  store = createStore();
  record = createEventRecord(store);
  story = createStory(store, record, passages, { start: from, seed: "s" });
  story.begin();
};
beforeEach(() => {
  start("Study");
});
const go = (label: string, target: string) => {
  story.follow({ type: "link", label, target });
};
const noticed = () => record.events({ kinds: ["perception"] }).map((e) => e.text);

describe("NPC turns and simulation levels (#104)", () => {
  it("leave an observed-only NPC idle while the player can't see or hear them", () => {
    go("Wait", "Study");
    expect([getsTurn(butler), cake.location?.id]).toEqual([false, "hall"]);
  });

  it("give them a turn after each move while the player perceives them, narrated", () => {
    go("West", "Hall");
    expect(cake.location?.id).toBe("butler");
    expect(noticed()).toContain("The butler takes the cake.");
  });

  it("let a simulated NPC act wherever they are, unseen", () => {
    expect(isSimulated(villain)).toBe(true);
    go("Wait", "Study");
    expect(gold.location?.id).toBe("villain");
    expect(noticed()).not.toContain("The villain takes the gold.");
    simulate(villain, false);
    expect(isSimulated(villain)).toBe(false);
  });

  it("cost nothing for an NPC with no turn rules", () => {
    const maid = actor("maid", { body: { name: "maid", location: study } });
    go("Wait", "Study");
    expect(getsTurn(maid)).toBe(true); // in view, but with nothing to do
    expect(noticed()).toEqual([]);
  });

  it("give the same results for the same moves (determinism)", () => {
    go("West", "Hall");
    go("East", "Study");
    const snapshot = store.snapshot();
    const replay = story.toReplay();
    const again = createStore();
    createStory(again, createEventRecord(again), passages, { start: "Study" }).playReplay(replay);
    expect(again.snapshot()).toEqual(snapshot);
  });
});
