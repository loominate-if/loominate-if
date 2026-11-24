import { createEventRecord, createStore, createStory } from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  _playerPath,
  _worldDetails,
  _worldTree,
  actor,
  container,
  defineFacts,
  mind,
  move,
  place,
  stack,
  stackable,
  startAs,
  thing,
} from "./index.js";

const barn = place("barn", { name: "barn" });
place("yard", { name: "yard" });
const crate = thing("crate", { ...container, name: "crate", location: barn });
const turnip = stackable("turnip", { name: "turnip" });
stack("turnips", turnip, { count: 99, location: crate });
const you = actor("you", { body: { name: "you", location: barn } });
const lamp = thing("lamp", { name: "lamp", location: you });
thing("statue", { name: "famous statue", isFamiliar: true });
mind("ghost", { name: "ghost" });
const facts = defineFacts({ buried: "The farmer buried the gold under the turnips." });
startAs(you);

beforeEach(() => {
  const store = createStore();
  createStory(store, createEventRecord(store), [{ id: "Start", tags: [], body: () => [] }], {
    start: "Start",
  }).begin();
});

describe("the world tree (#82)", () => {
  it("nests what's in each place, with bodies' minds and stacks' counts, then what's nowhere and minds with no body", () => {
    const tree = _worldTree();
    const names = (nodes: ReturnType<typeof _worldTree>["places"]): unknown =>
      nodes.map((n) => [
        n.id,
        ...(n.mind ? [`mind ${n.mind}`] : []),
        ...(n.count !== undefined ? [n.count] : []),
        names(n.children),
      ]);
    expect(names(tree.places)).toEqual([
      [
        "barn",
        [
          ["crate", [["turnips", 99, []]]],
          ["you", "mind you:mind", [["lamp", []]]],
        ],
      ],
      ["yard", []],
    ]);
    expect(tree.nowhere.map((n) => n.id)).toEqual(["statue"]);
    expect(tree.bodiless.map((n) => [n.id, n.kind])).toEqual([["ghost", "mind"]]);
  });

  it("gives a node's place in the world, its mind or body, and who knows what, both ways", () => {
    you.learn(facts.buried, { from: crate });
    you.see(lamp);
    expect(_worldDetails("lamp")).toMatchObject({
      kind: "thing",
      within: ["you", "barn"],
      seenBy: ["you:mind"],
      knownOfBy: [],
    });
    expect(_worldDetails("statue")).toMatchObject({ knownOfBy: ["ghost", "you:mind"] });
    expect(_worldDetails("you")).toMatchObject({
      kind: "body",
      mind: "you:mind",
      knowledge: {
        mind: "you:mind",
        facts: [
          { id: "buried", text: "The farmer buried the gold under the turnips.", from: "crate" },
        ],
        seen: ["lamp"],
        knownOf: ["statue"],
      },
    });
    expect(_worldDetails("ghost")).toMatchObject({
      kind: "mind",
      knowledge: { facts: [], seen: [] },
    });
    expect(_worldDetails("nothing")).toBeUndefined();
  });

  it("finds the way to the player, to open the tree on them", () => {
    expect(_playerPath()).toEqual(["barn", "you"]);
    move(you, crate);
    expect(_playerPath()).toEqual(["barn", "crate", "you"]);
  });
});
