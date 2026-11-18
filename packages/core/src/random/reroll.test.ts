import { describe, expect, it } from "vitest";
import { createEventRecord } from "../events/record.js";
import { createStory, type LinkNode, type Passage } from "../passages/story.js";
import { readReplay, writeReplay } from "../replay/replay.js";
import { createHistory } from "../state/history.js";
import { createStore, type StateSnapshot } from "../state/store.js";
import { StateError } from "../state/value.js";
import { randomStream } from "./random.js";

const fortune = randomStream("fortune", { undo: "reroll" });
const dice = randomStream("dice");

const ask: LinkNode = { type: "link", label: "Ask", target: "Fortune" };
const back: LinkNode = { type: "link", label: "Back", target: "Tent" };
const passages: Passage[] = [
  { id: "Tent", tags: [], body: () => [{ type: "text", text: "A tent." }, ask] },
  {
    id: "Fortune",
    tags: [],
    effects: {
      enter: ({ state }) => {
        // Two draws in one move: a rerolling stream carries on within a move.
        state.set("fortune", "said", [fortune.int(1, 1e9), fortune.int(1, 1e9)]);
        state.set("dice", "roll", dice.int(1, 1e9));
      },
    },
    body: ({ state }) => [
      { type: "text", text: `Fortune ${JSON.stringify(state.get("fortune", "said"))}.` },
      back,
    ],
  },
];

/**
 * A story with a host's undo history. Streams draw from the story made last,
 * as objects do, so tests finish with one before making the next.
 */
function play(snapshot?: StateSnapshot, begin = true) {
  const store = createStore(snapshot);
  const record = createEventRecord(store);
  const story = createStory(store, record, passages, { start: "Tent", seed: "s" });
  const history = createHistory(store);
  if (begin) {
    story.begin();
    history.checkpoint("begin");
  }
  const turn = (action: () => void) => {
    action();
    history.checkpoint();
    return {
      said: store.get("fortune", "said") as readonly number[],
      roll: store.get("dice", "roll"),
    };
  };
  return { store, record, story, history, turn };
}

describe("streams that reroll on undo", () => {
  it("give a new result when an action is undone and taken again", () => {
    const { story, history, turn } = play();
    const first = turn(() => {
      story.follow(ask);
    });
    expect(first.said[0]).not.toBe(first.said[1]);
    history.undo();
    const second = turn(() => {
      story.follow(ask);
    });
    history.undo();
    const third = turn(() => {
      story.goTo("Fortune");
    });
    expect(new Set([first.said[0], second.said[0], third.said[0]]).size).toBe(3);
    // Other streams still rewind, so they can't be rerolled.
    expect(second.roll).toBe(first.roll);
    expect(third.roll).toBe(first.roll);
    expect(story.actions).toEqual([{ type: "goTo", passage: "Fortune", attempt: 2 }]);
  });

  it("give the same results without undo, and after redo", () => {
    const b = play();
    const once = b.turn(() => {
      b.story.follow(ask);
    });
    const a = play();
    expect(
      a.turn(() => {
        a.story.follow(ask);
      }),
    ).toEqual(once);
    a.history.undo();
    a.history.redo();
    expect(a.store.get("fortune", "said")).toEqual(once.said);
    expect(a.story.actions).toEqual([{ type: "follow", choice: ask }]);
  });

  it("replay exactly, through a replay file", () => {
    const original = play();
    original.turn(() => {
      original.story.follow(ask);
    });
    original.turn(() => {
      original.story.follow(back);
    });
    original.history.undo();
    original.turn(() => {
      original.story.follow(back);
    });
    original.turn(() => {
      original.story.follow(ask);
    });
    original.history.undo();
    original.turn(() => {
      original.story.follow(ask);
    });
    const file = writeReplay(original.story.toReplay());
    expect(file).toContain(
      `{"type":"follow","choice":{"type":"link","target":"Tent","label":"Back"},"attempt":1}`,
    );
    const copy = play(undefined, false);
    copy.story.playReplay(readReplay(file));
    expect(copy.store.snapshot()).toEqual(original.store.snapshot());
    expect(copy.record.events()).toEqual(original.record.events());
  });

  it("carry on the same way after save and load", () => {
    const original = play();
    original.turn(() => {
      original.story.follow(ask);
    });
    original.history.undo();
    original.turn(() => {
      original.story.follow(ask);
    });
    const saved = original.store.snapshot();
    original.turn(() => {
      original.story.follow(back);
    });
    const next = original.turn(() => {
      original.story.follow(ask);
    });
    const loaded = play(saved);
    expect(loaded.history.canUndo).toBe(false);
    loaded.turn(() => {
      loaded.story.follow(back);
    });
    expect(
      loaded.turn(() => {
        loaded.story.follow(ask);
      }),
    ).toEqual(next);
    // A retry after loading still rerolls.
    loaded.history.undo();
    expect(
      loaded.turn(() => {
        loaded.story.follow(ask);
      }).said,
    ).not.toEqual(next.said);
  });

  it("pass their undo mode to substreams, and explain a bad one", () => {
    expect(fortune.undo).toBe("reroll");
    expect(dice.undo).toBe("rewind");
    expect(fortune.substream("palm").undo).toBe("reroll");
    expect(() => randomStream("x", { undo: "forget" as "reroll" })).toThrow(StateError);
    expect(() => randomStream("x", { undo: "forget" as "reroll" })).toThrow(
      `randomStream "x": undo is "rewind" or "reroll", not "forget".`,
    );
  });
});
