import { afterEach, describe, expect, it } from "vitest";
import { createEventRecord } from "../events/record.js";
import { resetObjects } from "../objects/objects.js";
import { createPersistent } from "../persistent/persistent.js";
import { createStory, type LinkNode, type Passage } from "../passages/story.js";
import { createMemoryStorage, createSaves } from "../save/save.js";
import { createStore } from "../state/store.js";
import { hook, type HookKinds } from "./hooks.js";

/** Handlers added by a test, removed after it, since hooks are global. */
const added: [keyof HookKinds, string][] = [];
function on<K extends keyof HookKinds>(
  kind: K,
  name: string,
  fn: (payload: HookKinds[K]) => void,
  options?: Parameters<ReturnType<typeof hook<K>>["rule"]>[2],
) {
  hook(kind).rule(name, fn, options);
  added.push([kind, name]);
}
afterEach(() => {
  for (const [kind, name] of added.splice(0)) hook(kind).remove(name);
  resetObjects();
});

const go: LinkNode = { type: "link", label: "Go", target: "B" };
const passages: Passage[] = [
  {
    id: "A",
    tags: [],
    effects: {
      enter: ({ emit }) => {
        emit("system", { text: "A's enter effect" });
      },
      leave: ({ emit }) => {
        emit("system", { text: "A's leave effect" });
      },
    },
    body: () => [{ type: "text", text: "Room A." }, go],
  },
  { id: "B", tags: [], body: () => [{ type: "text", text: "Room B." }] },
];

function play() {
  const store = createStore();
  const record = createEventRecord(store);
  const persistent = createPersistent();
  const story = createStory(store, record, passages, { start: "A", persistent });
  return { store, record, story, persistent };
}

/** The record as a list of what happened, for checking order. */
const timeline = (record: ReturnType<typeof play>["record"]) =>
  record
    .events()
    .map((e) =>
      e.kind === "system" || e.kind === "narrative"
        ? e.text
        : e.kind === "navigation"
          ? `→ ${e.to}`
          : e.kind,
    );

describe("lifecycle hooks in a story", () => {
  it("run at game start, passage leave and enter, and turn end, in order", () => {
    on("gameStart", "intro", ({ emit, state }) => {
      state.set("clock", "turn", 0);
      emit("system", { text: "gameStart" });
    });
    on("passageLeave", "note-leave", ({ emit, passage }) => {
      emit("system", { text: `passageLeave ${passage}` });
    });
    on("passageEnter", "note-enter", ({ emit, passage, firstVisit }) => {
      emit("system", { text: `passageEnter ${passage}${firstVisit ? " (first)" : ""}` });
    });
    on("turnEnd", "tick", ({ state, emit }) => {
      state.set("clock", "turn", (state.get("clock", "turn") as number) + 1);
      emit("system", { text: "turnEnd" });
    });
    const { story, record, store } = play();
    story.begin();
    story.follow(go);
    expect(timeline(record)).toEqual([
      "gameStart",
      "→ A",
      "phase",
      "A's enter effect",
      "passageEnter A (first)",
      "Room A.",
      // No turn end for beginning: it isn't an action.
      "phase",
      "A's leave effect",
      "passageLeave A",
      "→ B",
      "passageEnter B (first)",
      "Room B.",
      "turnEnd",
    ]);
    expect(store.get("clock", "turn")).toBe(1);
  });

  it("place handlers like rules, and explain them", () => {
    const order: string[] = [];
    on("turnEnd", "second", () => order.push("second"));
    on("turnEnd", "first", () => order.push("first"), { before: "second", source: "my-kit" });
    const { story } = play();
    story.begin();
    story.goTo("B");
    expect(order).toEqual(["first", "second"]);
    expect(hook("turnEnd").rules()).toEqual([
      { name: "first", source: "my-kit" },
      { name: "second", source: "game" },
    ]);
    expect(hook("turnEnd")).toBe(hook("turnEnd"));
  });

  it("roll the move back when a handler throws", () => {
    on("passageEnter", "trap", ({ passage, state, persistent }) => {
      if (passage !== "B") return;
      state.set("trap", "sprung", true);
      persistent.set("endings", "trap", true);
      throw new Error("the floor gives way");
    });
    const { story, store, persistent } = play();
    story.begin();
    store.commit();
    expect(() => {
      story.follow(go);
    }).toThrow(`hook "passageEnter", rule "trap" (from game): the floor gives way`);
    expect(story.current).toBe("A");
    expect(store.has("trap", "sprung")).toBe(false);
    expect(persistent.has("endings", "trap")).toBe(false);
    expect(story.actions).toEqual([]);
  });

  it("replay exactly when they change state", () => {
    on("turnEnd", "tick", ({ state }) => {
      state.set("clock", "turn", ((state.get("clock", "turn") as number | undefined) ?? 0) + 1);
    });
    const original = play();
    original.story.begin();
    original.story.follow(go);
    original.story.goTo("A");
    const copy = play();
    copy.story.playReplay(original.story.toReplay());
    expect(copy.store.snapshot()).toEqual(original.store.snapshot());
    expect(copy.store.get("clock", "turn")).toBe(2);
  });
});

describe("save and load hooks", () => {
  it("run after a save is written and after one is read", async () => {
    const seen: string[] = [];
    on("save", "note-save", ({ slot, summary }) =>
      seen.push(`save ${slot} at ${String(summary.passage)}`),
    );
    on("load", "note-load", ({ slot }) => seen.push(`load ${slot}`));
    const saves = createSaves({
      storage: createMemoryStorage(),
      game: { id: "g", version: "1" },
    });
    const { story, store } = play();
    story.begin();
    await saves.save("one", store);
    await saves.autosave(store);
    await saves.load("one");
    await saves.list();
    await saves.load("empty");
    expect(seen).toEqual(["save one at A", "save autosave at A", "load one"]);
  });
});
