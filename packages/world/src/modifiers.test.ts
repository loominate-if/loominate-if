import {
  createEventRecord,
  createHistory,
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
  baseStat,
  clock,
  minutes,
  modifiersOf,
  modify,
  moves,
  place,
  startAs,
  stat,
  stats,
  swapBodies,
  unmodify,
} from "./index.js";

declare module "@loominate-if/world" {
  interface Stats {
    strength: true;
    wits: true;
  }
}
stats({ strength: { on: "body", start: 2, min: 0, max: 10 }, wits: { on: "mind", start: 3 } });

const yard = place("yard", { name: "yard" });
export const you = actor("you", { body: { name: "you", location: yard } });
export const ox = actor("ox", { body: { name: "ox", location: yard } });
startAs(you);
// #region curse
modify(ox, "wits", { by: -1, from: "curse" }); // the ox starts cursed
// #endregion

const passages: Passage[] = [
  { id: "Yard", tags: [], body: () => [{ type: "link", label: "Look", target: "Yard" }] },
];
let store: StateStore;
let record: EventRecord;
let story: Story;
beforeEach(() => {
  store = createStore();
  record = createEventRecord(store);
  story = createStory(store, record, passages, { start: "Yard" });
  story.begin();
});
const told = () => record.events({ kinds: ["scheduled"] }).map((e) => e.text);
const look = () => {
  story.follow({ type: "link", label: "Look", target: "Yard" });
};

describe("modifiers", () => {
  it("add, then multiply, from their sources, within the stat's limits", () => {
    // #region modify
    modify(you, "strength", {
      by: 2,
      from: "potion",
      lasts: minutes(30),
      wearsOff: "The potion's warmth fades.",
    });
    modify(you, "strength", { times: 0.5, from: "poison" });
    expect([stat(you, "strength"), baseStat(you, "strength")]).toEqual([2, 2]); // (2 + 2) × 0.5
    unmodify(you, "strength", "poison");
    expect(stat(you, "strength")).toBe(4);
    // #endregion
    modify(you, "strength", { by: 20, from: "giant's brew" });
    expect(stat(you, "strength")).toBe(10); // still within its limits
  });

  it("replace one from the same source, and wear off by the clock, telling the player", () => {
    modify(you, "strength", {
      by: 2,
      from: "potion",
      lasts: minutes(30),
      wearsOff: "The potion's warmth fades.",
    });
    clock.advance(20);
    // #region refresh
    modify(you, "strength", {
      by: 2,
      from: "potion",
      lasts: minutes(30),
      wearsOff: "The potion's warmth fades.",
    });
    expect(stat(you, "strength")).toBe(4); // refreshed, not doubled
    clock.advance(29);
    expect(stat(you, "strength")).toBe(4);
    clock.advance(1); // 30 minutes after the second potion
    expect([stat(you, "strength"), modifiersOf(you, "strength"), told()]).toEqual([
      2,
      [],
      ["The potion's warmth fades."],
    ]);
    // #endregion
  });

  it("wear off after a number of moves", () => {
    modify(you, "strength", { by: 1, from: "adrenaline", lasts: moves(2) });
    look();
    expect(stat(you, "strength")).toBe(3);
    look();
    expect(stat(you, "strength")).toBe(2);
  });

  it("are kept with their stat: a mental one travels with the mind, and can start the game", () => {
    expect(stat(ox, "wits")).toBe(2); // 3, cursed
    modify(you, "wits", { by: 5, from: "insight" });
    swapBodies(you, ox);
    expect(stat(ox, "wits")).toBe(8); // your mind, and its insight, in the ox's body
    expect(stat(you, "wits")).toBe(2); // the ox's cursed mind in yours
  });

  it("are undone with the game", () => {
    const history = createHistory(store);
    history.checkpoint("begun");
    modify(you, "strength", { by: 3, from: "potion" });
    history.checkpoint("drank");
    history.undo();
    expect(modifiersOf(you, "strength")).toEqual([]);
  });
});
