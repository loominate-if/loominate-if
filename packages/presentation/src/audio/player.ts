/**
 * The audio player (#146, ADR 0117): plays what the game cues, as core
 * records it. Each looping channel plays what the game's state says it
 * plays, crossfading when that changes, so undo and loading follow; each
 * sound event made by a move is played once, as the move is shown. Nothing
 * plays until the player's first interaction, as browsers require, and
 * nothing plays with sound off.
 */
import {
  _channelCue,
  type AudioChannelName,
  type ChannelCue,
  type EventRecord,
  type StateStore,
} from "@loominate-if/core";

/** The player's sound settings, kept per game in the browser. */
export type SoundSettings = {
  /** Whether sound plays at all. */
  readonly on: boolean;
  /** Each channel's volume, 0 to 1. */
  readonly music: number;
  readonly ambience: number;
  readonly effects: number;
  /** Whether sounds' captions show, as notices. */
  readonly captions: boolean;
};

/** Sound on, everything at full volume, captions off. */
export const DEFAULT_SOUND: SoundSettings = Object.freeze({
  on: true,
  music: 1,
  ambience: 1,
  effects: 1,
  captions: false,
});

/** What the player plays a file with: an `HTMLAudioElement`, or a stand-in in tests. */
export type Playing = {
  volume: number;
  loop: boolean;
  play(): Promise<void> | void;
  pause(): void;
};

/** Makes something to play a file with. @internal */
export type AudioBackend = (src: string) => Playing;

/** How the move just shown came about: a move the player made, or a jump, as undo or loading a save. */
export type AudioChange = "move" | "jump";

/** What {@link createAudioPlayer} makes. @internal */
export type AudioPlayer = {
  /** Brings what's playing in line with `store`, and plays the move's new sounds if it was a move. */
  follow(store: StateStore, record: EventRecord, how: AudioChange): void;
  /** Applies new settings at once. */
  settings(next: SoundSettings): void;
  /** Starts playing, after the player's first interaction. */
  unlock(): void;
  /** Whether it's waiting for the player's first interaction. */
  readonly waiting: boolean;
  /** Stops everything. */
  stop(): void;
};

const CHANNELS: readonly AudioChannelName[] = ["music", "ambience"];

/** Starts `audio`, if the browser will: a refusal, as before any interaction, is silence, not an error. */
const start = (audio: Playing): void => {
  try {
    void Promise.resolve(audio.play()).catch(() => undefined);
  } catch {
    // Some browsers, and test environments, can't play at all.
  }
};
/** How often a fade steps its volume, in milliseconds. */
const STEP = 50;

/** Makes the audio player. `reducedMotion` says whether fades cut instead. @internal */
export function createAudioPlayer(options: {
  readonly backend: AudioBackend;
  readonly settings: SoundSettings;
  readonly reducedMotion: () => boolean;
  readonly timers?: {
    readonly every: (ms: number, run: () => void) => () => void;
  };
}): AudioPlayer {
  let settings = options.settings;
  let unlocked = false;
  // Presentation timing only: the fades' steps.
  const every =
    options.timers?.every ??
    ((ms: number, run: () => void) => {
      const id = setInterval(run, ms);
      return () => {
        clearInterval(id);
      };
    });
  /** Each channel's file playing, and the cue it plays. */
  const playing = new Map<
    AudioChannelName,
    { cue: ChannelCue; audio: Playing; stopFade?: () => void }
  >();
  /** What each channel should play, once sound can. */
  const wanted = new Map<AudioChannelName, ChannelCue | undefined>();
  /** The last sound event heard, so each is played once. */
  let heard = -1;

  const level = (name: AudioChannelName, cue: ChannelCue): number =>
    settings.on ? cue.volume * settings[name] : 0;

  /** Moves `audio`'s volume to `to` over `seconds`, then calls `done`. */
  const fade = (audio: Playing, to: number, seconds: number, done?: () => void): (() => void) => {
    if (seconds <= 0 || options.reducedMotion()) {
      audio.volume = to;
      done?.();
      return () => undefined;
    }
    const from = audio.volume;
    const steps = Math.max(1, Math.round((seconds * 1000) / STEP));
    let n = 0;
    const cancel = every(STEP, () => {
      n += 1;
      audio.volume = Math.min(1, Math.max(0, from + ((to - from) * n) / steps));
      if (n >= steps) {
        cancel();
        done?.();
      }
    });
    return cancel;
  };

  /** Plays what channel `name` should, crossfading from what it played. */
  const apply = (name: AudioChannelName): void => {
    const cue = wanted.get(name);
    const now = playing.get(name);
    const src = cue && cue.src !== "" ? cue.src : undefined;
    if (now && now.cue.src === src) {
      // The same file: only its volume, as settings or the cue changed.
      now.stopFade?.();
      now.cue = cue ?? now.cue;
      now.audio.volume = level(name, now.cue);
      return;
    }
    const seconds = cue?.fade ?? 0;
    if (now) {
      // The old file fades out, then stops.
      now.stopFade?.();
      const old = now.audio;
      fade(old, 0, seconds, () => {
        old.pause();
      });
      playing.delete(name);
    }
    if (!src || !cue) return;
    const audio = options.backend(src);
    audio.loop = true;
    audio.volume = 0;
    start(audio);
    const entry: { cue: ChannelCue; audio: Playing; stopFade?: () => void } = { cue, audio };
    entry.stopFade = fade(audio, level(name, cue), seconds);
    playing.set(name, entry);
  };

  return {
    follow(store, record, how) {
      for (const name of CHANNELS) wanted.set(name, _channelCue(store, name));
      const sounds = record.events({ kinds: ["sound"] });
      const last = sounds.at(-1)?.seq ?? -1;
      // A move's new sounds play; a jump, as undo or loading, plays none of the past's.
      if (how === "move" && unlocked && settings.on) {
        for (const s of sounds) {
          if (s.seq <= heard) continue;
          const audio = options.backend(s.src);
          audio.volume = (s.volume ?? 1) * settings.effects;
          start(audio);
        }
      }
      heard = last;
      if (unlocked) for (const name of CHANNELS) apply(name);
    },
    settings(next) {
      settings = next;
      if (unlocked) for (const name of CHANNELS) apply(name);
    },
    unlock() {
      if (unlocked) return;
      unlocked = true;
      for (const name of CHANNELS) apply(name);
    },
    get waiting() {
      return !unlocked;
    },
    stop() {
      for (const [, p] of playing) {
        p.stopFade?.();
        p.audio.pause();
      }
      playing.clear();
    },
  };
}
