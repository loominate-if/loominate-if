import {
  createEventRecord,
  createStore,
  createStory,
  messages,
  spawn,
  type MessageText,
  type Messages,
} from "@loominate-if/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  actor,
  container,
  listContents,
  move,
  openable,
  place,
  pluralize,
  startAs,
  surface,
  thing,
  thingTemplate,
} from "./index.js";

const vault = place("vault", { name: "vault" });
const cellar = place("cellar", { name: "cellar", isDark: true });
// #region things
export const chest = thing("chest", { ...container, ...openable, name: "chest", location: vault });
export const table = thing("table", { ...surface, name: "table", location: vault });
export const coin = thingTemplate("coin", { name: "gold coin" });
export const key = thing("key", { name: "brass key", location: table });
export const map = thing("map", { name: "map", location: table });
export const mouse1 = thing("mouse1", {
  name: "mouse",
  pluralName: "mice",
  isEquivalent: true,
  location: table,
});
export const mouse2 = thing("mouse2", {
  name: "mouse",
  pluralName: "mice",
  isEquivalent: true,
  location: table,
});
// #endregion
const lamp = thing("lamp", { name: "lamp", location: cellar });
const you = actor("you", { body: { name: "you", location: vault } });
startAs(you);

const saved = (["list.join", "number.words"] as const).map((k) => [k, messages.get(k)] as const);
afterEach(() => {
  for (const [k, text] of saved) {
    messages.replace(k, text as MessageText<Messages[typeof k]>, { source: "@loominate-if/world" });
  }
});
beforeEach(() => {
  const store = createStore();
  createStory(store, createEventRecord(store), [{ id: "Start", tags: [], body: () => [] }], {
    start: "Start",
  });
});

describe("listing contents", () => {
  it("groups alike things with a count", () => {
    chest.open();
    for (let i = 0; i < 3; i++) move(spawn(coin, chest), chest);
    // #region listing
    expect(listContents(chest)).toBe("three gold coins");
    expect(listContents(table)).toBe("a brass key, a map, and two mice");
    // #endregion
    move(spawn(coin, chest), table);
    expect(listContents(table)).toBe("a gold coin, a brass key, a map, and two mice"); // in ID order: gen:… first
    expect(listContents(chest)).toBe("three gold coins");
  });

  it("lists only what the player can see, and always what they carry", () => {
    move(spawn(coin, chest), chest);
    expect(listContents(chest)).toBe("nothing"); // closed
    move(key, you);
    move(you, cellar);
    expect(listContents(cellar)).toBe("nothing"); // dark, and not the player
    expect(listContents(you)).toBe("a brass key");
    expect(lamp.location?.id).toBe("cellar");
  });

  it("can be reworded through the message table", () => {
    messages.replace("list.join", ({ items }) => items.join(" & "));
    messages.replace("number.words", ({ count }) => String(count));
    expect(listContents(table)).toBe("a brass key & a map & 2 mice");
  });
});

describe("plural names", () => {
  it("follow English spelling for the last word", () => {
    expect(["gold coin", "box", "berry", "day", "brush", "glass"].map(pluralize)).toEqual([
      "gold coins",
      "boxes",
      "berries",
      "days",
      "brushes",
      "glasses",
    ]);
  });
});
