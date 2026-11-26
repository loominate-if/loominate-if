/** Hidden exits (#431): secret ways the player can't find or take until the story reveals them. */
import {
  createEventRecord,
  createHistory,
  createStore,
  createStory,
  type EventRecord,
  type Passage,
  type StateStore,
  type Story,
} from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import { _automapFull } from "./automap.js";
import { _compassWays } from "./compass.js";
import { _worldMap } from "./map-layout.js";
import { _worldDetails } from "./tree.js";
import {
  actAs,
  actor,
  clock,
  connect,
  enterRoom,
  everyTurn,
  exitLinks,
  go,
  place,
  placeOf,
  registerRoom,
  setExit,
  startAs,
  type Place,
} from "./index.js";

const hall = place("hall", { name: "hall" });
// #region hidden
const library = place("library", { name: "library" });
const vault = place("vault", { name: "vault" });
connect(library, { south: hall, north: { to: vault, hidden: true } });
// #endregion hidden
connect(vault, { south: library });
connect(hall, { north: library });
const you = actor("you", { body: { name: "you", location: library } });
const butler = actor("butler", { body: { name: "butler", location: library } });
startAs(you);
// On the first move, the butler slips through the secret way.
everyTurn(butler, "slips away", ({ npc }) => {
  if (clock.moves === 1) actAs(npc, go({ way: "north" }));
});

const room = (id: string, r: Place, more: Passage["body"] = () => []): Passage => {
  registerRoom(r, { id, tags: [`room: ${r.id}`] });
  return {
    id,
    tags: [`room: ${r.id}`],
    effects: { enter: () => enterRoom(r) },
    body: (ctx) => [{ type: "link", label: "Wait", target: id }, ...more(ctx), ...exitLinks()],
  };
};
const passages: Passage[] = [
  room("Library", library, () => [{ type: "link", label: "Pull the red book", target: "Found" }]),
  room("Vault", vault),
  room("Hall", hall),
  {
    id: "Found",
    tags: [],
    effects: {
      // #region reveal
      enter: () => {
        setExit(library, "north", { to: vault });
      },
      // #endregion reveal
    },
    body: () => [{ type: "link", label: "Back", target: "Library" }],
  },
];

let store: StateStore;
let record: EventRecord;
let story: Story;
beforeEach(() => {
  store = createStore();
  record = createEventRecord(store);
  story = createStory(store, record, passages, { start: "Library" });
  story.begin();
});
const labels = () => story.render().choices.map((c) => c.label);
const choose = (label: string) => {
  const c = story.render().choices.find((x) => x.label === label);
  if (!c) throw new Error(`no ${label}: ${labels().join(", ")}`);
  story.follow(c);
};
const said = () => record.events({ kinds: ["perception"] }).map((e) => e.text);
const compass = () => _compassWays().map((w) => w.direction);

describe("a hidden exit (#431)", () => {
  it("isn't in the exit links or the compass", () => {
    expect(labels()).toEqual(["Wait", "Pull the red book", "South"]);
    expect(compass()).toEqual(["south"]);
  });

  it("can be taken by characters, who aren't said to go that way, and can't be followed", () => {
    choose("Wait");
    expect(placeOf(butler)?.id).toBe("vault");
    expect(said()).toContain("The butler leaves.");
    expect(labels()).not.toContain("Follow the butler");
  });

  it("is revealed by setExit, and hidden again by an undo", () => {
    const history = createHistory(store);
    history.checkpoint("begun");
    choose("Pull the red book");
    history.checkpoint("found");
    choose("Back");
    history.checkpoint("back");
    expect(labels()).toContain("North");
    expect(compass()).toEqual(["north", "south"]);
    history.undo();
    history.undo();
    expect(compass()).toEqual(["south"]);
  });

  it("isn't on the auto-map, though it still places the rooms", () => {
    // The player reaches the vault another way, as by a passage link.
    story.goTo("Vault");
    story.goTo("Library");
    const map = _automapFull();
    const libraryRoom = map?.view.rooms.find((r) => r.id === "library");
    expect(libraryRoom?.ways?.map((w) => w.label)).toEqual(["South: not explored"]);
    // Only the way the player knows, from the vault, is drawn: one way.
    expect(map?.view.links).toEqual([{ from: "vault", to: "library", oneWay: true }]);
    expect(map?.view.summary).toBe(
      "Map: you're in the library. You haven't been anywhere next to it.",
    );
    // The vault is north of the library, where the hidden way puts it.
    expect(_worldMap().layout.cells.get("vault")).toEqual({ x: 0, y: -1 });
  });

  it("is shown to the author, marked hidden", () => {
    expect(_worldDetails("library")?.exits).toEqual([
      { direction: "north", to: "vault", hidden: true },
      { direction: "south", to: "hall", hidden: false },
    ]);
  });

  it("gives the same state for the same moves (determinism)", () => {
    choose("Wait");
    choose("Pull the red book");
    choose("Back");
    choose("North");
    const again = createStore();
    createStory(again, createEventRecord(again), passages, { start: "Library" }).playReplay(
      story.toReplay(),
    );
    expect(again.snapshot()).toEqual(store.snapshot());
  });
});
