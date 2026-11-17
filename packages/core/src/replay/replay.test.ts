import { afterEach, describe, expect, it } from "vitest";
import { createEventRecord } from "../events/record.js";
import { resetObjects } from "../objects/objects.js";
import { createStory, type LinkNode, type Passage } from "../passages/story.js";
import { randomStream } from "../random/random.js";
import { createHistory } from "../state/history.js";
import { createStore, type StateSnapshot } from "../state/store.js";
import { StateError } from "../state/value.js";
import { readReplay, writeReplay, type Replay } from "./replay.js";

afterEach(() => {
  resetObjects();
});

const weather = randomStream("weather");
const walk: LinkNode = { type: "link", label: "Walk on", target: "Road" };
const rest: LinkNode = { type: "link", label: "Rest", target: "Inn" };

/** A road whose weather is rolled on every visit, an inn, and an unlabelled continue point. */
const passages: Passage[] = [
  {
    id: "Road",
    tags: [],
    effects: {
      enter: ({ state }) => {
        state.set("road", "weather", weather.pick(["rain", "fog", "sun"]));
      },
    },
    body: ({ state }) => [
      { type: "text", text: `The road, in ${String(state.get("road", "weather"))}.` },
      walk,
      rest,
    ],
  },
  {
    id: "Inn",
    tags: [],
    body: () => [
      { type: "text", text: "A warm inn." },
      { type: "continue", target: "Road" },
    ],
  },
  { id: "Cellar", tags: [], body: () => [{ type: "text", text: "Dark." }, walk] },
];

function play(options: { seed?: string; snapshot?: StateSnapshot; game?: Passage[] } = {}) {
  resetObjects();
  const store = createStore(options.snapshot);
  const record = createEventRecord(store);
  const story = createStory(store, record, options.game ?? passages, {
    start: "Road",
    seed: options.seed ?? "fog-bound",
  });
  return { store, record, story };
}

/** Plays a few turns, including a goTo and an unlabelled continue point. */
function playthrough(seed?: string) {
  const run = play(seed === undefined ? {} : { seed });
  run.story.begin();
  run.story.follow(walk);
  run.story.follow(rest);
  run.story.follow({ type: "continue", target: "Road" });
  run.story.goTo("Cellar");
  run.story.follow(walk);
  return run;
}

describe("the action log", () => {
  it("records each action taken, but not beginning", () => {
    const { story } = playthrough();
    expect(story.actions).toEqual([
      { type: "follow", choice: { type: "link", target: "Road", label: "Walk on" } },
      { type: "follow", choice: { type: "link", target: "Inn", label: "Rest" } },
      { type: "follow", choice: { type: "continue", target: "Road" } },
      { type: "goTo", passage: "Cellar" },
      { type: "follow", choice: { type: "link", target: "Road", label: "Walk on" } },
    ]);
  });

  it("leaves out a failed action, is trimmed by undo, and is carried by saves", () => {
    const { store, story } = play();
    const history = createHistory(store);
    story.begin();
    history.checkpoint("begin");
    expect(() => {
      story.follow({ type: "link", label: "Fly", target: "Road" });
    }).toThrow(StateError);
    story.follow(rest);
    history.checkpoint("rest");
    expect(story.actions).toHaveLength(1);
    history.undo();
    expect(story.actions).toEqual([]);
    history.redo();
    const loaded = play({ snapshot: store.snapshot() }).story;
    expect(loaded.actions).toEqual(story.actions);
  });
});

describe("replays", () => {
  it("reproduce the state and event record exactly", () => {
    const original = playthrough();
    const replay = original.story.toReplay();
    expect(replay.seed).toBe("fog-bound");
    const copy = play({ seed: "ignored: the replay's seed wins" });
    copy.story.playReplay(replay);
    // The whole store, so state, the event record, and the action log all match.
    expect(copy.store.snapshot()).toEqual(original.store.snapshot());
    expect(copy.record.events()).toEqual(original.record.events());
    // A different seed gives a different playthrough.
    const other = play();
    other.story.playReplay({ ...replay, seed: "clear-skies" });
    expect(other.record.events({ kinds: ["narrative"] })).not.toEqual(
      original.record.events({ kinds: ["narrative"] }),
    );
  });

  it("round-trip through a replay file", () => {
    const replay = playthrough().story.toReplay();
    const text = writeReplay(replay);
    expect(text).toBe(`{
  "format": "loominate-replay",
  "version": 1,
  "seed": "fog-bound",
  "actions": [
    {"type":"follow","choice":{"type":"link","target":"Road","label":"Walk on"}},
    {"type":"follow","choice":{"type":"link","target":"Inn","label":"Rest"}},
    {"type":"follow","choice":{"type":"continue","target":"Road"}},
    {"type":"goTo","passage":"Cellar"},
    {"type":"follow","choice":{"type":"link","target":"Road","label":"Walk on"}}
  ]
}
`);
    expect(readReplay(text)).toEqual(replay);
    expect(writeReplay(readReplay(text))).toBe(text);
    const empty: Replay = { format: "loominate-replay", version: 1, seed: "", actions: [] };
    expect(readReplay(writeReplay(empty))).toEqual(empty);
  });

  it("say which action diverged, and stop there", () => {
    const replay = playthrough().story.toReplay();
    // The game changed: the inn's continue point now leads to the cellar.
    const changed = passages.map((p) =>
      p.id === "Inn" ? { ...p, body: () => [{ type: "continue" as const, target: "Cellar" }] } : p,
    );
    const { story } = play({ game: changed });
    expect(() => {
      story.playReplay(replay);
    }).toThrow(
      `replay action 3 of 5 (continue to "Road"): follow: "Road" isn't a choice in passage "Inn".`,
    );
    expect(story.current).toBe("Inn");
    expect(story.actions).toHaveLength(2);
  });

  it("need a fresh story, and a begun one to record", () => {
    const { story } = play();
    expect(() => story.toReplay()).toThrow("toReplay: call begin() first.");
    story.begin();
    expect(() => {
      story.playReplay(story.toReplay());
    }).toThrow("playReplay: the story has already begun; play a replay on a fresh store.");
  });
});

describe("reading replay files", () => {
  const file = (fields: Record<string, unknown>) =>
    JSON.stringify({ format: "loominate-replay", version: 1, seed: "s", actions: [], ...fields });
  const action = (a: unknown) => file({ actions: [a] });

  it("explains what's wrong with a file it can't read", () => {
    expect(() => readReplay("{")).toThrow(/^replay: the file isn't valid JSON \(/);
    expect(() => readReplay("[]")).toThrow(
      `replay: this isn't a replay file; it needs "format": "loominate-replay".`,
    );
    expect(() => readReplay(file({ version: 2 }))).toThrow(
      "replay: the file is version 2, made by a newer engine; this one reads version 1.",
    );
    expect(() => readReplay(file({ version: "1" }))).toThrow(`replay: "version" must be 1.`);
    expect(() => readReplay(file({ seed: 7 }))).toThrow(`replay: "seed" must be a string.`);
    expect(() => readReplay(file({ actions: {} }))).toThrow(`replay: "actions" must be a list.`);
    expect(() => readReplay(file({ notes: "hi" }))).toThrow(
      `replay: the file has an unknown field "notes"; expected "format", "version", "seed", "actions".`,
    );
  });

  it("checks each action", () => {
    expect(() => readReplay(action("go"))).toThrow("replay: action 1 must be an object.");
    expect(() => readReplay(action({ type: "jump" }))).toThrow(
      `replay: action 1 has an unknown "type"; actions are "follow" or "goTo".`,
    );
    expect(() => readReplay(action({ type: "goTo", passage: "" }))).toThrow(
      `replay: action 1 needs a "passage" name.`,
    );
    expect(() => readReplay(action({ type: "goTo", passage: "A", at: 3 }))).toThrow(
      `replay: action 1 has an unknown field "at"; expected "type", "passage".`,
    );
    expect(() => readReplay(action({ type: "follow" }))).toThrow(
      `replay: action 1 needs a "choice" object.`,
    );
    expect(() =>
      readReplay(action({ type: "follow", choice: { type: "button", target: "A" } })),
    ).toThrow(`replay: action 1 has a choice whose "type" isn't "link" or "continue".`);
    expect(() => readReplay(action({ type: "follow", choice: { type: "link" } }))).toThrow(
      `replay: action 1 has a choice with no "target" passage.`,
    );
    expect(() =>
      readReplay(action({ type: "follow", choice: { type: "link", target: "A" } })),
    ).toThrow(`replay: action 1 has a link with no "label".`);
    expect(() =>
      readReplay(action({ type: "follow", choice: { type: "continue", target: "A", label: 1 } })),
    ).toThrow(`replay: action 1 has a choice whose "label" isn't a string.`);
    expect(() =>
      readReplay(
        action({ type: "follow", choice: { type: "link", target: "A", label: "a", guard: {} } }),
      ),
    ).toThrow(`replay: action 1's choice has an unknown field "guard"`);
  });
});
