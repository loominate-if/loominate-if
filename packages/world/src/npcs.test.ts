import {
  createEventRecord,
  createHistory,
  createStore,
  createStory,
  type EventRecord,
  type StateStore,
} from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  actAs,
  actor,
  connect,
  door,
  give,
  go,
  lockable,
  move,
  open,
  place,
  placeOf,
  startAs,
  take,
  thing,
  unlock,
} from "./index.js";

const hall = place("hall", { name: "hall" });
const cellar = place("cellar", { name: "cellar" });
const study = place("study", { name: "study" });
// #region world
export const ironKey = thing("ironKey", { name: "iron key", location: hall });
export const cellarDoor = thing("cellarDoor", {
  ...door,
  ...lockable,
  name: "cellar door",
  key: ironKey,
  isLocked: true,
});
connect(hall, { down: { to: cellar, via: cellarDoor }, east: study });
connect(cellar, { up: { to: hall, via: cellarDoor } });
connect(study, { west: hall });
export const butler = actor("butler", { body: { name: "butler", location: hall } });
// #endregion
const you = actor("you", { body: { name: "you", location: hall } });
const tray = thing("tray", { name: "silver tray", location: butler });
startAs(you);

let store: StateStore;
let record: EventRecord;
beforeEach(() => {
  store = createStore();
  record = createEventRecord(store);
  createStory(store, record, [{ id: "Start", tags: [], body: () => [] }], {
    start: "Start",
  }).begin();
});
const noticed = () => record.events({ kinds: ["perception"] }).map((e) => e.text);
const reported = () => record.events({ kinds: ["action-result"] }).map((e) => e.text);

describe("NPCs act through the same pipeline (#106)", () => {
  it("are stopped by a locked door, with why, and nothing is narrated", () => {
    // #region locked
    const tried = actAs(butler, go({ way: "down" }));
    expect(tried).toEqual({ done: false, reason: "The cellar door is locked." });
    expect(placeOf(butler)?.id).toBe("hall");
    // #endregion
    expect(actAs(butler, unlock({ thing: cellarDoor }))).toMatchObject({ done: false });
    expect([noticed(), reported()]).toEqual([[], []]);
  });

  it("take the key, unlock and open the door, and go through, as the player sees", () => {
    // #region through
    actAs(butler, take({ thing: ironKey }));
    actAs(butler, unlock({ thing: cellarDoor }));
    actAs(butler, open({ thing: cellarDoor }));
    expect(actAs(butler, go({ way: "down" })).done).toBe(true);
    // #endregion
    expect(placeOf(butler)?.id).toBe("cellar");
    expect(noticed()).toEqual([
      "The butler takes the iron key.",
      "The butler unlocks the cellar door.",
      "The butler opens the cellar door.",
      "The butler leaves downstairs.",
    ]);
    // Their actions are theirs: nothing is reported as the player's.
    expect(reported()).toEqual([]);
  });

  it("aren't narrated when the player can't see them", () => {
    move(you, study);
    actAs(butler, take({ thing: ironKey }));
    expect(noticed()).toEqual([]);
    expect(ironKey.location?.id).toBe("butler");
  });

  it("can give the player something, which they take", () => {
    actAs(butler, give({ thing: tray, to: you }));
    expect([tray.location?.id, noticed()]).toEqual([
      "you",
      ["The butler gives the silver tray to you."],
    ]);
  });

  it("are undone with the game, and can't stand in for the player", () => {
    const history = createHistory(store);
    history.checkpoint("begun");
    actAs(butler, take({ thing: ironKey }));
    history.checkpoint("took");
    history.undo();
    expect(ironKey.location?.id).toBe("hall");
    expect(() => actAs(you, take({ thing: ironKey }))).toThrow("is the player");
  });
});
