import {
  createEventRecord,
  createHistory,
  createStore,
  createStory,
  type StateStore,
} from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  actor,
  attitude,
  attitudeTo,
  changeAttitude,
  disguise,
  disguisedAs,
  expose,
  leaveBody,
  mind,
  place,
  possess,
  seesThrough,
  setAttitude,
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
/** What the guard says to whoever he takes `someone` for. */
export const greeting = (someone: typeof roy): string => {
  const feeling = attitudeTo(guard, someone);
  return feeling > 0
    ? "“Evening, sir. Go on through.”"
    : feeling < 0
      ? "“You. Turn around.”"
      : "“State your business.”";
};
// #endregion
startAs(roy);

let store: StateStore;
beforeEach(() => {
  store = createStore();
  createStory(store, createEventRecord(store), [{ id: "Start", tags: [], body: () => [] }], {
    start: "Start",
  }).begin();
  setAttitude(guard, captain, 5);
  setAttitude(guard, roy, -3);
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
    expect(attitude(guard, roy)).toBe(-3); // how he feels about Roy hasn't changed
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

  it("keeps attitudes by mind, and is undone with the game", () => {
    const history = createHistory(store);
    history.checkpoint("begun");
    expect(changeAttitude(guard, roy, 4)).toBe(1);
    disguise(roy, { as: captain });
    history.checkpoint("changed");
    history.undo();
    expect([attitude(guard, roy), disguisedAs(roy)]).toEqual([-3, undefined]);
  });

  it("explains a disguise for something that isn't a body", () => {
    expect(() => {
      disguise(gate, { as: captain });
    }).toThrow('disguise: "gate" isn\'t a body.');
  });
});
