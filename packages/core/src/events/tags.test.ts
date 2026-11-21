/**
 * Events an author records, and the passage tags every event carries (#261).
 */
import { afterEach, describe, expect, it } from "vitest";
import { emit, object, resetObjects } from "../objects/objects.js";
import { emitEvent } from "../passages/directives.js";
import { createStory, type Passage } from "../passages/story.js";
import { createHistory } from "../state/history.js";
import { createStore } from "../state/store.js";
import { StateError } from "../state/value.js";
import { createEventRecord } from "./record.js";

afterEach(() => {
  resetObjects();
});

// #region bell
const bell = object("bell", {
  rung: 0,
  ring() {
    this.rung += 1;
    emit("system", { text: "The bell rings." }, ["bell"]);
  },
});
// #endregion

const passages: Passage[] = [
  {
    id: "Tower",
    tags: ["scene", "room: tower"],
    body: () => [
      { type: "text", text: "Wind." },
      { type: "beat" },
      { type: "text", text: "A bell." },
      { type: "link", label: "Down", target: "Yard" },
    ],
    effects: {
      enter: (context) => {
        context.emit("system", { text: "You climb." }, ["climb"]);
      },
    },
    beats: [
      {
        enter: (context) => {
          bell.ring();
          emitEvent({ text: "It echoes.", kind: "scene", tags: ["bell"] }, context);
        },
      },
    ],
  },
  {
    id: "Yard",
    tags: [],
    body: () => [{ type: "text", text: "Mud." }],
    effects: {
      enter: (context) => {
        emitEvent({ text: "Quiet." }, context);
      },
    },
  },
];

/** The passage's only choice. */
const choice = (story: ReturnType<typeof createStory>) => {
  const [first] = story.render().choices;
  if (!first) throw new Error("no choice");
  return first;
};

function play() {
  const store = createStore();
  const record = createEventRecord(store);
  const story = createStory(store, record, passages, { start: "Tower" });
  const list = (since = 0) =>
    record.events({ since }).map((e) => [e.kind, "text" in e ? e.text : "", e.tags]);
  return { store, record, story, list };
}

describe("passage tags on events", () => {
  it("go on every event recorded in the passage, before the event's own", () => {
    const { story, list } = play();
    story.begin();
    expect(list()).toEqual([
      ["navigation", "", ["scene", "room: tower"]],
      ["phase", "", ["scene", "room: tower"]],
      ["system", "You climb.", ["scene", "room: tower", "climb"]],
      ["narrative", "Wind.", ["scene", "room: tower"]],
    ]);
    story.advance();
    expect(list(4)).toEqual([
      ["beat", "", ["scene", "room: tower"]],
      ["phase", "", ["scene", "room: tower"]],
      ["system", "The bell rings.", ["scene", "room: tower", "bell"]],
      ["scene", "It echoes.", ["scene", "room: tower", "bell"]],
      ["narrative", "A bell.", ["scene", "room: tower"]],
    ]);
  });

  it("go only on events in that passage, so an untagged passage's are untagged", () => {
    const { story, list, record } = play();
    story.begin();
    story.advance();
    const before = record.length;
    story.follow(choice(story));
    expect(list(before)).toEqual([
      ["navigation", "", []],
      ["phase", "", []],
      ["system", "Quiet.", []],
      ["narrative", "Mud.", []],
    ]);
  });

  it("make the passage's events easy to find in the record", () => {
    const { story, record } = play();
    story.begin();
    story.advance();
    story.follow(choice(story));
    expect(record.events({ tags: ["bell"] }).map((e) => e.kind)).toEqual(["system", "scene"]);
    expect(record.events({ tags: ["scene"] })).toHaveLength(9);
  });
});

describe("emit", () => {
  it("records in the story that's playing, as part of the move, so undo takes it back", () => {
    const { store, story, record } = play();
    story.begin();
    const history = createHistory(store);
    history.checkpoint("start");
    story.advance();
    history.checkpoint("advance");
    expect(record.events({ tags: ["bell"] })).toHaveLength(2);
    history.undo();
    expect(record.events({ tags: ["bell"] })).toEqual([]);
    expect(bell.rung).toBe(0);
  });

  it("is reproduced by a replay", () => {
    const first = play();
    first.story.begin();
    first.story.advance();
    const replay = first.story.toReplay();
    const again = play();
    again.story.playReplay(replay);
    expect(again.list()).toEqual(first.list());
  });

  it("explains that it needs a story", () => {
    resetObjects();
    expect(() => emit("system", { text: "Hi." })).toThrow(
      "emit system: no story is running. Objects and random streams keep their state in a story's state store, so create one with createStory first.",
    );
  });

  it("refuses to record while a passage renders, since rendering must be pure", () => {
    const store = createStore();
    const story = createStory(
      store,
      createEventRecord(store),
      [
        {
          id: "Loud",
          tags: [],
          body: () => {
            emit("system", { text: "Rendered." });
            return [{ type: "text", text: "Hi." }];
          },
        },
      ],
      { start: "Loud" },
    );
    expect(() => {
      story.begin();
    }).toThrow(StateError);
    expect(() => {
      story.begin();
    }).toThrow(
      'passage "Loud": rendering tried to record a system event. Rendering must be pure; record events in an effect phase such as {on enter: …}, or with {emit …}, instead.',
    );
  });
});
