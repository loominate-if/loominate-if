import { describe, expect, it } from "vitest";
import { createEventRecord } from "../events/record.js";
import { createHistory } from "../state/history.js";
import { createStore, type StateSnapshot } from "../state/store.js";
import { StateError } from "../state/value.js";
import { createStory, type Passage, type Story } from "./story.js";

/** Counts each effect run in state, so tests can see exactly how often each ran. */
const counted =
  (key: string) =>
  ({
    state,
  }: {
    state: {
      get: (id: string, k: string) => unknown;
      set: (id: string, k: string, v: number) => void;
    };
  }) => {
    const n = state.get("runs", key);
    state.set("runs", key, (typeof n === "number" ? n : 0) + 1);
  };

const passages: Passage[] = [
  {
    id: "Kitchen",
    tags: [],
    body: () => [
      { type: "link", label: "Down", target: "Cellar Stairs" },
      { type: "link", label: "Stay", target: "Kitchen" },
    ],
    effects: { leave: counted("Kitchen.leave") },
  },
  {
    id: "Cellar Stairs",
    tags: [],
    body: ({ state }) => [
      { type: "text", text: `Fear: ${String(state.get("player", "fear") ?? 0)}.` },
      { type: "link", label: "Up", target: "Kitchen" },
    ],
    effects: {
      firstVisit: counted("Stairs.firstVisit"),
      enter: (context) => {
        counted("Stairs.enter")(context);
        // {on enter: if (!player.has(lantern)) player.fear += 1}
        if (context.state.get("player", "lantern") !== true) {
          const fear = context.state.get("player", "fear");
          context.state.set("player", "fear", (typeof fear === "number" ? fear : 0) + 1);
        }
      },
      leave: counted("Stairs.leave"),
    },
  },
];

function setup(snapshot: StateSnapshot = {}) {
  const store = createStore(snapshot);
  const record = createEventRecord(store);
  const story = createStory(store, record, passages, { start: "Kitchen" });
  return { store, record, story };
}

const go = (story: ReturnType<typeof setup>["story"], label: string): void => {
  const choice = story.render().choices.find((c) => c.label === label);
  if (!choice) throw new Error(`no choice ${label}`);
  story.follow(choice);
};

const runs = (store: ReturnType<typeof setup>["store"]) => store.entity("runs") ?? {};

describe("effect phases", () => {
  it("run leave, then firstVisit and enter, before the new passage's prose", () => {
    const { story, record } = setup();
    story.begin();
    const since = record.length;
    go(story, "Down");
    expect(
      record
        .events({ since })
        .map((e) => (e.kind === "phase" ? `${e.passage}.${e.phase}` : e.kind)),
    ).toEqual([
      "Kitchen.leave",
      "navigation",
      "Cellar Stairs.firstVisit",
      "Cellar Stairs.enter",
      "narrative",
    ]);
  });

  it("let enter change state that the passage then renders", () => {
    const { story } = setup();
    story.begin();
    go(story, "Down");
    expect(story.render().nodes[0]).toEqual({ type: "text", text: "Fear: 1." });
  });

  it("run firstVisit only on the first visit, and enter and leave every visit", () => {
    const { store, story } = setup();
    story.begin();
    for (let i = 0; i < 3; i++) {
      go(story, "Down");
      go(story, "Up");
    }
    expect(runs(store)).toEqual({
      "Kitchen.leave": 3,
      "Stairs.enter": 3,
      "Stairs.firstVisit": 1,
      "Stairs.leave": 3,
    });
    expect(store.get("player", "fear")).toBe(3);
  });

  it("run leave and enter for a link back to the same passage", () => {
    const { store, story } = setup();
    story.begin();
    go(story, "Stay");
    expect(runs(store)).toEqual({ "Kitchen.leave": 1 });
  });

  it("never run on re-render", () => {
    const { store, story } = setup();
    story.begin();
    go(story, "Down");
    const before = store.snapshot();
    for (let i = 0; i < 20; i++) story.render();
    expect(store.snapshot()).toEqual(before);
  });

  it("never run on load, and run once on the next real visit", () => {
    const { store, story } = setup();
    story.begin();
    go(story, "Down");
    const loaded = setup(JSON.parse(JSON.stringify(store.snapshot())));
    loaded.story.begin();
    loaded.story.render();
    expect(runs(loaded.store)).toEqual(runs(store));
    go(loaded.story, "Up");
    go(loaded.story, "Down");
    expect(runs(loaded.store)).toMatchObject({ "Stairs.firstVisit": 1, "Stairs.enter": 2 });
  });

  it("are undone with the move that ran them, and redo doesn't run them again", () => {
    const { store, story } = setup();
    const history = createHistory(store);
    story.begin();
    history.checkpoint();
    go(story, "Down");
    history.checkpoint();
    const after = store.snapshot();

    history.undo();
    expect(store.get("player", "fear")).toBeUndefined();
    expect(runs(store)).toEqual({});
    history.redo();
    expect(store.snapshot()).toEqual(after);

    // After undo, the next real visit is a first visit again.
    history.undo();
    go(story, "Down");
    expect(runs(store)).toMatchObject({ "Stairs.firstVisit": 1, "Stairs.enter": 1 });
  });

  it("roll back the whole move when an effect throws, naming the passage and phase", () => {
    const store = createStore();
    const record = createEventRecord(store);
    const broken: Passage = {
      id: "Trap",
      tags: [],
      body: () => [],
      effects: {
        enter: ({ state }) => {
          state.set("player", "hp", 0);
          throw new Error("lantern is undefined");
        },
      },
    };
    const story = createStory(store, record, [...passages, broken], { start: "Kitchen" });
    story.begin();
    store.commit();
    const before = store.snapshot();
    expect(() => story.goTo("Trap")).toThrow(StateError);
    expect(store.snapshot()).toEqual(before);
    expect(() => story.goTo("Trap")).toThrow(`passage "Trap" enter effect: lantern is undefined`);
    expect(story.current).toBe("Kitchen");
  });

  it("can't navigate from inside an effect", () => {
    const store = createStore();
    const record = createEventRecord(store);
    const self: { story?: Story } = {};
    const redirect: Passage = {
      id: "Redirect",
      tags: [],
      body: () => [],
      effects: { enter: () => self.story?.goTo("Kitchen") },
    };
    const story = (self.story = createStory(store, record, [...passages, redirect], {
      start: "Kitchen",
    }));
    story.begin();
    store.commit();
    expect(() => story.goTo("Redirect")).toThrow(/while an effect phase is running/);
    expect(story.current).toBe("Kitchen");
  });

  it("can emit their own events", () => {
    const store = createStore();
    const record = createEventRecord(store);
    const story = createStory(
      store,
      record,
      [
        {
          id: "Shop",
          tags: [],
          body: () => [],
          effects: { firstVisit: ({ emit }) => emit("system", { text: "Achievement: Shopper" }) },
        },
      ],
      { start: "Shop" },
    );
    story.begin();
    expect(record.events({ kinds: ["system"] }).map((e) => e.text)).toEqual([
      "Achievement: Shopper",
    ]);
  });
});
