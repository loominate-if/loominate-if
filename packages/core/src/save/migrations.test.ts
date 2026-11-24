import { afterEach, describe, expect, it } from "vitest";
import { createEventRecord } from "../events/record.js";
import { object, type ObjectRef } from "../objects/objects.js";
import { createStory, type Passage } from "../passages/story.js";
import { createStore } from "../state/store.js";
import { lamplight100 } from "./fixtures/lamplight-1.0.0.js";
import { _resetMigrations, migrate } from "./migrations.js";
import { createMemoryStorage, createSaves } from "./save.js";

/** A save made by version 1.0.0 of the game: the hero holds the old lamp, near the shed, with the door open (shut: false). */
const fixture = lamplight100;

// Version 1.2.0 of the game: the lamp's ID changed, the door says whether it's open, and the shed is gone.
const lamp = object("lamp", { name: "lamp", oil: 3 });
const door = object("door", { isOpen: false });
const hero = object("hero", {
  holding: null as typeof lamp | null,
  near: null as ObjectRef | null,
});
const passages: Passage[] = [
  { id: "Start", tags: [], body: () => [] },
  { id: "Yard", tags: [], body: () => [] },
];
const game = { id: "lamplight", version: "1.2.0" };

const declareSteps = () => {
  // #region migrate
  migrate({ from: "1.0.0", to: "1.1.0" }, (save) => {
    save.rename("oldLamp", "lamp");
    save.renameField("door", "shut", "isOpen", (shut) => !shut);
  });
  migrate({ from: "1.1.0", to: "1.2.0" }, (save) => {
    save.remove("shed");
  });
  // #endregion
};

/** Loads `text` into a slot of the 1.2.0 game, and plays on from it. */
async function loadInto(text: string) {
  const saves = createSaves({ storage: createMemoryStorage(), game });
  await saves.import("slot", text);
  const loaded = await saves.load("slot");
  if (!loaded) throw new Error("nothing loaded");
  const store = createStore(loaded.state);
  const story = createStory(store, createEventRecord(store), passages, { start: "Start" });
  return { loaded, story, saves };
}

afterEach(() => {
  _resetMigrations();
});

describe("save migrations (#100)", () => {
  it("bring a fixture save from 1.0.0 up to 1.2.0, step by step", async () => {
    declareSteps();
    const { loaded, story } = await loadInto(fixture);
    expect(loaded.summary).toMatchObject({
      game: { version: "1.0.0" },
      sameGameVersion: false,
      migratedThrough: ["1.0.0", "1.1.0", "1.2.0"],
      passage: "Yard",
    });
    expect(story.current).toBe("Yard");
    expect([lamp.oil, door.isOpen, hero.holding?.id, hero.near]).toEqual([2, true, "lamp", null]);
  });

  it("refuse a save no step leads from, clearly, once the game has steps", async () => {
    declareSteps();
    const old = fixture.replace('"version":"1.0.0"', '"version":"0.9.0"');
    await expect(loadInto(old)).rejects.toThrow(
      "save: this save is from version 0.9.0 of the game, and no migration leads from it to 1.2.0, the version running. The game's migrations start from 1.0.0, 1.1.0.",
    );
    const saves = createSaves({ storage: createMemoryStorage(), game });
    expect(await saves.list()).toEqual([]);
  });

  it("say which step failed", async () => {
    migrate({ from: "1.0.0", to: "1.2.0" }, (save) => {
      save.rename("door", "hero");
    });
    await expect(loadInto(fixture)).rejects.toThrow(
      'save: the migration from 1.0.0 to 1.2.0 failed: rename "door" to "hero": the save already has "hero".',
    );
  });

  it("aren't needed when a game has none: an older save loads as it is", async () => {
    const { loaded } = await loadInto(fixture);
    expect(loaded.summary.migratedThrough).toBeUndefined();
    expect(loaded.state.oldLamp).toEqual({ oil: 2 });
  });

  it("can't declare two steps from one version, or a step to itself", () => {
    declareSteps();
    expect(() => migrate({ from: "1.0.0", to: "1.0.1" }, () => undefined)).toThrow(
      'there\'s already a step from "1.0.0", to "1.1.0"',
    );
    expect(() => migrate({ from: "2.0.0", to: "2.0.0" }, () => undefined)).toThrow(
      "it goes from a version to itself",
    );
  });
});
