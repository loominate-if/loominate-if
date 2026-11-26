/** The player's notes on rooms (#397): written outside the story, saved, and undone. */
import {
  createEventRecord,
  createHistory,
  createSave,
  createStore,
  createStory,
  perform,
  readSave,
  statusOf,
  writeSave,
  type ActionCall,
  type Passage,
  type StateStore,
  type Story,
} from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import { _automapFull } from "./automap.js";
import { _mapNote } from "./map-notes.js";
import {
  actor,
  clock,
  connect,
  enterRoom,
  everyTurn,
  noteRoom,
  place,
  registerRoom,
  startAs,
  type Place,
} from "./index.js";

const hall = place("hall", { name: "hall" });
const kitchen = place("kitchen", { name: "kitchen" });
const cellar = place("cellar", { name: "cellar" });
connect(hall, { north: kitchen, down: cellar });
connect(kitchen, { south: hall });
connect(cellar, { up: hall });
startAs(actor("you", { body: { name: "you", location: hall } }));
// Someone who acts every turn, to show writing a note isn't one.
let turns = 0;
const cook = actor("cook", { body: { name: "cook", location: kitchen } });
everyTurn(cook, "counts", () => {
  turns += 1;
});

const room = (id: string, r: Place): Passage => {
  registerRoom(r, { id, tags: [`room: ${r.id}`] });
  return { id, tags: [`room: ${r.id}`], effects: { enter: () => enterRoom(r) }, body: () => [] };
};
const passages = [room("Hall", hall), room("Kitchen", kitchen), room("Cellar", cellar)];

let store: StateStore;
let story: Story;
beforeEach(() => {
  turns = 0;
  store = createStore();
  story = createStory(store, createEventRecord(store), passages, { start: "Hall" });
  story.begin();
});
const write = (r: Place, text: string): void => {
  story.act(noteRoom({ room: r, text }) as unknown as ActionCall);
};

describe("notes on rooms (#397)", () => {
  it("are written on rooms the player has been to, and shown on the map", () => {
    story.goTo("Kitchen");
    story.goTo("Hall");
    // #region note
    perform(noteRoom({ room: kitchen, text: "Tobias hides the key under the bread bin." }));
    // #endregion note
    expect(_mapNote(kitchen)).toBe("Tobias hides the key under the bread bin.");
    expect(_automapFull()?.view.rooms.find((r) => r.id === "kitchen")?.note).toBe(
      "Tobias hides the key under the bread bin.",
    );
  });

  it("can't be written on a room the player hasn't been to", () => {
    expect(statusOf(noteRoom({ room: cellar, text: "Dark?" })).hidden).toBe(
      "You haven't been there yet.",
    );
  });

  it("aren't a turn: no time passes, no move is counted, and no one else acts", () => {
    story.goTo("Kitchen");
    const before = { moves: clock.moves, minutes: clock.minutes, turns, story: story.moves };
    write(kitchen, "Warm.");
    expect({ moves: clock.moves, minutes: clock.minutes, turns, story: story.moves }).toEqual(
      before,
    );
  });

  it("are changed, trimmed, cut to length, and removed with empty text", () => {
    write(hall, "  First.  ");
    expect(_mapNote(hall)).toBe("First.");
    write(hall, "x".repeat(600));
    expect(_mapNote(hall)?.length).toBe(500);
    write(hall, "   ");
    expect(_mapNote(hall)).toBeUndefined();
  });

  it("follow undo", () => {
    const history = createHistory(store);
    history.checkpoint("begun");
    write(hall, "Draughty.");
    history.checkpoint("noted");
    expect(_mapNote(hall)).toBe("Draughty.");
    history.undo();
    expect(_mapNote(hall)).toBeUndefined();
    history.redo();
    expect(_mapNote(hall)).toBe("Draughty.");
  });

  it("survive save and load", () => {
    write(hall, "Draughty.");
    const text = writeSave(
      createSave(store, { game: { id: "notes", version: "1" }, savedAt: new Date(0) }),
    );
    const loaded = createStore(readSave(text).state);
    createStory(loaded, createEventRecord(loaded), passages, { start: "Hall" });
    expect(_mapNote(hall)).toBe("Draughty.");
  });

  it("replay as they were written (determinism)", () => {
    story.goTo("Kitchen");
    write(kitchen, "Warm.");
    const again = createStore();
    createStory(again, createEventRecord(again), passages, { start: "Hall" }).playReplay(
      story.toReplay(),
    );
    expect(again.snapshot()).toEqual(store.snapshot());
  });
});
