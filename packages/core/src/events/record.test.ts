import { describe, expect, expectTypeOf, it } from "vitest";
import { createHistory } from "../state/history.js";
import { createStore } from "../state/store.js";
import { StateError } from "../state/value.js";
import { createEventRecord, type RecordedEvent } from "./record.js";

// Extensions add event kinds by declaration merging, as a kit would.
declare module "./record.js" {
  interface EventKinds {
    "combat-round": { readonly round: number; readonly text: string };
  }
}

function setup() {
  const store = createStore();
  return { store, record: createEventRecord(store) };
}

describe("createEventRecord", () => {
  it("records events in order with seq, kind, and tags", () => {
    const { record } = setup();
    const first = record.emit("narrative", {
      text: "The steps go down.",
      line: "cellar-stairs#a1",
    });
    record.emit("navigation", { from: "Kitchen", to: "Cellar Stairs" }, ["movement"]);
    expect(first).toEqual({
      seq: 0,
      kind: "narrative",
      tags: [],
      text: "The steps go down.",
      line: "cellar-stairs#a1",
    });
    expect(record.length).toBe(2);
    expect(record.events().map((e) => [e.seq, e.kind])).toEqual([
      [0, "narrative"],
      [1, "navigation"],
    ]);
  });

  it("carries line IDs on prose events", () => {
    const { record } = setup();
    record.emit("dialogue", { text: "Mind the step.", line: "kitchen#b7", speaker: "cook" });
    record.emit("room-description", { text: "Low and damp.", line: "cellar#d2", room: "cellar" });
    expect(record.events().map((e) => ("line" in e ? e.line : undefined))).toEqual([
      "kitchen#b7",
      "cellar#d2",
    ]);
  });

  it("types events by kind", () => {
    const { record } = setup();
    const nav = record.emit("navigation", { to: "Cellar" });
    expectTypeOf(nav).toEqualTypeOf<RecordedEvent<"navigation">>();
    expectTypeOf(nav.to).toEqualTypeOf<string>();
    // @ts-expect-error -- navigation events need `to`
    expect(() => record.emit("navigation", {})).not.toThrow();
    const dialogue = record.events({ kinds: ["dialogue"] });
    expectTypeOf(dialogue).toEqualTypeOf<RecordedEvent<"dialogue">[]>();
  });

  it("accepts kinds added by declaration merging", () => {
    const { record } = setup();
    const e = record.emit("combat-round", { round: 1, text: "The rat bites." }, ["combat"]);
    expectTypeOf(e.round).toEqualTypeOf<number>();
    expect(record.events({ kinds: ["combat-round"] })).toEqual([e]);
  });

  it("filters by position, kind, and tags", () => {
    const { record } = setup();
    record.emit("narrative", { text: "a" }, ["chapter-1"]);
    record.emit("system", { text: "Game saved." }, ["save"]);
    record.emit("narrative", { text: "b" }, ["chapter-1", "first-visit"]);
    record.emit("narrative", { text: "c" });
    expect(record.events({ since: 2 }).map((e) => e.seq)).toEqual([2, 3]);
    expect(record.events({ kinds: ["system"] }).map((e) => e.seq)).toEqual([1]);
    expect(record.events({ tags: ["chapter-1"] }).map((e) => e.seq)).toEqual([0, 2]);
    expect(record.events({ tags: ["chapter-1", "first-visit"] }).map((e) => e.seq)).toEqual([2]);
    expect(
      record.events({ since: 1, kinds: ["narrative"], tags: ["chapter-1"] }).map((e) => e.seq),
    ).toEqual([2]);
  });

  it("removes duplicate tags and freezes events", () => {
    const { record } = setup();
    const e = record.emit("narrative", { text: "a" }, ["x", "x", "y"]);
    expect(e.tags).toEqual(["x", "y"]);
    expect(Object.isFrozen(e)).toBe(true);
    expect(Object.isFrozen(e.tags)).toBe(true);
  });

  it("rejects bad kinds, tags, reserved fields, and non-state values", () => {
    const { record, store } = setup();
    expect(() => record.emit("" as "narrative", { text: "a" })).toThrow(/kind must be/);
    expect(() => record.emit("narrative", { text: "a" }, [""])).toThrow(StateError);
    expect(() => record.emit("narrative", { text: "a", seq: 9 } as never)).toThrow(
      /set by the record/,
    );
    expect(() => record.emit("narrative", { text: undefined as never })).toThrow(
      /event narrative.text: undefined can't be stored/,
    );
    expect(record.length).toBe(0);
    expect(store.ids()).toEqual([]);
  });
});

describe("the record in the state store", () => {
  it("is trimmed by undo and restored by redo", () => {
    const { store, record } = setup();
    const history = createHistory(store);
    record.emit("narrative", { text: "You wake." });
    history.checkpoint("start");
    record.emit("navigation", { to: "Cellar" });
    record.emit("narrative", { text: "It's dark." });
    history.checkpoint("go down");

    history.undo();
    expect(record.events().map((e) => e.seq)).toEqual([0]);
    history.redo();
    expect(record.events().map((e) => e.seq)).toEqual([0, 1, 2]);
  });

  it("reuses positions after undo, so a replay produces the same record", () => {
    const { store, record } = setup();
    const history = createHistory(store);
    record.emit("narrative", { text: "You wake." });
    history.checkpoint();
    record.emit("narrative", { text: "Left." });
    history.checkpoint();
    history.undo();
    const right = record.emit("narrative", { text: "Right." });
    expect(right.seq).toBe(1);

    const replay = setup();
    replay.record.emit("narrative", { text: "You wake." });
    replay.record.emit("narrative", { text: "Right." });
    expect(replay.store.snapshot()).toEqual(store.snapshot());
  });

  it("continues after save and load", () => {
    const { store, record } = setup();
    record.emit("narrative", { text: "a" });
    record.emit("narrative", { text: "b" });
    const loaded = createStore(JSON.parse(JSON.stringify(store.snapshot())));
    const again = createEventRecord(loaded);
    expect(again.events()).toEqual(record.events());
    expect(again.emit("narrative", { text: "c" }).seq).toBe(2);
  });

  it("appends one event as one small change", () => {
    const { store, record } = setup();
    for (let i = 0; i < 1000; i++) record.emit("narrative", { text: `line ${String(i)}` });
    store.commit();
    record.emit("narrative", { text: "the last line" });
    expect(store.commit()).toEqual([
      {
        id: "$events",
        key: "1000",
        to: { text: "the last line", seq: 1000, kind: "narrative", tags: [] },
      },
      { id: "$events", key: "length", from: 1000, to: 1001 },
    ]);
  });
});
