import {
  actionsFor,
  createEventRecord,
  createHistory,
  createStore,
  createStory,
  perform,
  statusOf,
  t,
  type EventRecord,
  type StateStore,
} from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  actor,
  contents,
  countOf,
  dropOne,
  listContents,
  move,
  place,
  setCount,
  split,
  stack,
  stackable,
  stackIn,
  startAs,
  take,
  takeOne,
} from "./index.js";

const barn = place("barn", { name: "barn" });
const yard = place("yard", { name: "yard" });
// #region stacks
export const turnip = stackable("turnip", { name: "turnip" });
export const crate = stack("crate", turnip, { count: 99, location: barn });
export const ticket = stackable("ticket", { name: "raffle ticket", merges: false });
// #endregion
export const yours = stack("yours", ticket, { count: 2, location: yard });
export const mine = stack("mine", ticket, { count: 1, location: barn });
const you = actor("you", { body: { name: "you", location: barn } });
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
const menu = (of: { id: string }) =>
  actionsFor(of)
    .map(statusOf)
    .filter((s) => s.hidden === undefined)
    .map((s) => s.label);
const said = () => record.events({ kinds: ["action-result"] }).map((e) => e.text);

describe("stacks", () => {
  it("are one thing with a count: 99 turnips are one stack", () => {
    expect(contents(barn).filter((c) => c.id === "crate")).toHaveLength(1);
    expect(countOf(crate)).toBe(99);
    expect(listContents(barn)).toBe("99 turnips and a raffle ticket");
    expect(t`{The subj ${crate}} {is} in the barn. You see {a ${crate}}.`()).toBe(
      "The turnips are in the barn. You see 99 turnips.",
    );
    setCount(crate, 1);
    expect(t`{The subj ${crate}} {is} here: {a ${crate}}.`()).toBe("The turnip is here: a turnip.");
  });

  it("split, with an ID from where they came from, and merge whenever they meet", () => {
    // #region split
    const three = split(crate, 3); // gen:crate:turnip-1, still in the barn
    expect([three.id, countOf(three), countOf(crate)]).toEqual(["gen:crate:turnip-1", 3, 96]);
    move(three, you);
    const two = split(crate, 2);
    move(two, you); // joins the three you carry
    expect(countOf(three)).toBe(5);
    // #endregion
    expect(stackIn(you, turnip)?.id).toBe("gen:crate:turnip-1");
    expect(contents(you).map((c) => c.id)).toEqual(["gen:crate:turnip-1"]);
    // Tickets don't merge: each is its own.
    move(mine, yard);
    expect(contents(yard).map((c) => [c.id, countOf(c)])).toEqual([
      ["mine", 1],
      ["yours", 2],
    ]);
  });

  it("offer taking one or all from their menus", () => {
    // #region menus
    expect(menu(crate)).toEqual(["Examine the turnips", "Take all 99 turnips", "Take a turnip"]);
    perform(takeOne({ thing: crate }));
    perform(takeOne({ thing: crate }));
    const held = stackIn(you, turnip);
    expect(held && countOf(held)).toBe(2);
    expect(held && menu(held)).toEqual([
      "Examine the turnips",
      "Drop all two turnips",
      "Drop a turnip",
    ]);
    // #endregion
    perform(take({ thing: crate })); // all 97 join the two you carry
    expect([held && countOf(held), countOf(crate), crate.location]).toEqual([99, 0, null]);
    if (held) perform(dropOne({ thing: held }));
    expect(said()).toEqual([
      "You take a turnip.",
      "You take a turnip.",
      "You take the turnips.",
      "You drop a turnip.",
    ]);
    expect(listContents(barn)).toBe("a turnip and a raffle ticket");
  });

  it("are undone with the game", () => {
    const history = createHistory(store);
    history.checkpoint("begun");
    move(split(crate, 10), you);
    history.checkpoint("took");
    history.undo();
    expect([countOf(crate), stackIn(you, turnip)]).toEqual([99, undefined]);
  });
});
