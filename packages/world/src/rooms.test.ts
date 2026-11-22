import {
  createEventRecord,
  createHistory,
  createStore,
  createStory,
  object,
  type StateStore,
} from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  actor,
  container,
  enterRoom,
  isInLight,
  isInRegion,
  leaveBody,
  move,
  place,
  region,
  regionsOf,
  startAs,
  surface,
  thing,
  visitsTo,
} from "./index.js";

const log = object("log", { entries: [] as string[] });
const power = object("power", { isOut: false });

// #region regions
export const estate = region("estate", { name: "the estate" });
export const manor = region("manor", {
  name: "the manor",
  regions: [estate],
  roomDefaults: { isDark: true },
  onEnter() {
    log.entries.push("enter manor");
  },
  onLeave() {
    log.entries.push("leave manor");
  },
});
export const hall = place("hall", { name: "the hall", regions: [manor], isDark: false });
export const cellar = place("cellar", { name: "the cellar", regions: [manor] });
export const garden = place("garden", { name: "the garden", regions: [estate] });
// #endregion
const lane = place("lane", { name: "the lane" });
const wing = region("wing", {
  name: "the east wing",
  regions: [manor],
  // #region dynamic-default
  roomDefaults: {
    get isDark(): boolean {
      return power.isOut;
    },
  },
  // #endregion
  onEnter() {
    log.entries.push("enter wing");
  },
  onLeave() {
    log.entries.push("leave wing");
  },
});
const gallery = place("gallery", { name: "the gallery", regions: [wing] });
const chair = thing("chair", { ...surface, name: "armchair", location: hall });
const cart = thing("cart", { ...container, name: "garden cart", location: garden });

const you = actor("you", { body: { name: "you", location: lane } });
startAs(you);

let store: StateStore;
beforeEach(() => {
  store = createStore();
  createStory(store, createEventRecord(store), [{ id: "Start", tags: [], body: () => [] }], {
    start: "Start",
  });
});

const ids = (list: readonly { id: string }[]) => list.map((r) => r.id);

describe("regions", () => {
  it("hold rooms and other regions, and nest", () => {
    expect(ids(regionsOf(cellar))).toEqual(["estate", "manor"]);
    expect(ids(regionsOf(gallery))).toEqual(["estate", "manor", "wing"]);
    expect(ids(regionsOf(wing))).toEqual(["estate", "manor"]);
    expect(regionsOf(lane)).toEqual([]);
    expect(isInRegion(gallery, estate)).toBe(true);
    expect(isInRegion(garden, manor)).toBe(false);
    expect(isInRegion(chair, manor)).toBe(true);
  });

  it("give member rooms defaults, which a room's own setting overrides", () => {
    expect(cellar.isDark).toBe(true);
    expect(hall.isDark).toBe(false);
    expect(garden.isDark).toBe(false);
  });

  it("give defaults that follow state, through getters", () => {
    move(you, gallery);
    expect(isInLight(you)).toBe(true);
    power.isOut = true;
    expect(gallery.isDark).toBe(true);
    expect(isInLight(you)).toBe(false);
  });

  it("explain what isn't a region", () => {
    expect(() => place("shed", { name: "the shed", regions: [hall] })).toThrow(
      'place "shed": "hall" isn\'t a region. Define it with region().',
    );
    expect(() => region("annex", { name: "the annex", regions: [garden] })).toThrow(
      'region "annex": "garden" isn\'t a region. Define it with region().',
    );
  });
});

describe("entering rooms", () => {
  it("moves the player into the room and counts the visit", () => {
    // #region enter
    enterRoom(cellar);
    expect(you.location?.id).toBe("cellar");
    expect(visitsTo(cellar)).toBe(1);
    // #endregion
    enterRoom(hall);
    enterRoom(cellar);
    expect(visitsTo(cellar)).toBe(2);
    expect(visitsTo(garden)).toBe(0);
    expect(store.entity("world:visits")).toEqual({ counts: { cellar: 2, hall: 1 } });
  });

  it("counts a visit without moving a player already there, even sitting in something", () => {
    move(you, hall);
    move(you, chair);
    enterRoom(hall);
    expect(you.location?.id).toBe("chair");
    expect(visitsTo(hall)).toBe(1);
  });

  it("is undone with the move", () => {
    const history = createHistory(store);
    enterRoom(cellar);
    history.checkpoint("cellar");
    enterRoom(garden);
    history.checkpoint("garden");
    history.undo();
    expect(you.location?.id).toBe("cellar");
    expect(visitsTo(garden)).toBe(0);
  });

  it("explains a player with no body", () => {
    leaveBody(you);
    expect(() => {
      enterRoom(cellar);
    }).toThrow(
      "[room: cellar]: the player's mind is in no body, so it can't enter the room. Put it in one with possess().",
    );
  });
});

describe("region hooks", () => {
  it("run when the player crosses a region's edge, inner regions inside outer ones", () => {
    enterRoom(hall);
    enterRoom(gallery);
    enterRoom(cellar);
    enterRoom(lane);
    expect(log.entries).toEqual(["enter manor", "enter wing", "leave wing", "leave manor"]);
  });

  it("don't run for moves inside a region, or for other things", () => {
    move(you, hall);
    log.entries = [];
    move(you, cellar);
    move(chair, lane);
    expect(log.entries).toEqual([]);
  });

  it("run when the player is carried across", () => {
    move(you, cart);
    move(cart, hall);
    expect(log.entries).toEqual(["enter manor"]);
  });
});
