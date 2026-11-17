import { afterEach, describe, expect, it } from "vitest";
import { createEventRecord } from "../events/record.js";
import { resetObjects } from "../objects/objects.js";
import { createStory, type LinkNode, type Passage } from "../passages/story.js";
import { randomStream } from "../random/random.js";
import { createHistory } from "../state/history.js";
import { createStore, type StateSnapshot } from "../state/store.js";
import { StateError } from "../state/value.js";
import {
  createMemoryStorage,
  createSave,
  createSaves,
  ENGINE_VERSION,
  readSave,
  writeSave,
  type SaveStorage,
} from "./save.js";

afterEach(() => {
  resetObjects();
});

const game = { id: "lantern-road", version: "1.0.0" };
const weather = randomStream("weather");
const walk: LinkNode = { type: "link", label: "Walk on", target: "Road" };

const passages: Passage[] = [
  {
    id: "Road",
    tags: [],
    effects: {
      enter: ({ state }) => {
        state.set("road", "weather", weather.pick(["rain", "fog", "sun", "snow"]));
      },
    },
    body: ({ state }) => [
      { type: "text", text: `The road, in ${String(state.get("road", "weather"))}.` },
      walk,
    ],
  },
];

function play(snapshot?: StateSnapshot) {
  resetObjects();
  const store = createStore(snapshot);
  const record = createEventRecord(store);
  const story = createStory(store, record, passages, { start: "Road", seed: "fog-bound" });
  story.begin();
  return { store, record, story };
}

/** A clock that ticks one minute per save, so saves sort predictably. */
function clock() {
  let minute = 0;
  return () => new Date(Date.UTC(2026, 10, 17, 12, minute++));
}

const narrative = (r: ReturnType<typeof play>["record"]) =>
  r.events({ kinds: ["narrative"] }).map((e) => e.text);

describe("saving and loading", () => {
  it("carries on exactly where the save was made", async () => {
    const saves = createSaves({ storage: createMemoryStorage(), game, now: clock() });
    const original = play();
    original.story.follow(walk);
    const summary = await saves.save("before the bridge", original.store, { label: "Bridge" });
    expect(summary).toEqual({
      format: "loominate-save",
      version: 1,
      game,
      engine: ENGINE_VERSION,
      savedAt: "2026-11-17T12:00:00.000Z",
      label: "Bridge",
      slot: "before the bridge",
      passage: "Road",
      sameGameVersion: true,
    });
    for (let i = 0; i < 3; i++) original.story.follow(walk);

    const loaded = await saves.load("before the bridge");
    expect(loaded?.summary).toEqual(summary);
    const resumed = play(loaded?.state);
    // A fresh undo history: nothing to undo straight after loading.
    expect(createHistory(resumed.store).canUndo).toBe(false);
    for (let i = 0; i < 3; i++) resumed.story.follow(walk);
    // The same rolls, the same record, the same action log.
    expect(resumed.store.snapshot()).toEqual(original.store.snapshot());
    expect(narrative(resumed.record)).toEqual(narrative(original.record));
  });

  it("autosaves to one slot, which named saves can't use", async () => {
    const storage = createMemoryStorage();
    const saves = createSaves({ storage, game, now: clock() });
    const { store, story } = play();
    await saves.autosave(store);
    story.follow(walk);
    const latest = await saves.autosave(store);
    expect(await storage.slots()).toEqual(["autosave"]);
    expect((await saves.load("autosave"))?.summary).toEqual(latest);
    await expect(saves.save("autosave", store)).rejects.toThrow(
      `save: the slot "autosave" is for autosave(); give the save another name.`,
    );
    await expect(saves.save("", store)).rejects.toThrow("save: a slot name must be non-empty.");
  });

  it("lists slots newest first, with unreadable ones last and why", async () => {
    const storage = createMemoryStorage();
    const saves = createSaves({ storage, game, now: clock() });
    const { store } = play();
    await saves.save("b", store);
    await saves.save("a", store);
    await saves.autosave(store);
    storage.set("broken", "{");
    const old = createSaves({
      storage,
      game: { ...game, version: "0.9.0" },
      now: () => new Date(Date.UTC(2026, 10, 17, 13)),
    });
    await old.save("old", store);
    const list = await saves.list();
    expect(list.map((s) => s.slot)).toEqual(["old", "autosave", "a", "b", "broken"]);
    expect(list[0]).toMatchObject({ sameGameVersion: false, game: { version: "0.9.0" } });
    expect(list[1]).toMatchObject({ sameGameVersion: true });
    expect(list[4]).toEqual({
      slot: "broken",
      problem: expect.stringMatching(/^save: the file isn't valid JSON/) as unknown,
    });
  });

  it("loads a save from another version of the game, and says so", async () => {
    const storage = createMemoryStorage();
    const { store } = play();
    await createSaves({ storage, game: { ...game, version: "0.9.0" } }).save("old", store);
    const loaded = await createSaves({ storage, game }).load("old");
    expect(loaded?.summary.sameGameVersion).toBe(false);
    expect(loaded?.state).toEqual(store.snapshot());
  });

  it("refuses a save from another game", async () => {
    const storage = createMemoryStorage();
    await createSaves({ storage, game: { id: "other", version: "1.0.0" } }).save("x", play().store);
    await expect(createSaves({ storage, game }).load("x")).rejects.toThrow(
      `save: this save is from the game "other", not "lantern-road".`,
    );
  });

  it("returns nothing for an empty slot, and deletes slots", async () => {
    const saves = createSaves({ storage: createMemoryStorage(), game });
    expect(await saves.load("nothing")).toBeUndefined();
    expect(await saves.export("nothing")).toBeUndefined();
    await saves.save("x", play().store);
    expect(await saves.delete("x")).toBe(true);
    expect(await saves.delete("x")).toBe(false);
    expect(await saves.list()).toEqual([]);
  });

  it("works over asynchronous storage", async () => {
    const memory = createMemoryStorage();
    const later = <T>(value: T) => Promise.resolve(value);
    const storage: SaveStorage = {
      get: async (slot) => later(await memory.get(slot)),
      set: async (slot, text) => later(await memory.set(slot, text)),
      delete: async (slot) => later(await memory.delete(slot)),
      slots: async () => later(await memory.slots()),
    };
    const saves = createSaves({ storage, game });
    await saves.save("x", play().store);
    expect((await saves.list()).map((s) => s.slot)).toEqual(["x"]);
  });
});

describe("export and import", () => {
  it("round-trips a save file exactly", async () => {
    const saves = createSaves({ storage: createMemoryStorage(), game, now: clock() });
    const { store, story } = play();
    story.follow(walk);
    await saves.save("x", store, { label: "Road" });
    const text = await saves.export("x");
    expect(text).toBeDefined();
    const elsewhere = createSaves({ storage: createMemoryStorage(), game });
    const summary = await elsewhere.import("from a friend", text ?? "");
    expect(summary).toMatchObject({ slot: "from a friend", label: "Road" });
    expect(await elsewhere.export("from a friend")).toBe(text);
    expect((await elsewhere.load("from a friend"))?.state).toEqual(store.snapshot());
    expect(writeSave(readSave(text ?? ""))).toBe(text);
  });

  it("refuses a file that can't be loaded, and leaves the slot alone", async () => {
    const storage = createMemoryStorage();
    const saves = createSaves({ storage, game });
    await saves.save("x", play().store);
    const before = await saves.export("x");
    await expect(saves.import("x", "{}")).rejects.toThrow(/isn't a save file/);
    const other = writeSave(
      createSave(play().store, { game: { id: "other", version: "1" }, savedAt: new Date(0) }),
    );
    await expect(saves.import("x", other)).rejects.toThrow(/from the game "other"/);
    expect(await saves.export("x")).toBe(before);
  });
});

describe("save files", () => {
  const file = (fields: Record<string, unknown> = {}) =>
    JSON.stringify({
      format: "loominate-save",
      version: 1,
      game,
      engine: "0.0.0",
      savedAt: "2026-11-17T12:00:00.000Z",
      state: { road: { weather: "fog" } },
      ...fields,
    });

  it("are written with fields in a fixed order", () => {
    const save = readSave(file({ label: "L" }));
    const { state, ...rest } = save;
    const shuffled = { state, ...rest };
    expect(writeSave(shuffled)).toBe(
      `{"format":"loominate-save","version":1,"game":{"id":"lantern-road","version":"1.0.0"},"engine":"0.0.0","savedAt":"2026-11-17T12:00:00.000Z","label":"L","state":{"road":{"weather":"fog"}}}\n`,
    );
  });

  it("explain what's wrong with a file that can't be read", () => {
    expect(() => readSave("nope")).toThrow(/^save: the file isn't valid JSON \(/);
    expect(() => readSave(JSON.stringify({ format: "loominate-replay" }))).toThrow(
      `save: this isn't a save file; it needs "format": "loominate-save".`,
    );
    expect(() => readSave(file({ version: 2 }))).toThrow(
      "save: the file is version 2, made by a newer engine; this one reads version 1.",
    );
    expect(() => readSave(file({ version: 0 }))).toThrow(`save: "version" must be 1.`);
    expect(() => readSave(file({ extra: 1 }))).toThrow(
      `save: the file has an unknown field "extra"; expected "format", "version", "game", "engine", "savedAt", "label", "state".`,
    );
    expect(() => readSave(file({ game: { id: "x" } }))).toThrow(
      `save: "game" needs a non-empty "id" and "version".`,
    );
    expect(() => readSave(file({ game: { ...game, title: "t" } }))).toThrow(
      `save: "game" has an unknown field "title"`,
    );
    expect(() => readSave(file({ engine: "" }))).toThrow(
      `save: "engine" must be a version string.`,
    );
    expect(() => readSave(file({ savedAt: "yesterday" }))).toThrow(
      `save: "savedAt" must be an ISO 8601 timestamp.`,
    );
    expect(() => readSave(file({ label: 3 }))).toThrow(`save: "label" must be a string.`);
    expect(() => readSave(file({ state: [] }))).toThrow(
      `save: "state" must be an object of entities.`,
    );
    // The state is checked like any snapshot.
    expect(() => readSave(file({ state: { road: 5 } }))).toThrow(StateError);
  });

  it("need a game with an id and version", () => {
    expect(() =>
      createSaves({ storage: createMemoryStorage(), game: { id: "", version: "1" } }),
    ).toThrow("createSaves: the game needs a non-empty id and version.");
    expect(() => createSave(play().store, { game, savedAt: new Date(Number.NaN) })).toThrow(
      "createSave: savedAt isn't a valid date.",
    );
  });
});
