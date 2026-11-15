import { describe, expect, it } from "vitest";
import { createStore, invertDiff, type StateDiff, type StateStore } from "./store.js";
import { StateError } from "./value.js";

describe("createStore", () => {
  it("reads and writes fields by entity ID", () => {
    const store = createStore();
    expect(store.get("lantern", "lit")).toBeUndefined();
    store.set("lantern", "lit", true);
    expect(store.get("lantern", "lit")).toBe(true);
    expect(store.has("lantern", "lit")).toBe(true);
    expect(store.entity("lantern")).toEqual({ lit: true });
  });

  it("drops an entity once its last field is deleted", () => {
    const store = createStore({ lantern: { lit: true } });
    store.delete("lantern", "lit");
    expect(store.entity("lantern")).toBeUndefined();
    expect(store.ids()).toEqual([]);
  });

  it("copies values in and hands out frozen values, so state can't change behind its back", () => {
    const store = createStore();
    const inventory = ["key"];
    store.set("player", "inventory", inventory);
    inventory.push("lantern");
    expect(store.get("player", "inventory")).toEqual(["key"]);
    const stored = store.get("player", "inventory") as string[];
    expect(() => stored.push("sword")).toThrow(TypeError);
    expect(() => {
      (store.entity("player") as Record<string, unknown>).inventory = [];
    }).toThrow(TypeError);
  });

  it("rejects bad IDs, field names, and values with author-readable errors", () => {
    const store = createStore();
    expect(() => store.set("", "lit", true)).toThrow("set: the ID must be a non-empty string.");
    expect(() => store.set("lantern", "", true)).toThrow(/field name must be a non-empty string/);
    expect(() => store.set("lantern", "fuel", Number.NaN as number)).toThrow(
      /^state "lantern".fuel: NaN can't be stored/,
    );
    expect(store.ids()).toEqual([]);
  });

  it("lists IDs and snapshot keys in code-unit order, independent of insertion order", () => {
    const a = createStore();
    a.set("b", "y", 1);
    a.set("a", "z", 1);
    a.set("a", "x", 1);
    a.set("B", "x", 1);
    const b = createStore({ B: { x: 1 }, a: { x: 1, z: 1 }, b: { y: 1 } });
    expect(a.ids()).toEqual(["B", "a", "b"]);
    expect(JSON.stringify(a.snapshot())).toBe(JSON.stringify(b.snapshot()));
    expect(Object.keys(a.snapshot().a ?? {})).toEqual(["x", "z"]);
  });
});

describe("serialization", () => {
  it("round-trips through JSON losslessly", () => {
    const store = createStore();
    store.set("player", "name", "Ada \u{1F56F}");
    store.set("player", "stats", { hp: 10, xp: 0.5, flags: [true, false, null] });
    store.set("gen:crypt-3:room-7", "visited", 2);
    store.set("cellar", "__proto__", { nested: "safe" });
    const json = JSON.stringify(store.snapshot());
    const loaded = createStore(JSON.parse(json));
    expect(loaded.snapshot()).toEqual(store.snapshot());
    expect(JSON.stringify(loaded.snapshot())).toBe(json);
    expect(loaded.get("cellar", "__proto__")).toEqual({ nested: "safe" });
  });

  it("validates snapshots on load", () => {
    expect(() => createStore({ lantern: [] as never })).toThrow(/expected an object of fields/);
    expect(() => createStore({ lantern: { fuel: { when: new Date(0) } as never } })).toThrow(
      /state "lantern".fuel.when: a Date can't be stored/,
    );
  });

  it("isn't affected by later changes to the snapshot it was loaded from", () => {
    const data = { lantern: { tags: ["brass"] } };
    const store = createStore(data);
    data.lantern.tags.push("dented");
    expect(store.get("lantern", "tags")).toEqual(["brass"]);
  });
});

describe("commit", () => {
  it("returns one change per field, from its first value to its last, sorted", () => {
    const store = createStore({ lantern: { fuel: 3 } });
    store.set("lantern", "fuel", 2);
    store.set("lantern", "fuel", 1);
    store.set("lantern", "lit", true);
    store.set("cellar", "dark", false);
    expect(store.commit()).toEqual([
      { id: "cellar", key: "dark", to: false },
      { id: "lantern", key: "fuel", from: 3, to: 1 },
      { id: "lantern", key: "lit", to: true },
    ]);
    expect(store.commit()).toEqual([]);
  });

  it("records deletions without a `to`", () => {
    const store = createStore({ lantern: { lit: true } });
    store.delete("lantern", "lit");
    expect(store.commit()).toEqual([{ id: "lantern", key: "lit", from: true }]);
  });

  it("leaves out fields that end where they started", () => {
    const store = createStore({ lantern: { tags: ["a"] } });
    store.set("lantern", "tags", ["b"]);
    store.set("lantern", "tags", ["a"]);
    store.set("cellar", "temp", 1);
    store.delete("cellar", "temp");
    expect(store.dirty).toBe(false);
    expect(store.commit()).toEqual([]);
  });

  it("produces diffs that are plain JSON", () => {
    const store = createStore();
    store.set("lantern", "lit", true);
    const diff = store.commit();
    expect(JSON.parse(JSON.stringify(diff))).toEqual(diff);
    expect(Object.isFrozen(diff)).toBe(true);
  });
});

describe("rollback", () => {
  it("reverts every change since the last commit", () => {
    const store = createStore({ lantern: { fuel: 3 } });
    store.set("lantern", "fuel", 1);
    store.set("cellar", "dark", true);
    store.delete("lantern", "fuel");
    store.rollback();
    expect(store.snapshot()).toEqual({ lantern: { fuel: 3 } });
    expect(store.commit()).toEqual([]);
  });
});

describe("apply and invertDiff", () => {
  /** Plays a scripted session, committing after each step, and returns every diff. */
  function play(store: StateStore, afterStep: () => void = () => undefined): StateDiff[] {
    const steps: (() => void)[] = [
      () => store.set("player", "location", "kitchen"),
      () => {
        store.set("player", "location", "cellar");
        store.set("lantern", "lit", true);
      },
      () => store.set("player", "inventory", ["lantern", "key"]),
      () => {
        store.delete("lantern", "lit");
        store.set("cellar", "visits", 1);
      },
    ];
    return steps.map((step) => {
      step();
      const diff = store.commit();
      afterStep();
      return diff;
    });
  }

  it("undoes and redoes a session exactly", () => {
    const store = createStore({ player: { location: "hall" } });
    const states = [store.snapshot()];
    const diffs = play(store, () => states.push(store.snapshot()));

    for (let i = diffs.length - 1; i >= 0; i--) {
      store.apply(invertDiff(diffs[i] ?? []));
      expect(store.snapshot()).toEqual(states[i]);
    }
    for (let i = 0; i < diffs.length; i++) {
      store.apply(diffs[i] ?? []);
      expect(store.snapshot()).toEqual(states[i + 1]);
    }
  });

  it("replays diffs from JSON onto a fresh store loaded from the same start", () => {
    const start = { player: { location: "hall" } };
    const live = createStore(start);
    const saved = JSON.stringify(play(live));
    const replay = createStore(start);
    for (const diff of JSON.parse(saved) as StateDiff[]) replay.apply(diff);
    expect(replay.snapshot()).toEqual(live.snapshot());
  });

  it("doesn't record applied changes for the next commit", () => {
    const store = createStore();
    store.apply([{ id: "lantern", key: "lit", to: true }]);
    expect(store.dirty).toBe(false);
    expect(store.commit()).toEqual([]);
  });

  it("applies several changes to one field in order", () => {
    const store = createStore();
    store.apply([
      { id: "lantern", key: "fuel", to: 3 },
      { id: "lantern", key: "fuel", from: 3, to: 2 },
    ]);
    expect(store.get("lantern", "fuel")).toBe(2);
  });

  it("refuses a diff that doesn't match, and changes nothing", () => {
    const store = createStore({ lantern: { fuel: 3 } });
    const diff: StateDiff = [
      { id: "cellar", key: "dark", to: true },
      { id: "lantern", key: "fuel", from: 5, to: 4 },
    ];
    expect(() => store.apply(diff)).toThrow(StateError);
    expect(() => store.apply(diff)).toThrow(/state "lantern".fuel doesn't match the diff/);
    expect(store.snapshot()).toEqual({ lantern: { fuel: 3 } });
  });

  it("refuses to apply over uncommitted changes", () => {
    const store = createStore();
    store.set("lantern", "lit", true);
    expect(() => store.apply([])).toThrow(/uncommitted changes/);
  });

  it("inverts creations, deletions, and updates", () => {
    expect(
      invertDiff([
        { id: "a", key: "x", to: 1 },
        { id: "b", key: "y", from: 2 },
        { id: "c", key: "z", from: 3, to: 4 },
      ]),
    ).toEqual([
      { id: "c", key: "z", from: 4, to: 3 },
      { id: "b", key: "y", to: 2 },
      { id: "a", key: "x", from: 1 },
    ]);
  });
});
