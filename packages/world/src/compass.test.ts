import {
  createEventRecord,
  createHistory,
  createStore,
  createStory,
  type ActionCall,
  type Passage,
  type StateStore,
  type Story,
} from "@loominate-if/core";
import { widgets, type CompassData, type WidgetHost } from "@loominate-if/presentation";
import { beforeEach, describe, expect, it } from "vitest";
import { _compassWays, _takeWay } from "./compass.js";
import {
  actor,
  connect,
  door,
  enterRoom,
  journey,
  lockable,
  place,
  registerRoom,
  startAs,
  thing,
  type Place,
} from "./index.js";

export const hall = place("hall", { name: "hall" });
export const library = place("library", { name: "library" });
export const cellar = place("cellar", { name: "cellar" });
export const platform = place("platform", { name: "platform" });
export const cellarDoor = thing("cellarDoor", { ...door, ...lockable, name: "cellar door" });
journey("lift", {});
connect(hall, {
  north: library,
  down: { to: cellar, via: cellarDoor },
  east: { to: platform, minutes: 5, journey: "lift" },
});
connect(library, { south: hall });
connect(platform, { west: hall });
const you = actor("you", { body: { name: "you", location: hall } });
startAs(you);

const room = (id: string, r: Place): Passage => {
  registerRoom(r, { id, tags: [`room: ${r.id}`] });
  return {
    id,
    tags: [`room: ${r.id}`],
    effects: { enter: () => enterRoom(r) },
    body: () => [{ type: "text", text: `The ${r.id}.` }], // no {exits}: only the compass
  };
};
const passages = [
  room("Hall", hall),
  room("Library", library),
  room("Cellar", cellar),
  room("Platform", platform),
];

let store: StateStore;
let story: Story;
const moves: string[] = [];
/** A page, as the compass sees it, recording the moves it makes. */
const host = {
  goTo: (passage: string, label: string) => {
    moves.push(`goTo ${passage} (${label})`);
    story.goTo(passage);
  },
  act: (call: ActionCall<{ readonly way: string }>, label: string) => {
    moves.push(`act ${call.action.actionName} ${call.args.way} (${label})`);
    story.act(call as unknown as ActionCall);
  },
} as unknown as WidgetHost;
beforeEach(() => {
  moves.length = 0;
  store = createStore();
  story = createStory(store, createEventRecord(store), passages, { start: "Hall" });
  story.begin();
});

/** The compass's ways, as text: its label and title, and why it's disabled. */
const ways = (names?: "visited" | "all" | "none") =>
  _compassWays(names).map(
    (w) => `${w.label} ${w.title}${w.available ? "" : ` (${w.reason ?? "unavailable"})`}`,
  );

describe("the compass", () => {
  it("shows the room's ways, a locked door's with its reason, and names visited rooms", () => {
    // #region ways
    expect(ways()).toEqual(["N North", "E East", "Down Down (The cellar door is locked.)"]);
    // #endregion
    story.goTo("Library");
    story.goTo("Hall");
    expect(ways()[0]).toBe("N North, to the library");
    expect(ways("all")[1]).toBe("E East, to the platform");
    expect(ways("none")[0]).toBe("N North");
  });

  it("is registered as a widget, with the data it shows", () => {
    const data = widgets.get("compass")?.data({} as never) as CompassData;
    expect([data.label, data.ways.map((w) => w.direction)]).toEqual([
      "Compass",
      ["north", "east", "down"],
    ]);
  });

  it("takes plain ways as moves to their room's passage, and journeys as actions", () => {
    const history = createHistory(store);
    history.checkpoint("begun");
    _takeWay(host, "north");
    expect(story.current).toBe("Library");
    history.checkpoint("north");
    _takeWay(host, "south");
    _takeWay(host, "east");
    expect(story.current).toBe("Platform");
    expect(moves).toEqual([
      "goTo Library (North)",
      "goTo Hall (South)",
      "act world:journey east (East)",
    ]);
    expect(story.moves).toBe(3);
  });
});
