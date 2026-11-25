/** The audio player (#146): following the game's cues, waiting for the player, and the settings. */
import {
  ambience,
  createEventRecord,
  createHistory,
  createStore,
  createStory,
  music,
  sound,
  type Passage,
} from "@loominate-if/core";
import { describe, expect, it } from "vitest";
import { createAudioPlayer, DEFAULT_SOUND, type Playing } from "./player.js";

/** A stand-in for the browser's audio: what was made, and whether it's playing. */
function backend() {
  const made: (Playing & { src: string; playing: boolean })[] = [];
  return {
    made,
    create: (src: string): Playing => {
      const p = {
        src,
        volume: 1,
        loop: false,
        playing: false,
        play() {
          p.playing = true;
        },
        pause() {
          p.playing = false;
        },
      };
      made.push(p);
      return p;
    },
  };
}

/** Timers run by hand: each fade step when `tick` is called. */
function timers() {
  const running = new Set<() => void>();
  return {
    every: (_ms: number, run: () => void) => {
      running.add(run);
      return () => {
        running.delete(run);
      };
    },
    tick(n = 1) {
      for (let i = 0; i < n; i++) for (const run of [...running]) run();
    },
  };
}

const passages: Passage[] = [
  {
    id: "Hall",
    tags: [],
    effects: {
      enter: () => {
        music.play("hall.ogg", { fade: 1 });
        sound("door.ogg");
      },
    },
    body: () => [{ type: "link", label: "On", target: "Garden" }],
  },
  {
    id: "Garden",
    tags: [],
    effects: {
      enter: () => {
        music.play("garden.ogg", { fade: 1 });
        ambience.play("birds.ogg", { volume: 0.5 });
      },
    },
    body: () => [],
  },
];

function play(reduced = false) {
  const store = createStore();
  const record = createEventRecord(store);
  const story = createStory(store, record, passages, { start: "Hall" });
  const history = createHistory(store);
  story.begin();
  history.clear();
  store.commit();
  const audio = backend();
  const clock = timers();
  const player = createAudioPlayer({
    backend: audio.create,
    settings: DEFAULT_SOUND,
    reducedMotion: () => reduced,
    timers: clock,
  });
  return { store, record, story, history, audio, clock, player };
}
/** What's playing on the looping channels: one-shot sounds play once and don't loop. */
const playing = (made: { src: string; playing: boolean; loop: boolean }[]) =>
  made.filter((m) => m.playing && m.loop).map((m) => m.src);

describe("the audio player (#146)", () => {
  it("waits for the player's first interaction, then plays what the game cues", () => {
    const { store, record, audio, player } = play();
    player.follow(store, record, "move");
    expect([player.waiting, playing(audio.made)]).toEqual([true, []]);
    player.unlock();
    // The music the game is in; the door, before the interaction, isn't played late.
    expect([player.waiting, playing(audio.made)]).toEqual([false, ["hall.ogg"]]);
  });

  it("plays a move's new sounds once, and crossfades the music to the next piece", () => {
    const { store, record, story, history, audio, clock, player } = play();
    player.unlock();
    player.follow(store, record, "move");
    clock.tick(20);
    const hall = audio.made.find((m) => m.src === "hall.ogg");
    expect(hall?.volume).toBe(1);
    story.follow({ type: "link", label: "On", target: "Garden" });
    history.checkpoint();
    player.follow(store, record, "move");
    // The new music fades in as the old fades out, then the old stops.
    clock.tick(10);
    const garden = audio.made.find((m) => m.src === "garden.ogg");
    expect([hall?.volume, garden?.volume]).toEqual([0.5, 0.5]);
    clock.tick(20);
    expect(playing(audio.made)).toEqual(["garden.ogg", "birds.ogg"]);
    expect(audio.made.find((m) => m.src === "birds.ogg")?.volume).toBe(0.5);
    // Undo is a jump: the music goes back, and the door isn't played again.
    history.undo();
    const doors = audio.made.filter((m) => m.src === "door.ogg").length;
    player.follow(store, record, "jump");
    clock.tick(30);
    expect(playing(audio.made)).toEqual(["hall.ogg"]);
    expect(audio.made.filter((m) => m.src === "door.ogg").length).toBe(doors);
  });

  it("cuts instead of fading when the player prefers reduced motion", () => {
    const { store, record, audio, player } = play(true);
    player.unlock();
    player.follow(store, record, "move");
    expect(audio.made.find((m) => m.src === "hall.ogg")?.volume).toBe(1);
  });

  it("applies the settings at once: off silences, and each channel's volume scales it", () => {
    const { store, record, audio, clock, player } = play();
    player.unlock();
    player.follow(store, record, "move");
    clock.tick(30);
    player.settings({ ...DEFAULT_SOUND, music: 0.25 });
    expect(audio.made.find((m) => m.src === "hall.ogg")?.volume).toBe(0.25);
    player.settings({ ...DEFAULT_SOUND, on: false });
    expect(audio.made.find((m) => m.src === "hall.ogg")?.volume).toBe(0);
  });
});
