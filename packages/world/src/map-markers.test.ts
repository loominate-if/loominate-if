/** The auto-map's markers and stubs (#396): what the player last saw where, and ways not yet taken. */
import {
  createEventRecord,
  createHistory,
  createStore,
  createStory,
  type Passage,
  type StateStore,
  type Story,
} from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import { _automapFull, _automapView } from "./automap.js";
import { _worldDetails } from "./tree.js";
import {
  actor,
  connect,
  enterRoom,
  move,
  place,
  player,
  registerRoom,
  startAs,
  thing,
  type Place,
} from "./index.js";

const hall = place("hall", { name: "hall" });
const kitchen = place("kitchen", { name: "kitchen" });
const cellar = place("cellar", { name: "cellar" });
const garden = place("garden", { name: "garden" });
connect(hall, { north: kitchen, down: cellar, east: garden });
connect(kitchen, { south: hall });
connect(cellar, { up: hall });
connect(garden, { west: hall });
const you = actor("you", { body: { name: "you", location: hall } });
// People are marked by name; a ghost asks not to be.
const cook = actor("cook", { body: { name: "Tobias", location: kitchen } });
actor("ghost", { body: { name: "ghost", location: kitchen, onMap: false } });
// #region markers
const chest = thing("chest", { name: "iron-bound chest", location: cellar, onMap: "chest" });
const key = thing("key", {
  name: "brass key",
  location: hall,
  onMap: { label: "key", icon: "icons/key.svg" },
});
// #endregion markers
thing("lamp", { name: "lamp", location: hall });
startAs(you);

const room = (id: string, r: Place): Passage => {
  registerRoom(r, { id, tags: [`room: ${r.id}`] });
  return { id, tags: [`room: ${r.id}`], effects: { enter: () => enterRoom(r) }, body: () => [] };
};
const passages = [
  room("Hall", hall),
  room("Kitchen", kitchen),
  room("Cellar", cellar),
  room("Garden", garden),
];

let store: StateStore;
let story: Story;
beforeEach(() => {
  store = createStore();
  story = createStory(store, createEventRecord(store), passages, { start: "Hall" });
  story.begin();
});
/** Each visited room's markers, as the full map has them. */
const marked = () =>
  Object.fromEntries(
    (_automapFull()?.view.rooms ?? []).map((r) => [r.id, (r.markers ?? []).map((m) => m.label)]),
  );

describe("markers on the auto-map (#396)", () => {
  it("marks things with onMap where the player saw them, with their labels and icons", () => {
    const hallRoom = _automapFull()?.view.rooms.find((r) => r.id === "hall");
    // The lamp has no onMap, so it isn't marked.
    expect(hallRoom?.markers).toEqual([{ label: "key", icon: "icons/key.svg" }]);
    story.goTo("Cellar");
    expect(marked()).toEqual({ hall: ["key"], cellar: ["chest"] });
  });

  it("marks people by name, unless they ask not to be", () => {
    story.goTo("Kitchen");
    const kitchenRoom = _automapFull()?.view.rooms.find((r) => r.id === "kitchen");
    expect(kitchenRoom?.markers).toEqual([{ label: "Tobias", person: true }]);
  });

  it("shows people where the player last saw them, not where they are", () => {
    story.goTo("Kitchen");
    story.goTo("Hall");
    // Offstage, the cook goes down to the cellar.
    move(cook, cellar);
    expect(player.lastSaw(cook)?.id).toBe("kitchen");
    expect(marked()).toEqual({ hall: ["key"], kitchen: ["Tobias"] });
    // Back in the kitchen, the player sees he isn't there.
    story.goTo("Kitchen");
    expect(player.lastSaw(cook)).toBeUndefined();
    expect(marked()).toEqual({ hall: ["key"], kitchen: [] });
    // Down in the cellar, there he is.
    story.goTo("Hall");
    story.goTo("Cellar");
    expect(marked()).toEqual({ hall: ["key"], kitchen: [], cellar: ["Tobias", "chest"] });
  });

  it("forgets where someone is once the player watches them leave", () => {
    story.goTo("Kitchen");
    move(cook, hall);
    story.goTo("Hall");
    expect(player.lastSaw(cook)?.id).toBe("hall");
    move(cook, kitchen);
    expect(player.lastSaw(cook)).toBeUndefined();
  });

  it("doesn't mark what the player carries", () => {
    move(key, you);
    story.goTo("Hall");
    expect(marked()).toEqual({ hall: [] });
  });

  it("follows an undo, as sightings are state", () => {
    const history = createHistory(store);
    history.checkpoint("begun");
    story.goTo("Cellar");
    history.checkpoint("cellar");
    expect(player.lastSaw(chest)?.id).toBe("cellar");
    history.undo();
    expect(player.lastSaw(chest)).toBeUndefined();
  });

  it("is shown to the author in the inspector, for any mind", () => {
    story.goTo("Kitchen");
    expect(_worldDetails("you")?.knowledge?.lastSaw).toContainEqual({
      thing: "cook",
      room: "kitchen",
    });
  });

  it("is on the small map too", () => {
    story.goTo("Kitchen");
    const small = _automapView({ columns: 5, rows: 3 })?.rooms.find((r) => r.id === "kitchen");
    expect(small?.markers).toEqual([{ label: "Tobias", person: true }]);
  });
});

describe("stubs for ways not yet taken (#396)", () => {
  it("point toward each unvisited room, named if the way isn't a compass point", () => {
    const hallRoom = _automapFull()?.view.rooms.find((r) => r.id === "hall");
    expect(hallRoom?.stubs).toEqual([
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: 1, y: 1, label: "Down" },
    ]);
    story.goTo("Kitchen");
    story.goTo("Hall");
    expect(_automapFull()?.view.rooms.find((r) => r.id === "hall")?.stubs).toEqual([
      { x: 1, y: 0 },
      { x: 1, y: 1, label: "Down" },
    ]);
  });
});

describe("onMap", () => {
  it("must be true, false, a label, or { label, icon }", () => {
    expect(() => thing("bad", { name: "bad", onMap: { colour: "red" } as never })).toThrow(
      'thing "bad": onMap must be true, false, a short label as "chest", or { label, icon } with an image\'s URL.',
    );
    expect(() => thing("blank", { name: "blank", onMap: "" })).toThrow(/onMap must be/);
  });
});
