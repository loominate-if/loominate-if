import {
  action,
  createEventRecord,
  createHistory,
  createStore,
  createStory,
  statusOf,
  type StateStore,
} from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  actor,
  canSpend,
  changeStat,
  place,
  restore,
  setStat,
  spend,
  startAs,
  stat,
  stats,
  swapBodies,
} from "./index.js";

// #region stats
declare module "@loominate-if/world" {
  interface Stats {
    strength: true;
    wits: true;
    energy: true;
    carry: true;
  }
}
stats({
  strength: { on: "body", start: 2, min: 0, max: 10 },
  wits: { on: "mind", start: 3 },
  energy: { on: "body", resource: true, start: 4, max: (who) => 5 + stat(who, "strength") },
  carry: { derived: (who) => stat(who, "strength") * 5 },
});
// #endregion

const yard = place("yard", { name: "yard" });
export const you = actor("you", { body: { name: "you", location: yard } });
export const ox = actor("ox", { body: { name: "ox", location: yard } });
startAs(you);
// #region starting
setStat(ox, "strength", 9); // an ox's body is strong
setStat(ox, "wits", 1); // and its mind, slow
// #endregion

// #region spend
export const haul = action<{ thing: typeof ox }>("haul", {
  label: "Haul the cart",
  check: ({ body }) => (body ? canSpend(body, "energy", 3) : undefined),
  run: ({ body }) => {
    if (body) spend(body, "energy", 3);
  },
  report: "You haul the cart across the yard.",
});
// #endregion

let store: StateStore;
beforeEach(() => {
  store = createStore();
  createStory(store, createEventRecord(store), [{ id: "Start", tags: [], body: () => [] }], {
    start: "Start",
  }).begin();
});

describe("stats", () => {
  it("start as declared and as story.ts sets them, kept within their limits", () => {
    expect([
      stat(you, "strength"),
      stat(you, "wits"),
      stat(ox, "strength"),
      stat(ox, "wits"),
    ]).toEqual([2, 3, 9, 1]);
    expect(changeStat(you, "strength", 20)).toBe(10); // the most it can be
    expect(stat(you, "carry")).toBe(50); // derived from strength
    expect(() => setStat(you, "carry", 1)).toThrow("worked out from other stats");
  });

  it("move with the mind when it's mental, and stay with the body when it's physical", () => {
    // #region swap
    swapBodies(you, ox);
    expect(stat(you, "strength")).toBe(2); // your old body, as weak as ever
    expect(stat(you, "wits")).toBe(1); // but the ox's mind is in it now
    expect(stat(ox, "wits")).toBe(3); // and yours is in the ox: strong and clever
    // #endregion
    expect(stat(ox, "strength")).toBe(9);
  });

  it("can be spent as resources, with why not, up to a max worked out from other stats", () => {
    const call = haul({ thing: ox });
    expect(statusOf(call).disabled).toBeUndefined();
    spend(you, "energy", 3);
    expect(statusOf(call).disabled).toBe("You don't have enough energy.");
    expect(canSpend(ox, "energy", 5)).toBe("The ox doesn't have enough energy.");
    expect(restore(you, "energy", 100)).toBe(7); // max: 5 + strength 2
    expect(() => spend(you, "wits", 1)).toThrow('"wits" isn\'t a resource');
  });

  it("are undone with the game", () => {
    const history = createHistory(store);
    history.checkpoint("begun");
    changeStat(you, "wits", 2);
    history.checkpoint("smarter");
    history.undo();
    expect(stat(you, "wits")).toBe(3);
  });
});
