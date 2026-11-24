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
  accept,
  actor,
  give,
  giving,
  isWithin,
  place,
  react,
  show,
  showing,
  startAs,
  thing,
} from "./index.js";

const tollhouse = place("tollhouse", { name: "tollhouse" });
const you = actor("you", { body: { name: "you", location: tollhouse } });
const keeper = actor("keeper", { body: { name: "toll keeper", location: tollhouse } });
const coin = thing("coin", { name: "coin", location: you });
const pass = thing("pass", { name: "pass", location: you });
const pebble = thing("pebble", { name: "pebble", location: you });
const gate = thing("gate", { name: "gate", isFixed: true, location: tollhouse, isLocked: true });
startAs(you);

// #region reactions
giving.rule("the keeper takes the toll", ({ thing, to }) =>
  to.id === keeper.id && thing.id === coin.id
    ? accept("The keeper bites the coin, and nods.")
    : undefined,
);
showing.rule("the keeper knows the pass", ({ thing, to }) =>
  to.id === keeper.id && thing.id === pass.id
    ? react("The keeper squints at the seal, and unlocks the gate.", () => {
        gate.isLocked = false;
      })
    : undefined,
);
// #endregion

let record: EventRecord;
beforeEach(() => {
  const store = createStore();
  record = createEventRecord(store);
  createStory(store, record, [{ id: "Start", tags: [], body: () => [] }], {
    start: "Start",
  }).begin();
});
const menu = (of: { id: string }) =>
  actionsFor(of)
    .map(statusOf)
    .filter((s) => s.hidden === undefined)
    .map((s) => s.label);
const said = () => record.events({ kinds: ["action-result"] }).map((e) => e.text);

describe("giving and showing (#345)", () => {
  it("are offered on what you carry, to whoever is present, and on their menus too", () => {
    expect(menu(coin)).toContain("Give the coin to the toll keeper");
    expect(menu(coin)).toContain("Show the coin to the toll keeper");
    expect(menu(keeper)).toContain("Give the pebble to the toll keeper");
    expect(menu(gate)).not.toContain("Give the gate to the toll keeper");
  });

  it("let rules decide how someone reacts, and decline or glance when none answers", () => {
    perform(give({ thing: pebble, to: keeper }));
    perform(show({ thing: pebble, to: keeper }));
    expect(isWithin(pebble, you)).toBe(true);
    perform(give({ thing: coin, to: keeper }));
    expect(isWithin(coin, keeper)).toBe(true);
    perform(show({ thing: pass, to: keeper }));
    expect([isWithin(pass, you), gate.isLocked]).toEqual([true, false]);
    expect(said()).toEqual([
      "The toll keeper doesn't want the pebble.",
      "The toll keeper glances at the pebble.",
      "The keeper bites the coin, and nods.",
      "The keeper squints at the seal, and unlocks the gate.",
    ]);
  });
});
