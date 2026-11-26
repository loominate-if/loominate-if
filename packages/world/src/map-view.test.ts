/** The world model's Rooms view of the story map (#426). */
import { createEventRecord, createStore, createStory, mapViews } from "@loominate-if/core";
import { beforeAll, describe, expect, it } from "vitest";
import { actor, connect, door, place, registerRoom, startAs, thing } from "./index.js";

const hall = place("hall", { name: "great hall" });
const library = place("library", { name: "library" });
const cellar = place("cellar", { name: "cellar" });
// #region pin
const yard = place("yard", { name: "yard", map: { x: 3, y: 1 } });
// #endregion
const trapdoor = thing("trapdoor", { ...door, name: "trapdoor" });
connect(hall, { north: library, down: { to: cellar, via: trapdoor }, east: yard });
connect(library, { south: hall });
connect(cellar, { up: { to: hall, via: trapdoor } });
startAs(actor("you", { body: { name: "you", location: library } }));
registerRoom(hall, { id: "Great Hall", tags: ["room: hall"] });

let story: ReturnType<typeof createStory>;
beforeAll(() => {
  const store = createStore();
  story = createStory(
    store,
    createEventRecord(store),
    [{ id: "Start", tags: [], body: () => [] }],
    {
      start: "Start",
    },
  );
  story.begin();
});

const rooms = () => {
  const source = mapViews.get("rooms");
  if (!source) throw new Error("no Rooms view");
  return { title: source.title, ...source.view({ story, passages: [] }) };
};

describe("the Rooms view", () => {
  it("has each room by name and its passage, from the player's room along the exits", () => {
    const view = rooms();
    expect(view.title).toBe("Rooms");
    expect(view.nodes.map((n) => [n.id, n.label, n.start ?? false, n.tags ?? []])).toEqual([
      ["library", "library", true, []],
      ["hall", "great hall", false, ["passage: Great Hall"]],
      ["yard", "yard", false, []],
      ["cellar", "cellar", false, []],
    ]);
  });

  it("lays the rooms out by compass from the player's room", () => {
    const cells = Object.fromEntries(rooms().nodes.map((n) => [n.id, n.cell]));
    expect(cells.library).toEqual({ x: 0, y: 0 });
    expect(cells.hall).toEqual({ x: 0, y: 1 });
    // The yard is pinned, wherever its exit would put it.
    expect(cells.yard).toEqual({ x: 3, y: 1 });
  });

  it("has each exit with its direction and door, bending those off the grid", () => {
    expect(
      rooms().edges.map((e) => [e.from, e.to, e.label, e.guarded ?? false, e.bent ?? false]),
    ).toEqual([
      ["cellar", "hall", "Up, through the trapdoor", true, true],
      ["hall", "library", "North", false, false],
      ["hall", "yard", "East", false, true],
      ["hall", "cellar", "Down, through the trapdoor", true, true],
      ["library", "hall", "South", false, false],
    ]);
  });

  it("anchors on the room the player's body starts in by definition, even after it moves", async () => {
    const { _worldMap } = await import("./map-layout.js");
    expect(_worldMap().start?.id).toBe("library");
    const before = Object.fromEntries([..._worldMap().layout.cells]);
    const { move } = await import("./index.js");
    move({ id: "you" }, cellar);
    expect(_worldMap().start?.id).toBe("library");
    expect(Object.fromEntries([..._worldMap().layout.cells])).toEqual(before);
  });
});
