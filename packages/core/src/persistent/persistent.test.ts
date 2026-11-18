import { afterEach, describe, expect, it } from "vitest";
import { createEventRecord } from "../events/record.js";
import { resetObjects } from "../objects/objects.js";
import { createStory, type LinkNode, type Passage } from "../passages/story.js";
import { randomStream } from "../random/random.js";
import { readReplay, writeReplay } from "../replay/replay.js";
import { createMemoryStorage, createSaves } from "../save/save.js";
import { createHistory } from "../state/history.js";
import { createStore, type StateSnapshot } from "../state/store.js";
import { StateError } from "../state/value.js";
import {
  createPersistent,
  openPersistent,
  readPersistent,
  writePersistent,
  type PersistentStorage,
  type PersistentStore,
} from "./persistent.js";

afterEach(() => {
  resetObjects();
});

const game = { id: "lantern-road", version: "1.0.0" };
const fate = randomStream("fate");
const onward: LinkNode = { type: "link", label: "Onward", target: "End" };
const back: LinkNode = { type: "link", label: "Again", target: "Start" };

/**
 * A tiny roguelike: each ending is remembered across playthroughs, and once the
 * player has seen one, the start passage rolls differently (meta-progression).
 */
const passages: Passage[] = [
  {
    id: "Start",
    tags: [],
    effects: {
      enter: ({ state, persistent }) => {
        const runs = (persistent.get("meta", "runs") as number | undefined) ?? 0;
        persistent.set("meta", "runs", runs + 1);
        const veteran = persistent.has("endings", "end");
        state.set("run", "luck", fate.int(1, veteran ? 20 : 6));
      },
    },
    body: ({ state, persistent }) => [
      {
        type: "text",
        text: `Run ${String(persistent.get("meta", "runs"))}, luck ${String(state.get("run", "luck"))}.`,
      },
      onward,
    ],
  },
  {
    id: "End",
    tags: [],
    effects: {
      enter: ({ persistent }) => {
        persistent.set("endings", "end", true);
      },
    },
    body: ({ persistent }) => [
      { type: "text", text: `Endings seen: ${String(persistent.ids().length)}.` },
      back,
    ],
  },
  {
    id: "Trap",
    tags: [],
    effects: {
      enter: ({ persistent }) => {
        persistent.set("endings", "trap", true);
        throw new Error("the floor gives way");
      },
    },
    body: () => [],
  },
];

function play(options: { persistent?: PersistentStore; snapshot?: StateSnapshot } = {}) {
  resetObjects();
  const store = createStore(options.snapshot);
  const record = createEventRecord(store);
  const story = createStory(store, record, passages, {
    start: "Start",
    seed: "s",
    ...(options.persistent !== undefined && { persistent: options.persistent }),
  });
  return { store, record, story };
}

/** Storage that counts writes, so tests can see them. */
function countingStorage(initial?: string) {
  let text = initial;
  const writes: string[] = [];
  const storage: PersistentStorage = {
    read: () => Promise.resolve(text),
    write: (t) => {
      text = t;
      writes.push(t);
      return Promise.resolve();
    },
  };
  return { storage, writes, text: () => text };
}

describe("persistent data in a story", () => {
  it("is written by effects and read while rendering", () => {
    const persistent = createPersistent();
    const { story } = play({ persistent });
    story.begin();
    story.follow(onward);
    expect(persistent.snapshot()).toEqual({ meta: { runs: 1 }, endings: { end: true } });
    expect(story.render().nodes[0]).toMatchObject({ text: "Endings seen: 2." });
  });

  it("isn't touched by undo, restarting, or loading a save", async () => {
    const persistent = createPersistent();
    const saves = createSaves({ storage: createMemoryStorage(), game });
    const first = play({ persistent });
    const history = createHistory(first.store);
    first.story.begin();
    history.checkpoint("begin");
    await saves.save("start", first.store);
    first.story.follow(onward);
    history.checkpoint("onward");
    history.undo();
    expect(persistent.get("endings", "end")).toBe(true);
    // Restart: a new game over the same persistent data.
    const second = play({ persistent });
    second.story.begin();
    expect(persistent.get("meta", "runs")).toBe(2);
    // Load the save made before the ending: the ending is still remembered.
    const loaded = await saves.load("start");
    play({ persistent, ...(loaded && { snapshot: loaded.state }) });
    expect(persistent.snapshot()).toEqual({ meta: { runs: 2 }, endings: { end: true } });
  });

  it("rolls back a failed move's writes", () => {
    const persistent = createPersistent();
    const { story } = play({ persistent });
    story.begin();
    persistent.set("settings", "volume", 3);
    expect(() => {
      story.goTo("Trap");
    }).toThrow(/the floor gives way/);
    expect(persistent.has("endings", "trap")).toBe(false);
    // Writes from before the move stay.
    expect(persistent.get("settings", "volume")).toBe(3);
  });

  it("defaults to an empty store in memory", () => {
    const { story } = play();
    story.begin();
    expect(story.render().nodes[0]).toMatchObject({
      text: expect.stringMatching(/^Run 1, luck \d+\.$/) as unknown,
    });
  });
});

describe("replays with persistent data", () => {
  it("play against the data the story began with, never the player's own", () => {
    // A veteran player: luck rolls up to 20.
    const mine = createPersistent({ endings: { end: true }, meta: { runs: 5 } });
    const original = play({ persistent: mine });
    original.story.begin();
    original.story.follow(onward);
    original.story.follow(back);
    const replay = readReplay(writeReplay(original.story.toReplay(game)));
    expect(replay.persistent).toEqual({ endings: { end: true }, meta: { runs: 5 } });

    // Meanwhile the player's data has moved on; the replay doesn't care.
    mine.set("meta", "runs", 99);
    const before = mine.snapshot();
    const copy = play({ persistent: mine });
    copy.story.playReplay(replay, game);
    expect(copy.store.snapshot()).toEqual(original.store.snapshot());
    expect(mine.snapshot()).toEqual(before);

    // Without the snapshot, a newcomer's rolls differ: the replay needs it.
    const newcomer = play();
    newcomer.story.playReplay({ ...replay, persistent: {} });
    const narrative = (r: typeof original) =>
      r.record.events({ kinds: ["narrative"] }).map((e) => e.text);
    expect(narrative(original)[0]).toMatch(/^Run 6,/);
    expect(narrative(newcomer)[0]).toMatch(/^Run 1,/);
    expect(narrative(newcomer)).not.toEqual(narrative(original));
  });
});

describe("stored persistent data", () => {
  it("survives reopening, separate from save slots, with one write per batch", async () => {
    const { storage, writes, text } = countingStorage();
    const saveSlots = createMemoryStorage();
    const persistent = await openPersistent({ storage, game });
    const { store, story } = play({ persistent });
    story.begin();
    await persistent.flush();
    story.follow(onward);
    persistent.set("settings", "volume", 3);
    persistent.delete("settings", "volume");
    await createSaves({ storage: saveSlots, game }).save("slot", store);
    await persistent.flush();
    // Writes made together are stored together: one for beginning, one for the rest.
    expect(writes).toHaveLength(2);
    expect(text()).toBe(
      `{"format":"loominate-persistent","version":1,"game":{"id":"lantern-road","version":"1.0.0"},"state":{"endings":{"end":true},"meta":{"runs":1}}}\n`,
    );
    expect(await saveSlots.slots()).toEqual(["slot"]);
    const reopened = await openPersistent({ storage, game });
    expect(reopened.snapshot()).toEqual(persistent.snapshot());
  });

  it("starts empty with nothing stored, and reports a failed write on flush", async () => {
    let fail = true;
    const storage: PersistentStorage = {
      read: () => undefined,
      write: () => {
        if (fail) throw new Error("disk full");
      },
    };
    const persistent = await openPersistent({ storage, game });
    expect(persistent.ids()).toEqual([]);
    persistent.set("settings", "volume", 3);
    await expect(persistent.flush()).rejects.toThrow("disk full");
    fail = false;
    persistent.delete("settings", "volume");
    await expect(persistent.flush()).resolves.toBeUndefined();
  });

  it("refuses another game's data, and explains a file it can't read", async () => {
    const other = writePersistent({ id: "other", version: "1" }, {});
    await expect(openPersistent({ storage: countingStorage(other).storage, game })).rejects.toThrow(
      `persistent data: this is the game "other"'s, not "lantern-road"'s.`,
    );
    const file = (fields: Record<string, unknown>) =>
      JSON.stringify({
        format: "loominate-persistent",
        version: 1,
        game,
        state: {},
        ...fields,
      });
    expect(() => readPersistent("{", game.id)).toThrow(
      /^persistent data: the file isn't valid JSON/,
    );
    expect(() => readPersistent("{}", game.id)).toThrow(
      `persistent data: this isn't a persistent data file; it needs "format": "loominate-persistent".`,
    );
    expect(() => readPersistent(file({ version: 2 }), game.id)).toThrow(
      "persistent data: the file is version 2, made by a newer engine; this one reads version 1.",
    );
    expect(() => readPersistent(file({ version: 0 }), game.id)).toThrow(
      `persistent data: "version" must be 1.`,
    );
    expect(() => readPersistent(file({ extra: 1 }), game.id)).toThrow(
      `persistent data: the file has an unknown field "extra"; expected "format", "version", "game", "state".`,
    );
    expect(() => readPersistent(file({ game: {} }), game.id)).toThrow(
      `persistent data: "game" needs an "id" and "version".`,
    );
    expect(() => readPersistent(file({ state: [] }), game.id)).toThrow(
      `persistent data: "state" must be an object of entities.`,
    );
    expect(() => readPersistent(file({ state: { a: 1 } }), game.id)).toThrow(StateError);
  });
});
