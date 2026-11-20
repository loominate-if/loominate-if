import { beforeEach, describe, expect, it } from "vitest";
import { createEventRecord } from "../events/record.js";
import { createStory, type Passage, type PassageNode } from "../passages/story.js";
import { createHistory } from "../state/history.js";
import { createStore, type StateSnapshot, type StateStore } from "../state/store.js";
import { StateError } from "../state/value.js";
import {
  describeObjects,
  instancesOf,
  mixin,
  object,
  resetObjects,
  spawn,
  template,
  type Handle,
} from "./objects.js";

const text = (t: string): PassageNode => ({ type: "text", text: t });

/** Starts a story over a store, which binds objects to it. */
function play(
  snapshot: StateSnapshot = {},
  passages: Passage[] = [{ id: "Start", tags: [], body: () => [] }],
) {
  const store = createStore(snapshot);
  const story = createStory(store, createEventRecord(store), passages, {
    start: passages[0]?.id ?? "Start",
  });
  return { store, story };
}

beforeEach(() => {
  resetObjects();
});

describe("object", () => {
  it("reads defaults, and stores only values that differ from them", () => {
    const lantern = object("lantern", { name: "brass lantern", isLit: false, fuel: 3 });
    const { store } = play();
    expect(lantern.id).toBe("lantern");
    expect(lantern.isLit).toBe(false);
    expect(store.entity("lantern")).toBeUndefined();

    lantern.isLit = true;
    lantern.fuel -= 1;
    expect([lantern.isLit, lantern.fuel]).toEqual([true, 2]);
    expect(store.entity("lantern")).toEqual({ fuel: 2, isLit: true });

    lantern.isLit = false;
    expect(store.entity("lantern")).toEqual({ fuel: 2 });
  });

  it("gives methods the object as this, and computes getters without storing them", () => {
    const lantern = object("lantern", {
      name: "lantern",
      isLit: false,
      get theName() {
        return `the ${this.name}`;
      },
      light() {
        this.isLit = true;
      },
    });
    const { store } = play();
    lantern.light();
    expect(lantern.isLit).toBe(true);
    expect(lantern.theName).toBe("the lantern");
    expect(store.entity("lantern")).toEqual({ isLit: true });
  });

  it("rejects new properties, so a typo can't hide state outside the store", () => {
    const lantern = object("lantern", { isLit: false });
    play();
    expect(() => {
      (lantern as unknown as Record<string, unknown>).isLitt = true;
    }).toThrow(TypeError);
  });

  it("reports bad IDs, duplicate IDs, reserved names, and bad defaults", () => {
    object("lantern", { isLit: false });
    expect(() => object("lantern", {})).toThrow(
      'object "lantern" is defined twice; object IDs must be unique.',
    );
    expect(() => object("gen:x", {})).toThrow(
      'object "gen:x": IDs starting with "gen:" are reserved for objects created during play; choose another ID.',
    );
    expect(() => object("$story", {})).toThrow('IDs starting with "$" are reserved for core');
    expect(() => object("", {})).toThrow("object: the ID must be a non-empty string.");
    expect(() => object("a", { id: "x" })).toThrow('"id" is the object\'s ID');
    expect(() => object("b", { $secret: 1 })).toThrow('property "$secret" starts with "$"');
    // @ts-expect-error A Date isn't object data.
    expect(() => object("c", { when: new Date(0) })).toThrow(StateError);
  });

  it("is an error to use an object with no story running", () => {
    const lantern = object("lantern", { isLit: false });
    expect(() => lantern.isLit).toThrow(
      '"lantern".isLit: no story is running. Objects and random streams keep their state in a story\'s state store, so create one with createStory first.',
    );
  });

  it("reaches old saves with a changed default", () => {
    const lantern = object("lantern", { name: "lamp", isLit: false });
    play({ lantern: { isLit: true } });
    expect([lantern.name, lantern.isLit]).toEqual(["lamp", true]);
  });
});

describe("mixin", () => {
  it("types this from its own properties and spreads into definitions", () => {
    const lockable = mixin({
      isLocked: true,
      unlock(key: Handle<{ taken: boolean }>): boolean {
        if (!key.taken) return false;
        this.isLocked = false;
        return true;
      },
    });
    const key = object("key", { taken: false });
    const door = object("door", { ...lockable, name: "door" });
    play();
    expect(door.unlock(key)).toBe(false);
    key.taken = true;
    expect(door.unlock(key)).toBe(true);
    expect(door.isLocked).toBe(false);
  });
});

describe("collections", () => {
  it("change in place, writing a new value for the whole field", () => {
    const player = object("player", {
      notes: [] as string[],
      stats: { strength: 1, wits: 2 } as { strength: number; wits: number; luck?: number },
    });
    const { store } = play();
    player.notes.push("a door");
    player.notes.push("a key");
    player.notes[0] = "the door";
    player.stats.strength += 1;
    player.stats.luck = 3;
    expect(store.entity("player")).toEqual({
      notes: ["the door", "a key"],
      stats: { luck: 3, strength: 2, wits: 2 },
    });
    expect(Object.isFrozen(store.get("player", "notes"))).toBe(true);

    delete player.stats.luck;
    player.notes.splice(0, 1);
    expect(store.entity("player")).toEqual({ notes: ["a key"], stats: { strength: 2, wits: 2 } });
    player.notes.pop();
    player.stats.strength = 1;
    expect(store.entity("player")).toBeUndefined();
  });

  it("behave as arrays and plain objects", () => {
    const player = object("player", { notes: ["a", "b"], stats: { strength: 1 } });
    play();
    expect(Array.isArray(player.notes)).toBe(true);
    expect([...player.notes]).toEqual(["a", "b"]);
    expect(player.notes.includes("b")).toBe(true);
    expect(player.notes.length).toBe(2);
    expect(JSON.stringify(player)).toBe('{"notes":["a","b"],"stats":{"strength":1}}');
    expect({ ...player.stats }).toEqual({ strength: 1 });
    expect(Object.keys(player.stats)).toEqual(["strength"]);
    const upper = player.notes.map((n) => n.toUpperCase());
    upper.push("C");
    expect(upper).toEqual(["A", "B", "C"]);
    expect(player.notes).toEqual(["a", "b"]);
  });

  it("are the same view each read, and always read the current state", () => {
    const player = object("player", { notes: [] as string[] });
    const { store } = play();
    const history = createHistory(store);
    expect(player.notes).toBe(player.notes);
    const notes = player.notes;
    notes.push("x");
    history.checkpoint();
    history.undo();
    expect(notes.length).toBe(0);
    history.redo();
    expect([...notes]).toEqual(["x"]);
  });

  it("nest", () => {
    const map = object("map", { rooms: [{ name: "hall", exits: ["north"] }] });
    const { store } = play();
    map.rooms[0]?.exits.push("south");
    expect(store.get("map", "rooms")).toEqual([{ name: "hall", exits: ["north", "south"] }]);
  });

  it("refuse holes and reserved keys", () => {
    const player = object("player", { notes: ["a", "b"], bag: {} as Record<string, string> });
    play();
    expect(() => {
      delete player.notes[0];
    }).toThrow("deleting an array element would leave a hole; use splice to remove it.");
    expect(() => {
      player.bag.$ref = "x";
    }).toThrow('"$ref" is reserved for references between objects');
  });
});

describe("references", () => {
  it("are stored as IDs and read back as the same object", () => {
    const kitchen = object("kitchen", { name: "kitchen" });
    const cellar = object("cellar", { name: "cellar" });
    const key = object("key", { location: kitchen as Handle<{ name: string }> | null });
    const player = object("player", { inventory: [] as Handle<object>[] });
    const { store } = play();

    expect(key.location).toBe(kitchen);
    key.location = cellar;
    expect(key.location).toBe(cellar);
    expect(key.location?.name).toBe("cellar");
    player.inventory.push(key);
    expect(player.inventory[0]).toBe(key);
    expect(player.inventory.includes(key)).toBe(true);
    expect(store.entity("key")).toEqual({ location: { $ref: "cellar" } });
    expect(store.get("player", "inventory")).toEqual([{ $ref: "key" }]);
    key.location = kitchen;
    expect(store.entity("key")).toBeUndefined();
  });

  it("report a reference to an object that doesn't exist", () => {
    const key = object("key", { location: null as Handle<object> | null });
    play({ key: { location: { $ref: "nowhere" } } });
    expect(() => key.location).toThrow(
      '"key".location refers to object "nowhere", which doesn\'t exist.',
    );
  });
});

describe("templates", () => {
  function scene() {
    const match = template("match", {
      isLit: true,
      burnOut() {
        this.isLit = false;
      },
    });
    const matchbox = object("matchbox", { count: 3 });
    return { match, matchbox };
  }

  it("spawn objects with IDs from their origin", () => {
    const { match, matchbox } = scene();
    const { store } = play();
    const a = spawn(match, matchbox);
    const b = spawn(match, matchbox);
    const spare = spawn(match, matchbox, "spare");
    expect([a.id, b.id, spare.id]).toEqual([
      "gen:matchbox:match-1",
      "gen:matchbox:match-2",
      "gen:matchbox:spare",
    ]);
    a.burnOut();
    expect(a.isLit).toBe(false);
    expect(b.isLit).toBe(true);
    expect(instancesOf(match)).toEqual([a, b, spare]);
    expect(instancesOf(match)[0]).toBe(a);
    expect(store.get("matchbox", "$spawned:match")).toBe(2);
    expect(() => spawn(match, matchbox, "spare")).toThrow("already exists");
  });

  it("give the same IDs after undo, and survive save and load", () => {
    const { match, matchbox } = scene();
    const { store } = play();
    const history = createHistory(store);
    spawn(match, matchbox);
    history.checkpoint();
    const second = spawn(match, matchbox);
    second.burnOut();
    history.checkpoint();
    history.undo();
    expect(instancesOf(match).map((m) => m.id)).toEqual(["gen:matchbox:match-1"]);
    expect(spawn(match, matchbox).id).toBe("gen:matchbox:match-2");
    history.checkpoint();

    const saved = JSON.parse(JSON.stringify(store.snapshot())) as StateSnapshot;
    const loaded = play(saved);
    expect(loaded.store.snapshot()).toEqual(saved);
    const [first, again] = instancesOf(match);
    expect(again?.isLit).toBe(true);
    first?.burnOut();
    expect(loaded.store.get("gen:matchbox:match-1", "isLit")).toBe(false);
  });

  it("reject bad names", () => {
    template("match", {});
    expect(() => template("match", {})).toThrow('template "match" is defined twice');
    expect(() => template("a:b", {})).toThrow("can't contain");
  });
});

describe("in a story", () => {
  it("refuses changes while rendering", () => {
    const lantern = object("lantern", { isLit: false });
    const match = template("match", {});
    const { story } = play({}, [
      { id: "A", tags: [], body: () => [text("ok")] },
      {
        id: "Bad",
        tags: [],
        body: () => {
          lantern.isLit = true;
          return [];
        },
      },
      {
        id: "Spawning",
        tags: [],
        body: () => {
          spawn(match, lantern);
          return [];
        },
      },
    ]);
    story.begin();
    expect(() => {
      story.goTo("Bad");
    }).toThrow(
      'passage "Bad": rendering tried to change "lantern".isLit. Rendering must be pure; change state in an effect phase such as {on enter: …} instead.',
    );
    expect(lantern.isLit).toBe(false);
    expect(() => {
      story.goTo("Spawning");
    }).toThrow('passage "Spawning": rendering tried to change spawn "match" from "lantern".');
  });

  /** The bench/object-syntax scene, with hand-written compiled passages. */
  it("plays a walkthrough with undo, save and load, and replay", () => {
    const player = object("player", { fear: 0, inventory: [] as Handle<object>[] });
    const lantern = object("lantern", {
      name: "brass lantern",
      isLit: false,
      light() {
        this.isLit = true;
      },
    });
    const lockable = mixin({
      isLocked: true,
      unlock(key: Handle<object>): boolean {
        if (!player.inventory.includes(key)) return false;
        this.isLocked = false;
        return true;
      },
    });
    const key = object("key", { name: "iron key" });
    const door = object("cellar door", { ...lockable });
    const match = template("match", { isLit: true });
    const matchbox = object("matchbox", {
      count: 2,
      strike() {
        if (this.count === 0) return;
        this.count -= 1;
        spawn(match, this);
        lantern.light();
      },
    });
    const link = (label: string, target: string, open = true): PassageNode => ({
      type: "link",
      label,
      target,
      guard: { open, condition: "" },
    });
    const passages: Passage[] = [
      {
        id: "Kitchen",
        tags: [],
        body: () => [
          text(`You carry ${String(player.inventory.length)} things.`),
          link("Take lantern", "Take Lantern", !player.inventory.includes(lantern)),
          link("Take key", "Take Key", !player.inventory.includes(key)),
          link("Strike", "Strike", player.inventory.includes(lantern)),
          link("Down", "Stairs"),
        ],
      },
      {
        id: "Take Lantern",
        tags: [],
        effects: { enter: () => player.inventory.push(lantern) },
        body: () => [link("Back", "Kitchen")],
      },
      {
        id: "Take Key",
        tags: [],
        effects: { enter: () => player.inventory.push(key) },
        body: () => [link("Back", "Kitchen")],
      },
      {
        id: "Strike",
        tags: [],
        effects: { enter: () => matchbox.strike() },
        body: () => [link("Back", "Kitchen")],
      },
      {
        id: "Stairs",
        tags: [],
        effects: {
          enter: () => {
            if (!lantern.isLit) player.fear += 1;
            door.unlock(key);
          },
        },
        body: () => [text(door.isLocked ? "Locked." : "Open."), link("Up", "Kitchen")],
      },
    ];

    const store: StateStore = createStore();
    const story = createStory(store, createEventRecord(store), passages, { start: "Kitchen" });
    const history = createHistory(store);
    const go = (label: string): void => {
      const choice = story.render().choices.find((c) => c.label === label);
      if (!choice) throw new Error(`no choice ${label}`);
      story.follow(choice);
      history.checkpoint(label);
    };
    story.begin();
    history.checkpoint();
    const route = [
      "Down",
      "Up",
      "Take lantern",
      "Back",
      "Strike",
      "Back",
      "Take key",
      "Back",
      "Down",
    ];
    for (const label of route) go(label);

    expect(player.fear).toBe(1);
    expect(player.inventory).toEqual([lantern, key]);
    expect(door.isLocked).toBe(false);
    expect(instancesOf(match).map((m) => m.id)).toEqual(["gen:matchbox:match-1"]);
    expect(story.render().nodes[0]).toEqual(text("Open."));
    const final = store.snapshot();

    // Undo to before the strike, then strike again: the same ID comes back.
    while (store.get("matchbox", "count") !== undefined) history.undo();
    expect(instancesOf(match)).toEqual([]);
    expect(lantern.isLit).toBe(false);
    for (let i = 0; i < 4; i++) history.redo();
    expect(instancesOf(match).map((m) => m.id)).toEqual(["gen:matchbox:match-1"]);

    // Load the save into a fresh story.
    const saved = JSON.parse(JSON.stringify(final)) as StateSnapshot;
    const loadedStore = createStore(saved);
    const loaded = createStory(loadedStore, createEventRecord(loadedStore), passages, {
      start: "Kitchen",
    });
    expect(loaded.render().nodes[0]).toEqual(text("Open."));
    expect(player.inventory[1]).toBe(key);

    // Replay the same route from scratch: the same state.
    const replayStore = createStore();
    const replay = createStory(replayStore, createEventRecord(replayStore), passages, {
      start: "Kitchen",
    });
    replay.begin();
    for (const label of route) {
      const choice = replay.render().choices.find((c) => c.label === label);
      if (!choice) throw new Error(`no choice ${label}`);
      replay.follow(choice);
    }
    expect(replayStore.snapshot()).toEqual(final);
  });
});

describe("describeObjects", () => {
  it("gives every object with every data property, and whether each is still the default", () => {
    const shed = object("shed", { name: "shed" });
    const lamp = object("lamp", {
      lit: false,
      oil: 3,
      where: shed,
      get glowing() {
        return this.lit;
      },
      light() {
        this.lit = true;
      },
    });
    const matchbox = object("matchbox", { count: 2 });
    const match = template("match", { struck: false });
    const { store } = play();
    lamp.light();
    spawn(match, matchbox).struck = true;
    const before = store.snapshot();
    expect(describeObjects(store)).toEqual([
      {
        id: "lamp",
        properties: [
          { key: "lit", value: true, isDefault: false },
          { key: "oil", value: 3, isDefault: true },
          { key: "where", value: { $ref: "shed" }, isDefault: true },
        ],
      },
      { id: "matchbox", properties: [{ key: "count", value: 2, isDefault: true }] },
      { id: "shed", properties: [{ key: "name", value: "shed", isDefault: true }] },
      {
        id: "gen:matchbox:match-1",
        template: "match",
        properties: [{ key: "struck", value: true, isDefault: false }],
      },
    ]);
    // Reading changes nothing.
    expect(store.snapshot()).toEqual(before);
  });

  it("reads the store it's given, such as a saved game's, not the story's", () => {
    object("lamp", { lit: false });
    play();
    const saved = createStore({ lamp: { lit: true } });
    expect(describeObjects(saved)).toEqual([
      { id: "lamp", properties: [{ key: "lit", value: true, isDefault: false }] },
    ]);
  });
});
