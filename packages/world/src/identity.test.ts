import {
  createEventRecord,
  createHistory,
  createStore,
  createStory,
  type StateStore,
} from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";

declare module "@loominate-if/world" {
  interface Dimensions {
    regard: true;
  }
}
import {
  actor,
  disguise,
  disguisedAs,
  expose,
  leaveBody,
  mind,
  place,
  possess,
  changeRelationship,
  relationship,
  relationships,
  relationshipTo,
  setRelationship,
  seesThrough,
  startAs,
  undisguise,
  whoIs,
  type Mind,
} from "./index.js";

const gate = place("gate", { name: "gate" });
// #region people
export const roy = actor("roy", { body: { name: "Roy", isProper: true, location: gate } });
export const captain = actor("captain", { body: { name: "captain", location: gate } });
export const guard = actor("guard", { body: { name: "guard", location: gate } });
export const bob = mind("bob", { name: "Bob" });
relationships({ regard: {} });
// In story.ts, as the game loads, these set how things start.
setRelationship(guard, captain, { regard: 5 });
setRelationship(guard, roy, { regard: -3 });
/** What the guard says to whoever he takes `someone` for. */
export const greeting = (someone: typeof roy): string => {
  const feeling = relationshipTo(guard, someone).regard;
  return feeling > 0
    ? "“Evening, sir. Go on through.”"
    : feeling < 0
      ? "“You. Turn around.”"
      : "“State your business.”";
};
// #endregion
/** A spy, who starts the game disguised as the captain. */
const spy = actor("spy", { body: { name: "spy", location: gate } });
disguise(spy, { as: captain });
startAs(roy);

let store: StateStore;
beforeEach(() => {
  store = createStore();
  createStory(store, createEventRecord(store), [{ id: "Start", tags: [], body: () => [] }], {
    start: "Start",
  }).begin();
});
const name = (m: Mind | undefined) => m?.id ?? "a stranger";

describe("perceived identity", () => {
  it("a disguise changes who an NPC believes they face, and so what they do, not how they feel", () => {
    // #region disguise
    expect([name(whoIs(guard, roy)), greeting(roy)]).toEqual(["roy:mind", "“You. Turn around.”"]);
    disguise(roy, { as: captain });
    expect([name(whoIs(guard, roy)), greeting(roy)]).toEqual([
      "captain:mind",
      "“Evening, sir. Go on through.”",
    ]);
    expect(relationship(guard, roy).regard).toBe(-3); // how he feels about Roy hasn't changed
    // #endregion
    expect(seesThrough(guard, roy)).toBe(false);
  });

  it("is seen through once exposed, and a new disguise fools them again", () => {
    disguise(roy, { as: captain });
    // #region expose
    expose(roy, guard);
    expect([name(whoIs(guard, roy)), greeting(roy), seesThrough(guard, roy)]).toEqual([
      "roy:mind",
      "“You. Turn around.”",
      true,
    ]);
    disguise(roy, { as: "a hooded figure" });
    expect([name(whoIs(guard, roy)), greeting(roy)]).toEqual([
      "a stranger",
      "“State your business.”",
    ]);
    // #endregion
    expect(disguisedAs(roy)).toBe("a hooded figure");
    undisguise(roy);
    expect(name(whoIs(guard, roy))).toBe("roy:mind");
  });

  it("takes a body for whoever it belongs to, whichever mind possesses it, until they learn", () => {
    // #region possession
    possess(bob, roy);
    expect(name(whoIs(guard, roy))).toBe("roy:mind"); // the guard sees Roy's body
    expose(roy, guard);
    expect(name(whoIs(guard, roy))).toBe("bob");
    // #endregion
    leaveBody(bob);
    expect(name(whoIs(guard, roy))).toBe("roy:mind");
  });

  it("keeps relationships by mind, and is undone with the game", () => {
    const history = createHistory(store);
    history.checkpoint("begun");
    expect(changeRelationship(guard, roy, { regard: 4 }).regard).toBe(1);
    disguise(roy, { as: captain });
    history.checkpoint("changed");
    history.undo();
    expect([relationship(guard, roy).regard, disguisedAs(roy)]).toEqual([-3, undefined]);
  });

  it("starts as story.ts sets it, in every new game, under what changes in play", () => {
    expect([relationship(guard, captain).regard, name(whoIs(guard, spy))]).toEqual([
      5,
      "captain:mind",
    ]);
    setRelationship(guard, captain, { regard: 0 });
    undisguise(spy);
    expect([relationship(guard, captain).regard, name(whoIs(guard, spy))]).toEqual([0, "spy:mind"]);
    const again = createStore(); // a new game
    createStory(again, createEventRecord(again), [{ id: "Start", tags: [], body: () => [] }], {
      start: "Start",
    }).begin();
    expect([relationship(guard, captain).regard, name(whoIs(guard, spy))]).toEqual([
      5,
      "captain:mind",
    ]);
  });

  it("explains a disguise for something that isn't a body", () => {
    expect(() => {
      disguise(gate, { as: captain });
    }).toThrow('disguise: "gate" isn\'t a body.');
  });
});
