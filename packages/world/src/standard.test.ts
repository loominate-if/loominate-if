import {
  actionsFor,
  createEventRecord,
  createStore,
  createStory,
  perform,
  statusOf,
  type EventRecord,
} from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  actor,
  connect,
  container,
  contents,
  door,
  drop,
  lockable,
  move,
  openable,
  place,
  startAs,
  take,
  thing,
  unlock,
} from "./index.js";

const hall = place("hall", { name: "hall" });
const cellar = place("cellar", { name: "cellar" });
// #region things
export const key = thing("key", { name: "iron key", location: hall });
export const chest = thing("chest", {
  ...container,
  ...openable,
  ...lockable,
  key,
  name: "oak chest",
  description: "Iron bands hold it shut.",
  location: hall,
});
export const statue = thing("statue", { name: "statue", isFixed: true, location: hall });
// #endregion
const cellarDoor = thing("cellarDoor", { ...door, name: "cellar door" });
connect(hall, { down: { to: cellar, via: cellarDoor } });
connect(cellar, { up: { to: hall, via: cellarDoor } });
const you = actor("you", { body: { name: "you", location: hall } });
startAs(you);

let record: EventRecord;
beforeEach(() => {
  const store = createStore();
  record = createEventRecord(store);
  createStory(store, record, [{ id: "Start", tags: [], body: () => [] }], { start: "Start" });
});

/** A thing's menu: each action's label, and why it's disabled, without the hidden ones. */
const menu = (of: { id: string }) =>
  actionsFor(of)
    .map(statusOf)
    .filter((s) => s.hidden === undefined)
    .map((s) => (s.disabled === undefined ? s.label : `${s.label} (${s.disabled})`));
const said = () => record.events({ kinds: ["action-result"] }).map((e) => e.text);

describe("the standard actions", () => {
  it("offer what suits each thing", () => {
    // #region menus
    expect(menu(key)).toEqual(["Examine the iron key", "Take the iron key"]);
    expect(menu(chest)).toEqual([
      "Examine the oak chest",
      "Take the oak chest",
      "Open the oak chest (The oak chest is locked.)",
      "Unlock the oak chest (You need the iron key.)",
    ]);
    // #endregion
    expect(menu(statue)).toEqual(["Examine the statue"]); // fixed: no take
    expect(menu(cellarDoor)).toEqual(["Examine the cellar door", "Open the cellar door"]);
  });

  it("change what's offered as things change", () => {
    perform(take({ thing: key }));
    expect(menu(key)).toEqual(["Examine the iron key", "Drop the iron key"]);
    perform(unlock({ thing: chest }));
    expect(menu(chest)).toEqual([
      "Examine the oak chest",
      "Take the oak chest",
      "Open the oak chest",
      "Lock the oak chest",
    ]);
    perform(drop({ thing: key }));
    expect(contents(hall).map((c) => c.id)).toContain("key");
    expect(said()).toEqual([
      "You take the iron key.",
      "You unlock the oak chest.",
      "You drop the iron key.",
    ]);
  });

  it("say which rule hid or disabled them, for the inspector", () => {
    move(key, cellar);
    expect(statusOf(take({ thing: key })).by).toEqual({
      stage: "verify",
      rulebook: "every action: verify",
      rule: "things in reach",
      source: "@loominate-if/world",
    });
    move(key, hall);
    expect(statusOf(unlock({ thing: chest })).by).toEqual({
      stage: "check",
      rulebook: "unlock: check",
      rule: "unlock: own",
      source: "@loominate-if/world",
    });
  });

  it("examine with a description, or say there's nothing special", () => {
    const [examineChest] = actionsFor(chest);
    const [examineKey] = actionsFor(key);
    if (!examineChest || !examineKey) throw new Error("no examine");
    perform(examineChest);
    perform(examineKey);
    expect(said()).toEqual([
      "Iron bands hold it shut.",
      "You see nothing special about the iron key.",
    ]);
  });
});
