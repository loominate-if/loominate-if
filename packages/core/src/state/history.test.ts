import { describe, expect, it } from "vitest";
import { createHistory } from "./history.js";
import { createStore, type StateStore } from "./store.js";
import { StateError } from "./value.js";

/** Moves the player through `n` rooms, one checkpoint per move. Returns the snapshot after each. */
function walk(store: StateStore, history: ReturnType<typeof createHistory>, n: number) {
  const snapshots = [store.snapshot()];
  for (let i = 1; i <= n; i++) {
    store.set("player", "location", `room-${i}`);
    store.set(`room-${i}`, "visits", 1);
    history.checkpoint(`enter room-${i}`);
    snapshots.push(store.snapshot());
  }
  return snapshots;
}

describe("createHistory", () => {
  it("undoes and redoes to the exact prior states", () => {
    const store = createStore({ player: { location: "hall", hp: 10 } });
    const history = createHistory(store);
    const snapshots = walk(store, history, 5);

    for (let i = 4; i >= 0; i--) {
      expect(history.undo()).toBe(true);
      expect(store.snapshot()).toEqual(snapshots[i]);
    }
    expect(history.undo()).toBe(false);
    for (let i = 1; i <= 5; i++) {
      expect(history.redo()).toBe(true);
      expect(store.snapshot()).toEqual(snapshots[i]);
    }
    expect(history.redo()).toBe(false);
  });

  it("records one labelled step per checkpoint", () => {
    const store = createStore();
    const history = createHistory(store);
    walk(store, history, 2);
    expect(history.past.map((s) => s.label)).toEqual(["enter room-1", "enter room-2"]);
    expect(history.past[0]?.diff).toEqual([
      { id: "player", key: "location", to: "room-1" },
      { id: "room-1", key: "visits", to: 1 },
    ]);
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
  });

  it("lists redo steps next-first", () => {
    const store = createStore();
    const history = createHistory(store);
    walk(store, history, 3);
    history.undo();
    history.undo();
    expect(history.future.map((s) => s.label)).toEqual(["enter room-2", "enter room-3"]);
  });

  it("skips checkpoints with no changes and keeps redo steps through them", () => {
    const store = createStore();
    const history = createHistory(store);
    walk(store, history, 2);
    history.undo();
    expect(history.checkpoint("re-render")).toEqual([]);
    expect(history.past).toHaveLength(1);
    expect(history.canRedo).toBe(true);
  });

  it("discards redo steps when a new change is checkpointed", () => {
    const store = createStore();
    const history = createHistory(store);
    walk(store, history, 2);
    history.undo();
    store.set("player", "location", "garden");
    history.checkpoint("enter garden");
    expect(history.canRedo).toBe(false);
    history.undo();
    expect(store.get("player", "location")).toBe("room-1");
  });

  it("refuses to undo or redo over uncommitted changes, and keeps its steps", () => {
    const store = createStore();
    const history = createHistory(store);
    walk(store, history, 1);
    store.set("player", "hp", 3);
    expect(() => history.undo()).toThrow(StateError);
    expect(() => history.undo()).toThrow(/uncommitted changes/);
    expect(history.past).toHaveLength(1);
    store.rollback();
    expect(history.undo()).toBe(true);
    store.set("player", "hp", 3);
    expect(() => history.redo()).toThrow(/uncommitted changes/);
    expect(history.future).toHaveLength(1);
  });

  it("leaves history as it was if the store no longer matches a step", () => {
    const store = createStore();
    const history = createHistory(store);
    walk(store, history, 1);
    // A change committed outside the history, so the last step's diff no longer fits.
    store.set("player", "location", "nowhere");
    store.commit();
    expect(() => history.undo()).toThrow(/doesn't match the diff/);
    expect(history.past).toHaveLength(1);
    expect(store.get("player", "location")).toBe("nowhere");
  });

  it("clears both directions", () => {
    const store = createStore();
    const history = createHistory(store);
    walk(store, history, 2);
    history.undo();
    history.clear();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });
});

describe("limit", () => {
  it("is unlimited by default", () => {
    const store = createStore();
    const history = createHistory(store);
    walk(store, history, 500);
    expect(history.limit).toBe(Infinity);
    expect(history.past).toHaveLength(500);
  });

  it("keeps only the most recent steps when capped", () => {
    const store = createStore();
    const history = createHistory(store, { limit: 3 });
    const snapshots = walk(store, history, 10);
    expect(history.past.map((s) => s.label)).toEqual([
      "enter room-8",
      "enter room-9",
      "enter room-10",
    ]);
    while (history.undo());
    expect(store.snapshot()).toEqual(snapshots[7]);
  });

  it("disables undo at 0 but still commits changes", () => {
    const store = createStore();
    const history = createHistory(store, { limit: 0 });
    walk(store, history, 3);
    expect(history.canUndo).toBe(false);
    expect(store.dirty).toBe(false);
    expect(store.get("player", "location")).toBe("room-3");
  });

  it.each([-1, 1.5, Number.NaN, -Infinity])("rejects %s", (limit) => {
    expect(() => createHistory(createStore(), { limit })).toThrow(/limit must be a whole number/);
  });
});

describe("memory over a long session", () => {
  const size = (value: unknown): number => JSON.stringify(value).length;

  it("stays bounded by the cap", () => {
    const store = createStore();
    const history = createHistory(store, { limit: 100 });
    const sizes: number[] = [];
    for (let i = 1; i <= 10_000; i++) {
      store.set("player", "location", `room-${i % 50}`);
      store.set("player", "turn", i);
      history.checkpoint();
      if (i % 1000 === 0) sizes.push(size(history.past));
    }
    expect(history.past).toHaveLength(100);
    // Flat after the cap fills: turn 10,000's history is no bigger than turn 1,000's,
    // allowing for turn numbers gaining a digit.
    const first = sizes[0] ?? 0;
    expect(Math.max(...sizes)).toBeLessThan(first * 1.1);
  });

  it("grows with what changed, not with the size of the state", () => {
    // A large world where each turn changes one small field.
    const store = createStore(
      Object.fromEntries(
        Array.from({ length: 1000 }, (_, i) => [`room-${i}`, { description: "x".repeat(200) }]),
      ),
    );
    const history = createHistory(store);
    for (let i = 1; i <= 1000; i++) {
      store.set("player", "turn", i);
      history.checkpoint();
    }
    const stateSize = size(store.snapshot());
    expect(stateSize).toBeGreaterThan(200_000);
    // A thousand snapshots would be ~200 MB; a thousand diffs are tiny.
    expect(size(history.past)).toBeLessThan(100_000);
  });
});
