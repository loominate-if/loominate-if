import { describe, expect, it } from "vitest";
import { createHistory } from "./history.js";
import { createInstances, instanceId, type Template } from "./instances.js";
import { createStore, type StateDiff, type StateStore } from "./store.js";
import { StateError } from "./value.js";

// A type alias, not an interface: interfaces don't satisfy StateValue's index signature.
type RoomParams = {
  readonly depth: number;
  readonly theme: string;
};

const room = {
  name: "room",
  init: (p: RoomParams) => ({ visited: false, loot: p.depth * 10 }),
  // Behavior lives on the template; instances only hold data.
  describe: (p: RoomParams) => `A ${p.theme} room, ${String(p.depth)} levels down.`,
} satisfies Template<RoomParams> & { describe(p: RoomParams): string };

const chest = { name: "chest", init: () => ({ open: false }) } satisfies Template<null>;

const marker = { name: "marker" } satisfies Template<string>;

function setup(snapshot = {}) {
  const store = createStore(snapshot);
  return { store, instances: createInstances(store, [room, chest, marker]) };
}

describe("instanceId", () => {
  it("derives IDs from origin and key", () => {
    expect(instanceId("crypt-3", "room-7")).toBe("gen:crypt-3:room-7");
    expect(instanceId("gen:crypt-3:room-7", "chest")).toBe("gen:crypt-3:room-7:chest");
  });

  it("rejects keys that would make IDs ambiguous", () => {
    expect(() => instanceId("crypt-3", "")).toThrow(StateError);
    expect(() => instanceId("crypt-3", "a:b")).toThrow(/without ":"/);
    expect(() => instanceId("", "room-7")).toThrow(/origin must be a non-empty ID/);
  });
});

describe("createInstances", () => {
  it("stores template, params, and initial fields in the state store", () => {
    const { store, instances } = setup();
    const ref = instances.create(room, "crypt-3", "room-7", { depth: 2, theme: "damp" });
    expect(ref.id).toBe("gen:crypt-3:room-7");
    expect(ref.params).toEqual({ depth: 2, theme: "damp" });
    expect(ref.template.describe(ref.params)).toBe("A damp room, 2 levels down.");
    expect(store.entity(ref.id)).toEqual({
      $params: { depth: 2, theme: "damp" },
      $template: "room",
      loot: 20,
      visited: false,
    });
  });

  it("checks params against the template type at compile time, not at runtime", () => {
    const { instances } = setup();
    // @ts-expect-error -- depth must be a number
    expect(() => instances.create(room, "crypt", "r", { depth: "2", theme: "x" })).not.toThrow();
    const rooms = instances.find(room);
    const depth: number = rooms[0]?.params.depth ?? 0;
    expect(depth).toBe("2");
  });

  it("refuses duplicate IDs, unregistered templates, and reserved fields", () => {
    const { instances } = setup();
    instances.create(chest, "cellar", "chest", null);
    expect(() => instances.create(chest, "cellar", "chest", null)).toThrow(
      /already exists. Give each instance a key that's unique within its origin/,
    );
    const stray = { name: "stray" } satisfies Template<null>;
    expect(() => instances.create(stray, "cellar", "x", null)).toThrow(/isn't registered/);
    const sneaky = { name: "room", init: () => ({}) } satisfies Template<null>;
    expect(() => instances.create(sneaky, "cellar", "y", null)).toThrow(/isn't registered/);
    const reserved = {
      name: "reserved",
      init: () => ({ $template: "x" }),
    } satisfies Template<null>;
    const store = createStore();
    expect(() => createInstances(store, [reserved]).create(reserved, "a", "b", null)).toThrow(
      /reserved/,
    );
    expect(store.ids()).toEqual([]);
  });

  it("leaves no half-made instance when params or fields are invalid", () => {
    const bad = {
      name: "bad",
      init: () => ({ when: new Date(0) as never }),
    } satisfies Template<null>;
    const store = createStore();
    const instances = createInstances(store, [bad, marker]);
    expect(() => instances.create(bad, "a", "b", null)).toThrow(/a Date can't be stored/);
    expect(() => instances.create(marker, "a", "c", Number.NaN as never)).toThrow(/NaN/);
    expect(store.ids()).toEqual([]);
  });

  it("rejects templates with duplicate or empty names", () => {
    expect(() => createInstances(createStore(), [chest, { name: "chest" }])).toThrow(
      /two templates are named "chest"/,
    );
    expect(() => createInstances(createStore(), [{ name: "" }])).toThrow(/has no name/);
  });

  it("finds instances by template, sorted by ID, ignoring static entities", () => {
    const { store, instances } = setup();
    store.set("cellar", "dark", true);
    instances.create(room, "crypt", "b", { depth: 1, theme: "x" });
    instances.create(chest, "crypt", "a", null);
    instances.create(room, "crypt", "a-room", { depth: 1, theme: "y" });
    expect(instances.find(room).map((r) => r.id)).toEqual(["gen:crypt:a-room", "gen:crypt:b"]);
    expect(instances.find().map((r) => r.id)).toEqual([
      "gen:crypt:a",
      "gen:crypt:a-room",
      "gen:crypt:b",
    ]);
    expect(instances.get("cellar")).toBeUndefined();
    expect(instances.get("gen:crypt:a")?.template).toBe(chest);
  });

  it("removes an instance and all its fields, but never a static entity", () => {
    const { store, instances } = setup();
    const ref = instances.create(chest, "cellar", "chest", null);
    store.set(ref.id, "open", true);
    instances.remove(ref.id);
    expect(store.entity(ref.id)).toBeUndefined();
    store.set("cellar", "dark", true);
    expect(() => instances.remove("cellar")).toThrow(/isn't a runtime instance/);
    expect(store.get("cellar", "dark")).toBe(true);
  });

  it("explains a saved instance whose template is missing", () => {
    const store = createStore({ "gen:a:b": { $template: "ghost", $params: null } });
    const instances = createInstances(store, [chest]);
    expect(() => instances.get("gen:a:b")).toThrow(
      `instance "gen:a:b" uses template "ghost", which isn't registered. Pass it to createInstances.`,
    );
  });
});

describe("instances across save, undo, and replay", () => {
  it("survive save and load", () => {
    const { store, instances } = setup();
    instances.create(room, "crypt", "r1", { depth: 3, theme: "dry" });
    store.set("gen:crypt:r1", "visited", true);
    const loaded = setup(JSON.parse(JSON.stringify(store.snapshot())));
    const ref = loaded.instances.get("gen:crypt:r1");
    expect(ref?.template).toBe(room);
    expect(ref?.params).toEqual({ depth: 3, theme: "dry" });
    expect(loaded.store.get("gen:crypt:r1", "visited")).toBe(true);
  });

  it("undo removes a created instance and redo restores it", () => {
    const { store, instances } = setup();
    const history = createHistory(store);
    instances.create(chest, "cellar", "chest", null);
    history.checkpoint("open the cellar");
    history.undo();
    expect(instances.find()).toEqual([]);
    history.redo();
    expect(instances.get("gen:cellar:chest")?.template).toBe(chest);
  });

  it("undo brings back a removed instance", () => {
    const { store, instances } = setup();
    const history = createHistory(store);
    instances.create(chest, "cellar", "chest", null);
    store.set("gen:cellar:chest", "open", true);
    history.checkpoint();
    instances.remove("gen:cellar:chest");
    history.checkpoint();
    history.undo();
    expect(store.get("gen:cellar:chest", "open")).toBe(true);
  });

  it("replay rebuilds the same instances", () => {
    const { store, instances } = setup();
    const diffs: StateDiff[] = [];
    instances.create(room, "crypt", "r1", { depth: 1, theme: "a" });
    diffs.push(store.commit());
    instances.create(chest, "gen:crypt:r1", "chest", null);
    diffs.push(store.commit());
    const replay = setup();
    for (const diff of JSON.parse(JSON.stringify(diffs)) as StateDiff[]) replay.store.apply(diff);
    expect(replay.store.snapshot()).toEqual(store.snapshot());
    expect(replay.instances.find().map((r) => r.id)).toEqual([
      "gen:crypt:r1",
      "gen:crypt:r1:chest",
    ]);
  });
});

describe("determinism", () => {
  /** Mulberry32: a tiny seeded PRNG, standing in for core's random streams (#24). */
  function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Generates a crypt level per "descend" action, from the seed alone. */
  function play(seed: number, actions: readonly string[]): StateStore {
    const { store, instances } = setup();
    const roll = rng(seed);
    let level = 0;
    for (const action of actions) {
      if (action !== "descend") continue;
      level += 1;
      const crypt = `crypt-${String(level)}`;
      const rooms = 1 + Math.floor(roll() * 4);
      for (let r = 1; r <= rooms; r++) {
        const theme = roll() < 0.5 ? "damp" : "dry";
        const ref = instances.create(room, crypt, `room-${String(r)}`, { depth: level, theme });
        if (roll() < 0.5) instances.create(chest, ref.id, "chest", null);
      }
      store.commit();
    }
    return store;
  }

  const actions = ["look", "descend", "wait", "descend", "descend"];

  it("produces identical instance IDs and state from the same seed and actions", () => {
    const a = play(42, actions);
    const b = play(42, actions);
    expect(a.ids()).toEqual(b.ids());
    expect(JSON.stringify(a.snapshot())).toBe(JSON.stringify(b.snapshot()));
    expect(a.ids().every((id) => /^gen:crypt-\d+:room-\d+(:chest)?$/.test(id))).toBe(true);
  });

  it("produces different worlds from different seeds", () => {
    expect(JSON.stringify(play(1, actions).snapshot())).not.toBe(
      JSON.stringify(play(2, actions).snapshot()),
    );
  });
});
