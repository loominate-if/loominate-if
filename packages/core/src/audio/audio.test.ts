/** Audio cues (#146): channels as state, which undo restores, and sounds as events. */
import { describe, expect, it } from "vitest";
import { createEventRecord } from "../events/record.js";
import { createStory, type Passage } from "../passages/story.js";
import { createHistory } from "../state/history.js";
import { createStore } from "../state/store.js";
import { _channelCue, ambience, cueMusic, cueSound, music, sound, stopMusic } from "./audio.js";

const passages: Passage[] = [
  {
    id: "Hall",
    tags: [],
    effects: {
      enter: (context) => {
        cueMusic({ src: "music/hall.ogg", fade: 2 }, context);
        cueSound({ src: "sounds/door.ogg", caption: "A door slams." }, context);
      },
    },
    body: () => [{ type: "link", label: "On", target: "Garden" }],
  },
  {
    id: "Garden",
    tags: [],
    effects: {
      enter: (context) => {
        stopMusic({ fade: 1 }, context);
        ambience.play("sounds/birds.ogg", { volume: 0.5 });
      },
    },
    body: () => [],
  },
];

function begin() {
  const store = createStore();
  const record = createEventRecord(store);
  const story = createStory(store, record, passages, { start: "Hall" });
  story.begin();
  return { store, record, story };
}

describe("audio cues (#146)", () => {
  it("keep what each channel plays as state, and sounds as events", () => {
    const { store, record } = begin();
    expect(_channelCue(store, "music")).toEqual({ src: "music/hall.ogg", fade: 2, volume: 1 });
    expect(music.playing).toBe("music/hall.ogg");
    expect(record.events({ kinds: ["sound"] }).map((e) => [e.src, e.caption])).toEqual([
      ["sounds/door.ogg", "A door slams."],
    ]);
  });

  it("follow undo, as any state does", () => {
    const { store, story } = begin();
    const history = createHistory(store);
    history.clear();
    store.commit();
    story.follow({ type: "link", label: "On", target: "Garden" });
    history.checkpoint();
    expect([music.playing, ambience.playing]).toEqual([undefined, "sounds/birds.ogg"]);
    expect(_channelCue(store, "music")).toEqual({ src: "", fade: 1, volume: 0 });
    history.undo();
    expect([music.playing, ambience.playing]).toEqual(["music/hall.ogg", undefined]);
  });

  it("say what's wrong with a cue", () => {
    begin();
    expect(() => {
      music.play("");
    }).toThrow('name the file to play, as "sounds/rain.ogg"');
    expect(() => {
      music.play("a.ogg", { fade: -1 });
    }).toThrow("fade is a number of seconds, 0 or more");
    expect(() => {
      sound("a.ogg", { volume: 2 });
    }).toThrow("volume is from 0 to 1");
  });
});
