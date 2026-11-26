/** The world model's auto-map (#394): the visited rooms around the player, from game state. */
import {
  createEventRecord,
  createHistory,
  createStore,
  createStory,
  type Passage,
  type Story,
} from "@loominate-if/core";
import { widgets, type AutomapData } from "@loominate-if/presentation";
import { beforeEach, describe, expect, it } from "vitest";
import { _automapView } from "./automap.js";
import { actor, connect, enterRoom, place, registerRoom, startAs, type Place } from "./index.js";

const taproom = place("taproom", { name: "taproom" });
const kitchen = place("kitchen", { name: "kitchen" });
const landing = place("landing", { name: "landing" });
const bedroom = place("bedroom", { name: "bedroom" });
const yard = place("yard", { name: "yard" });
connect(taproom, { east: kitchen, up: landing, west: yard });
connect(kitchen, { west: taproom });
connect(landing, { down: taproom, east: bedroom });
connect(bedroom, { west: landing });
// The yard has no way back: a one-way exit.
startAs(actor("you", { body: { name: "you", location: taproom } }));

const room = (id: string, r: Place): Passage => {
  registerRoom(r, { id, tags: [`room: ${r.id}`] });
  return { id, tags: [`room: ${r.id}`], effects: { enter: () => enterRoom(r) }, body: () => [] };
};
const passages = [
  room("Taproom", taproom),
  room("Kitchen", kitchen),
  room("Landing", landing),
  room("Bedroom", bedroom),
  room("Yard", yard),
];

let story: Story;
let store: ReturnType<typeof createStore>;
beforeEach(() => {
  store = createStore();
  story = createStory(store, createEventRecord(store), passages, { start: "Taproom" });
  story.begin();
});

const view = () => _automapView({ columns: 5, rows: 3 });
const drawn = () =>
  (view()?.rooms ?? []).map((r) => `${r.id} ${String(r.x)},${String(r.y)}${r.current ? " *" : ""}`);

describe("the auto-map", () => {
  it("starts with only the player's room, in the middle of the window", () => {
    expect(drawn()).toEqual(["taproom 2,1 *"]);
    expect(view()?.summary).toBe(
      "Map: you're in the taproom. You haven't been anywhere next to it.",
    );
  });

  it("grows as rooms are visited, keeping each in its cell", () => {
    story.goTo("Kitchen");
    story.goTo("Taproom");
    expect(drawn()).toEqual(["taproom 2,1 *", "kitchen 3,1"]);
    expect(view()?.summary).toBe(
      "Map: you're in the taproom. Visited nearby: the kitchen to the east.",
    );
    story.goTo("Landing");
    story.goTo("Bedroom");
    // The window follows the player; the rooms keep their places relative to each other.
    expect(drawn()).toEqual(["taproom 0,2", "kitchen 1,2", "landing 1,1", "bedroom 2,1 *"]);
  });

  it("draws ways between visited rooms: two-way as one, one-way with an arrow, the odd ones named", () => {
    story.goTo("Landing");
    story.goTo("Taproom");
    story.goTo("Yard");
    expect(view()?.links).toEqual([
      { from: "taproom", to: "yard", oneWay: true },
      { from: "taproom", to: "landing", label: "Up / Down" },
    ]);
  });

  it("agrees with the game after an undo, as it's read from state", () => {
    const history = createHistory(store);
    history.checkpoint("begun");
    story.goTo("Kitchen");
    history.checkpoint("kitchen");
    expect(drawn()).toEqual(["taproom 1,1", "kitchen 2,1 *"]);
    history.undo();
    expect(drawn()).toEqual(["taproom 2,1 *"]);
  });

  it("is registered as a widget", () => {
    const data = widgets.get("automap")?.data({} as never) as AutomapData;
    expect([data.columns, data.rows, data.view?.rooms.length]).toEqual([5, 3, 1]);
  });
});
