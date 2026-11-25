/** NPCs telling each other (#390, ADR 0110): tell through actAs, and facts that spread as gossip. */
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
  defineFacts,
  enterRoom,
  place,
  player,
  registerRoom,
  simulate,
  startAs,
  tell,
  type Place,
} from "./index.js";

const kitchen = place("kitchen", { name: "kitchen" });
const parlour = place("parlour", { name: "parlour" });
connect(kitchen, { east: parlour });
connect(parlour, { west: kitchen });
const you = actor("you", { body: { name: "you", location: kitchen } });
const marta = actor("marta", { body: { name: "Marta", location: kitchen } });
const tobias = actor("tobias", { body: { name: "Tobias", location: kitchen } });
// In the parlour, two who are simulated: they act, and gossip, unseen.
const ada = actor("ada", { body: { name: "Ada", location: parlour } });
const bea = actor("bea", { body: { name: "Bea", location: parlour } });
simulate(ada);
simulate(bea);
startAs(you);
// #region gossip
export const facts = defineFacts({
  // Gossip: it passes by itself between NPCs together.
  affair: { text: "The colonel and the cook are lovers.", spreads: true },
  // Told only on purpose.
  will: "The will was changed last week.",
});
// #endregion

const room = (id: string, r: Place): Passage => {
  registerRoom(r, { id, tags: [`room: ${r.id}`] });
  return {
    id,
    tags: [`room: ${r.id}`],
    effects: { enter: () => enterRoom(r) },
    body: () => [{ type: "link", label: "Wait", target: id }],
  };
};
const passages = [room("Kitchen", kitchen), room("Parlour", parlour)];
let store: StateStore;
let record: EventRecord;
let story: Story;
const begin = (at = "Kitchen") => {
  store = createStore();
  record = createEventRecord(store);
  story = createStory(store, record, passages, { start: at });
  story.begin();
};
beforeEach(() => {
  begin();
});
const wait = () => {
  story.follow({ type: "link", label: "Wait", target: story.current ?? "Kitchen" });
};
const noticed = () => record.events({ kinds: ["perception"] }).map((e) => e.text);
const told = () =>
  record
    .events({ kinds: ["npc"] })
    .filter((e) => e.what === "told")
    .map((e) => [e.npc, e.to, e.fact, e.perceived]);

describe("NPCs telling each other (#390)", () => {
  it("tell, taken as an NPC, teaches the hearer, from the teller, and the player sees them talk", () => {
    marta.learn(facts.will);
    // #region tell
    const outcome = actAs(marta, tell({ who: tobias, about: facts.will.id }));
    // #endregion
    expect(outcome.done).toBe(true);
    expect([tobias.knows(facts.will), tobias.sourceOf(facts.will)?.from?.id]).toEqual([
      true,
      "marta",
    ]);
    expect(noticed()).toEqual(["Marta whispers something to Tobias."]);
    // The player sees them talk, but doesn't learn what was said.
    expect(player.knows(facts.will)).toBe(false);
  });

  it("isn't taken for a fact the teller doesn't know, or a hearer who isn't there", () => {
    expect(actAs(marta, tell({ who: tobias, about: facts.will.id }))).toEqual({
      done: false,
      reason: "Marta doesn't know that.",
    });
    marta.learn(facts.will);
    expect(actAs(marta, tell({ who: ada, about: facts.will.id })).reason).toBe("Ada isn't there.");
  });

  it("spreads gossip between NPCs together who get a turn, told once a move for each pair", () => {
    marta.learn(facts.affair);
    marta.learn(facts.will);
    wait();
    expect([tobias.knows(facts.affair), tobias.sourceOf(facts.affair)?.from?.id]).toEqual([
      true,
      "marta",
    ]);
    // Only what spreads.
    expect(tobias.knows(facts.will)).toBe(false);
    expect(noticed()).toEqual(["Marta whispers something to Tobias."]);
    expect(told()).toEqual([["marta:mind", "tobias:mind", "affair", true]]);
    expect(player.knows(facts.affair)).toBe(false);
  });

  it("leaves two who don't both get a turn: unseen, and not simulated", () => {
    begin("Parlour");
    marta.learn(facts.affair);
    wait();
    expect(tobias.knows(facts.affair)).toBe(false);
  });

  it("spreads among simulated NPCs offstage, unseen and untold", () => {
    ada.learn(facts.affair);
    wait();
    expect(bea.knows(facts.affair)).toBe(true);
    expect(told()).toEqual([["ada:mind", "bea:mind", "affair", false]]);
    expect(noticed()).not.toContain("Ada whispers something to Bea.");
  });

  it("spreads the same way for the same moves (determinism)", () => {
    marta.learn(facts.affair);
    ada.learn(facts.affair);
    wait();
    wait();
    const snapshot = store.snapshot();
    begin();
    marta.learn(facts.affair);
    ada.learn(facts.affair);
    wait();
    wait();
    expect(store.snapshot()).toEqual(snapshot);
  });
});
