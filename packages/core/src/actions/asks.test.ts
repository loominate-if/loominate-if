import { describe, expect, it } from "vitest";
import { createEventRecord } from "../events/record.js";
import { object } from "../objects/objects.js";
import { createStory } from "../passages/story.js";
import { createStore } from "../state/store.js";
import { action, perform, statusOf } from "./actions.js";

const purse = object("purse", { coins: 12 });
const table = object("table", { pot: 0 });

// #region asks
export const bet = action<{ thing: typeof table; coins: number }>("bet", {
  on: table,
  label: "Bet some coins…",
  asks: { coins: { label: "How many coins?", min: 1, max: () => purse.coins, start: 2 } },
  confirm: "Bet",
  run: ({ coins }) => {
    purse.coins -= coins;
    table.pot += coins;
  },
  report: ({ coins }) => `You push ${String(coins)} coins into the pot.`,
});
// #endregion
const shrug = action<{ thing: typeof table }>("shrug", { on: table, label: "Shrug" });

const begin = () => {
  const store = createStore();
  createStory(store, createEventRecord(store), [{ id: "Start", tags: [], body: () => [] }], {
    start: "Start",
  }).begin();
};

describe("actions that ask for numbers", () => {
  it("say what they ask for, with limits worked out now, and the button that takes them", () => {
    begin();
    expect(statusOf(bet({ thing: table } as never))).toEqual({
      label: "Bet some coins…",
      asks: [{ name: "coins", label: "How many coins?", min: 1, max: 12, start: 2 }],
      confirm: "Bet",
    });
    // An action that asks for nothing says nothing about it.
    expect(statusOf(shrug({ thing: table }))).toEqual({ label: "Shrug" });
  });

  it("are taken with the number given, and refuse one that's missing or out of its limits", () => {
    begin();
    expect(perform(bet({ thing: table, coins: 5 })).done).toBe(true);
    expect([purse.coins, table.pot]).toEqual([7, 5]);
    expect(() => perform(bet({ thing: table, coins: 8 }))).toThrow(
      'action "bet": coins must be a whole number from 1 to 7, not 8.',
    );
    expect(() => perform(bet({ thing: table } as never))).toThrow(
      "from 1 to 7, and none was given.",
    );
    expect(() => perform(bet({ thing: table, coins: 1.5 }))).toThrow("not 1.5");
  });
});
