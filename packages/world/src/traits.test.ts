import {
  action,
  actionsFor,
  createEventRecord,
  createHistory,
  createStore,
  createStory,
  statusOf,
  t,
  type StateStore,
} from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import { actor, mind, mindOf, place, possess, startAs, thing } from "./index.js";

const hall = place("hall", { name: "hall" });
// #region things
export const sword = thing("sword", {
  name: "sword",
  location: hall,
  isCursed: true, // a flag
  weight: 3, // a value
  tags: ["silver", "old"] as string[], // a set of tags
});
// #endregion
// #region actors
export const mira = actor("mira", {
  body: { name: "Mira", isProper: true, location: hall, strength: 2 }, // build stays with the body
  mind: { courage: 3, quirks: ["hums when nervous"] as string[] }, // personality travels with the mind
});
export const ghost = mind("ghost", { name: "ghost", courage: 9, quirks: [] as string[] });
// #endregion
startAs(mira);

// #region action
export const wield = action<{ thing: typeof sword }>("wield", {
  on: sword,
  label: "Wield the sword",
  check: ({ thing }) =>
    thing.isCursed && !thing.tags.includes("blessed")
      ? "The cursed blade burns your hand."
      : undefined,
  report: "You lift the sword.",
});
// #endregion

let store: StateStore;
beforeEach(() => {
  store = createStore();
  createStory(store, createEventRecord(store), [{ id: "Start", tags: [], body: () => [] }], {
    start: "Start",
  }).begin();
});

describe("traits", () => {
  it("are typed properties on any object: flags, values, and tags, which actions and text test", () => {
    const [call] = actionsFor(sword).filter((c) => c.action === (wield as unknown));
    if (!call) throw new Error("no wield");
    expect(statusOf(call).disabled).toBe("The cursed blade burns your hand.");
    // #region bless
    sword.tags = [...sword.tags, "blessed"];
    // #endregion
    expect(statusOf(call).disabled).toBeUndefined();
    expect(t`The ${() => (sword.weight > 2 ? "heavy" : "light")} sword.`()).toBe(
      "The heavy sword.",
    );
  });

  it("are state: undone and saved like any other", () => {
    const history = createHistory(store);
    history.checkpoint("begun");
    sword.isCursed = false;
    mira.courage += 1;
    history.checkpoint("changed");
    history.undo();
    expect([sword.isCursed, mira.courage]).toEqual([true, 3]);
  });

  it("go on the half of an actor they belong to: the mind's travel with it", () => {
    // #region possession
    possess(ghost, mira);
    expect(mira.strength).toBe(2); // Mira's body is as strong as ever
    expect(mindOf(mira)?.id).toBe("ghost");
    expect((mindOf(mira) as unknown as { courage: number }).courage).toBe(9); // whoever's in it is bold
    expect(mira.courage).toBe(3); // Mira's own courage, wherever her mind is
    // #endregion
  });
});
