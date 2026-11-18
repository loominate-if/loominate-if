import { afterEach, describe, expect, it } from "vitest";
import { createEventRecord } from "../events/record.js";
import { resetObjects } from "../objects/objects.js";
import { createStory, type Passage } from "../passages/story.js";
import { createHistory } from "../state/history.js";
import { createStore, type StateSnapshot } from "../state/store.js";
import { StateError } from "../state/value.js";
import { cyrb128, randomStream } from "./random.js";

afterEach(() => {
  resetObjects();
});

const weather = randomStream("weather");
const combat = randomStream("combat");
const world = randomStream("world");

/** A begun story over a fresh store (or a saved one), so streams have somewhere to keep state. */
function play(seed = "amber-lantern-fog", snapshot?: StateSnapshot, passages?: Passage[]) {
  const store = createStore(snapshot);
  const story = createStory(
    store,
    createEventRecord(store),
    passages ?? [{ id: "A", tags: [], body: () => [] }],
    { start: "A", seed },
  );
  story.begin();
  return { store, story };
}

const draws = (stream: { next(): number }, n: number): number[] =>
  Array.from({ length: n }, () => stream.next());

describe("the algorithm", () => {
  it("never changes: saves, replays, and shared seeds depend on it", () => {
    // Checked against an independent implementation of cyrb128 and sfc32.
    expect(cyrb128("")).toEqual([41608494, 3485963809, 1435736333, 1262568316]);
    play();
    expect(draws(weather, 3).map((n) => n * 2 ** 32)).toEqual([2992484645, 1665910077, 3562394970]);
  });

  it("is the same for the same seed, and different for another", () => {
    play("a");
    const first = draws(weather, 5);
    play("a");
    expect(draws(weather, 5)).toEqual(first);
    play("b");
    expect(draws(weather, 5)).not.toEqual(first);
  });
});

describe("named streams", () => {
  it("don't shift each other: extra draws from one leave the others alone", () => {
    play();
    draws(weather, 3);
    const fights = draws(combat, 4);
    play();
    draws(weather, 10);
    expect(draws(combat, 4)).toEqual(fights);
    play();
    expect(draws(combat, 4)).toEqual(fights);
  });

  it("give substreams the same results whenever they're first used", () => {
    const level3 = world.substream("level-3");
    play();
    const fresh = draws(level3, 3);
    play();
    draws(world, 7);
    draws(world.substream("level-2"), 2);
    expect(draws(level3, 3)).toEqual(fresh);
    expect(level3.name).toBe("world/level-3");
    // A substream isn't its parent, or a stream of the same name elsewhere.
    play();
    expect(draws(world, 3)).not.toEqual(fresh);
    expect(draws(randomStream("level-3"), 3)).not.toEqual(fresh);
  });

  it("can't be rerolled by undo: retrying gives the same result", () => {
    const { store } = play();
    const history = createHistory(store);
    history.checkpoint("begin");
    const roll = combat.int(1, 20);
    history.checkpoint("attack");
    history.undo();
    expect(combat.int(1, 20)).toBe(roll);
  });

  it("carry on the same way after save and load", () => {
    const { store } = play();
    draws(weather, 2);
    const saved = store.snapshot();
    const next = draws(weather, 3);
    play("a different seed, ignored for a save", saved);
    expect(draws(weather, 3)).toEqual(next);
  });
});

describe("draws", () => {
  it("stay in range and cover it", () => {
    play();
    const seen = new Set<number>();
    for (let i = 0; i < 600; i++) {
      const n = weather.int(1, 6);
      expect(Number.isInteger(n) && n >= 1 && n <= 6).toBe(true);
      seen.add(n);
    }
    expect(seen.size).toBe(6);
    expect(weather.int(-3, -3)).toBe(-3);
    expect(weather.int(0, 2 ** 32 - 1)).toBeLessThan(2 ** 32);
    for (let i = 0; i < 100; i++) {
      const x = weather.next();
      expect(x >= 0 && x < 1).toBe(true);
    }
    expect(weather.chance(0)).toBe(false);
    expect(weather.chance(1)).toBe(true);
  });

  it("pick and shuffle deterministically, without changing the input", () => {
    const items = Object.freeze(["a", "b", "c", "d", "e"]);
    play();
    const picked = combat.pick(items);
    const shuffled = combat.shuffle(items);
    expect(items).toContain(picked);
    expect([...shuffled].sort()).toEqual([...items]);
    play();
    expect(combat.pick(items)).toBe(picked);
    expect(combat.shuffle(items)).toEqual(shuffled);
  });

  it("reject bad arguments and names", () => {
    play();
    expect(() => weather.int(3, 1)).toThrow(
      'random stream "weather": int(3, 1) needs whole numbers with min ≤ max, at most 2³² apart.',
    );
    expect(() => weather.int(0, 1.5)).toThrow(StateError);
    expect(() => weather.int(0, 2 ** 32)).toThrow(StateError);
    expect(() => weather.chance(2)).toThrow(
      'random stream "weather": chance(2) needs a probability from 0 to 1.',
    );
    expect(() => weather.chance(Number.NaN)).toThrow(StateError);
    expect(() => weather.pick([])).toThrow(
      'random stream "weather": pick() needs at least one item.',
    );
    expect(() => randomStream("a/b")).toThrow(
      'randomStream "a/b": a stream name is non-empty and has no "/"; use substream() for nesting.',
    );
    expect(() => world.substream("")).toThrow(StateError);
  });
});

describe("in a story", () => {
  it("draws in effects, and refuses to draw while rendering", () => {
    const passages: Passage[] = [
      {
        id: "A",
        tags: [],
        effects: {
          firstVisit: ({ state }) => {
            // The start passage's effects can draw: the seed is set first.
            state.set("dice", "roll", combat.int(1, 6));
          },
        },
        body: ({ state }) =>
          state.get("test", "drawInBody") === true
            ? [{ type: "text", text: String(weather.next()) }]
            : [],
      },
    ];
    const { store, story } = play("x", undefined, passages);
    expect(store.get("dice", "roll")).toBeTypeOf("number");
    store.set("test", "drawInBody", true);
    expect(() => story.render()).toThrow(
      'passage "A": rendering tried to change random stream "weather". Rendering must be pure; change state in an effect phase such as {on enter: …} instead.',
    );
  });

  it("replays exactly: the same seed and actions give the same record", () => {
    const passages: Passage[] = [
      {
        id: "Road",
        tags: [],
        effects: {
          enter: ({ state }) => {
            state.set("road", "weather", weather.pick(["rain", "fog", "sun"]));
            state.set("road", "wolves", combat.int(0, 3));
          },
        },
        body: ({ state }) => [
          {
            type: "text",
            text: `${String(state.get("road", "weather"))}, ${String(state.get("road", "wolves"))} wolves.`,
          },
          { type: "link", label: "Walk on", target: "Road" },
        ],
      },
    ];
    const run = (seed: string) => {
      resetObjects();
      const store = createStore();
      const record = createEventRecord(store);
      const story = createStory(store, record, passages, { start: "Road", seed });
      story.begin();
      for (let i = 0; i < 5; i++) story.follow({ type: "link", label: "Walk on", target: "Road" });
      return record.events({ kinds: ["narrative"] }).map((e) => e.text);
    };
    const first = run("fog-bound");
    expect(run("fog-bound")).toEqual(first);
    expect(run("clear-skies")).not.toEqual(first);
  });

  it("needs a begun story", () => {
    expect(() => weather.next()).toThrow(/no story is running/);
    const store = createStore();
    createStory(store, createEventRecord(store), [{ id: "A", tags: [], body: () => [] }], {
      start: "A",
    });
    expect(() => weather.next()).toThrow(
      'random stream "weather": the story has no seed yet. Draw from streams in effects, which run after begin().',
    );
  });

  it("stores the seed when the story begins, defaulting to 0", () => {
    const store = createStore();
    createStory(store, createEventRecord(store), [{ id: "A", tags: [], body: () => [] }], {
      start: "A",
    }).begin();
    expect(store.entity("$random")).toEqual({ seed: "0", move: "begin" });
  });
});
