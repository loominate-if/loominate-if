/** Beats: passages the player reaches part by part (#41). */
import { describe, expect, it } from "vitest";
import { createEventRecord } from "../events/record.js";
import { readReplay, writeReplay } from "../replay/replay.js";
import { createHistory } from "../state/history.js";
import { createStore, type StateSnapshot } from "../state/store.js";
import { StateError } from "../state/value.js";
import { beat, pageBreak, wait } from "./directives.js";
import { createStory, type EffectContext, type Passage } from "./story.js";

const add =
  (key: string) =>
  ({ state }: EffectContext): void => {
    const n = state.get("scene", key);
    state.set("scene", key, (typeof n === "number" ? n : 0) + 1);
  };

const passages: Passage[] = [
  {
    id: "Train",
    tags: [],
    body: ({ state }) => [
      { type: "text", text: "The train slows." },
      beat({ duration: 1500 }),
      { type: "text", text: "Brakes scream." },
      { type: "link", label: "Jump", target: "Platform" },
      wait(),
      { type: "text", text: `Silence. Lights: ${String(state.get("scene", "lights") ?? 0)}.` },
      { type: "link", label: "Get off", target: "Platform" },
    ],
    effects: { enter: add("entered") },
    beats: [{ firstVisit: add("screamed") }, { enter: add("lights") }],
  },
  {
    id: "Platform",
    tags: [],
    body: () => [
      { type: "text", text: "Page one." },
      pageBreak(),
      { type: "text", text: "Page two." },
      { type: "link", label: "Back", target: "Train" },
    ],
  },
];

function setup(snapshot?: StateSnapshot, start = "Train") {
  const store = createStore(snapshot);
  const record = createEventRecord(store);
  const story = createStory(store, record, passages, { start, seed: "s" });
  return { store, record, story };
}

const seen = (story: ReturnType<typeof setup>["story"]) => {
  const page = story.render();
  return {
    text: page.nodes.map((n) =>
      n.type === "text" ? n.text : n.type === "link" ? `[${n.label}]` : n.type,
    ),
    beat: page.beat,
    step: page.step,
    choices: page.choices.map((c) => c.label ?? c.target),
  };
};

describe("beats", () => {
  it("divide a passage into parts the player reaches in turn", () => {
    const { story } = setup();
    story.begin();
    expect(seen(story)).toEqual({
      text: ["The train slows."],
      beat: { type: "beat", duration: 1500 },
      step: 0,
      choices: [],
    });
    story.advance();
    expect(seen(story)).toEqual({
      text: ["The train slows.", "Brakes scream.", "[Jump]"],
      beat: { type: "beat" },
      step: 1,
      choices: ["Jump"],
    });
    story.advance();
    expect(seen(story)).toEqual({
      text: ["The train slows.", "Brakes scream.", "[Jump]", "Silence. Lights: 1.", "[Get off]"],
      beat: undefined,
      step: 2,
      choices: ["Jump", "Get off"],
    });
    expect(() => {
      story.advance();
    }).toThrow(
      `advance: passage "Train" has no beat left to move past; follow one of its choices instead.`,
    );
  });

  it("run the effects written after a beat when the player reaches it", () => {
    const { store, story } = setup();
    story.begin();
    expect(store.entity("scene")).toEqual({ entered: 1 });
    story.advance();
    expect(store.entity("scene")).toEqual({ entered: 1, screamed: 1 });
    story.advance();
    expect(store.entity("scene")).toEqual({ entered: 1, screamed: 1, lights: 1 });
    // On a later visit, `firstVisit` after a beat doesn't run again, but `enter` does.
    story.follow({ type: "link", label: "Get off", target: "Platform" });
    story.advance();
    story.follow({ type: "link", label: "Back", target: "Train" });
    expect(seen(story).step).toBe(0);
    story.advance();
    story.advance();
    expect(store.entity("scene")).toEqual({ entered: 2, screamed: 1, lights: 2 });
  });

  it("record each part's prose as the player reaches it, with a beat event", () => {
    const { record, story } = setup();
    story.begin();
    const read = () =>
      record
        .events({ kinds: ["narrative", "beat"] })
        .map((e) => (e.kind === "beat" ? `beat ${String(e.step)}` : e.text));
    expect(read()).toEqual(["The train slows."]);
    story.advance();
    story.advance();
    expect(read()).toEqual([
      "The train slows.",
      "beat 1",
      "Brakes scream.",
      "beat 2",
      "Silence. Lights: 1.",
    ]);
    expect(record.events({ kinds: ["phase"] }).map((e) => e.beat)).toEqual([undefined, 1, 2]);
  });

  it("clear the screen at a page break", () => {
    const { record, story } = setup(undefined, "Platform");
    story.begin();
    expect(seen(story).text).toEqual(["Page one."]);
    expect(seen(story).beat).toEqual({ type: "beat", page: true });
    story.advance();
    expect(seen(story).text).toEqual(["Page two.", "[Back]"]);
    expect(record.events({ kinds: ["beat"] })[0]).toMatchObject({ step: 1, page: true });
  });

  it("let the player follow a link revealed before the last beat", () => {
    const { story } = setup();
    story.begin();
    story.advance();
    story.follow({ type: "link", label: "Jump", target: "Platform" });
    expect(story.current).toBe("Platform");
    expect(seen(story).step).toBe(0);
  });

  it("are undone one at a time, and saved and loaded at a boundary", () => {
    const { store, story } = setup();
    const history = createHistory(store);
    story.begin();
    history.clear();
    store.commit();
    story.advance();
    history.checkpoint();
    story.advance();
    history.checkpoint();
    history.undo();
    expect(seen(story).step).toBe(1);
    expect(store.entity("scene")).toEqual({ entered: 1, screamed: 1 });

    const loaded = setup(store.snapshot());
    loaded.story.begin();
    expect(seen(loaded.story)).toEqual(seen(story));
    loaded.story.advance();
    expect(seen(loaded.story).text.at(-2)).toBe("Silence. Lights: 1.");
  });

  it("replay exactly, with advance actions in the replay file", () => {
    const { store, record, story } = setup();
    story.begin();
    story.advance();
    story.advance();
    story.follow({ type: "link", label: "Get off", target: "Platform" });
    story.advance();
    expect(story.actions.map((a) => a.type)).toEqual(["advance", "advance", "follow", "advance"]);
    const replay = readReplay(writeReplay(story.toReplay()));
    const again = setup();
    again.story.playReplay(replay);
    expect(again.store.snapshot()).toEqual(store.snapshot());
    expect(again.record.events()).toEqual(record.events());
  });

  it("roll back a part whose effect fails", () => {
    const failing: Passage[] = [
      {
        id: "Scene",
        tags: [],
        body: () => [{ type: "text", text: "One." }, wait(), { type: "text", text: "Two." }],
        beats: [
          {
            enter: ({ state }) => {
              state.set("scene", "half", true);
              throw new Error("the lights fail");
            },
          },
        ],
      },
    ];
    const store = createStore();
    const record = createEventRecord(store);
    const story = createStory(store, record, failing, { start: "Scene" });
    story.begin();
    store.commit();
    expect(() => {
      story.advance();
    }).toThrow(new StateError(`passage "Scene" enter effect after beat 1: the lights fail`));
    expect(story.render().step).toBe(0);
    expect(store.has("scene", "half")).toBe(false);
    expect(story.actions).toEqual([]);
  });
});
