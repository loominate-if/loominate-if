/**
 * Audio cues (#146, ADR 0117): DOM-free, as game state and events, for
 * presentation to play. What each looping channel plays, music and
 * ambience, is state, so undo, saves, and replays restore it; a one-shot
 * sound is an event in the record, played as the move that made it is
 * shown. Files are named by path, as from the game's `public/` folder.
 */
import type { EffectContext } from "../passages/story.js";
import { boundStore, emit } from "../objects/objects.js";
import { StateError } from "../state/value.js";

/** Where core keeps what each channel plays. IDs starting with `$` are reserved for core. */
export const AUDIO_ID = "$audio";

/** The looping channels: music, and ambience such as rain. One-shot sounds are {@link sound}. */
export type AudioChannelName = "music" | "ambience";

/** What a channel plays: a file, how long to crossfade to it, in seconds, and how loud, 0 to 1. */
export type ChannelCue = {
  readonly src: string;
  readonly fade: number;
  readonly volume: number;
};

/** A looping channel, as {@link music} and {@link ambience}. */
export type AudioChannel = {
  /** Its name. */
  readonly name: AudioChannelName;
  /**
   * Plays `src` on it, looping, in place of what it played, crossfading
   * over `fade` seconds (0, a cut, by default) at `volume` (1 by default).
   */
  play(src: string, options?: { readonly fade?: number; readonly volume?: number }): void;
  /** Stops it, fading out over `fade` seconds. */
  stop(options?: { readonly fade?: number }): void;
  /** What it plays now, if anything. */
  readonly playing: string | undefined;
};

const checkFade = (where: string, fade: number | undefined): number => {
  if (fade === undefined) return 0;
  if (typeof fade !== "number" || !(fade >= 0)) {
    throw new StateError(`${where}: fade is a number of seconds, 0 or more, not ${String(fade)}.`);
  }
  return fade;
};
const checkVolume = (where: string, volume: number | undefined): number => {
  if (volume === undefined) return 1;
  if (typeof volume !== "number" || !(volume >= 0 && volume <= 1)) {
    throw new StateError(`${where}: volume is from 0 to 1, not ${String(volume)}.`);
  }
  return volume;
};
const checkSrc = (where: string, src: unknown): string => {
  if (typeof src !== "string" || src === "") {
    throw new StateError(`${where}: name the file to play, as "sounds/rain.ogg".`);
  }
  return src;
};

function channel(name: AudioChannelName): AudioChannel {
  return Object.freeze({
    name,
    play(src: string, options: { readonly fade?: number; readonly volume?: number } = {}) {
      const where = `${name}.play`;
      const cue: ChannelCue = {
        src: checkSrc(where, src),
        fade: checkFade(where, options.fade),
        volume: checkVolume(where, options.volume),
      };
      boundStore(where, true).set(AUDIO_ID, name, cue);
    },
    stop(options: { readonly fade?: number } = {}) {
      const where = `${name}.stop`;
      boundStore(where, true).set(AUDIO_ID, name, {
        src: "",
        fade: checkFade(where, options.fade),
        volume: 0,
      });
    },
    get playing() {
      const cue = boundStore(name, false).get(AUDIO_ID, name) as ChannelCue | undefined;
      return cue && cue.src !== "" ? cue.src : undefined;
    },
  });
}

/**
 * The music channel, looping one piece at a time.
 *
 * @example
 * ```ts
 * music.play("music/storm.ogg", { fade: 2 });
 * ```
 */
export const music: AudioChannel = channel("music");

/**
 * The ambience channel, looping a background such as rain, under the music.
 *
 * @example
 * ```ts
 * ambience.play("sounds/rain.ogg", { fade: 3, volume: 0.6 });
 * ```
 */
export const ambience: AudioChannel = channel("ambience");

/**
 * Plays a sound once, as the move it's made in is shown: an event in the
 * record. `caption` says what it is, shown and read like a notice for
 * players who turn captions on.
 *
 * @example
 * ```ts
 * sound("sounds/door.ogg", { caption: "A door slams." });
 * ```
 */
export function sound(
  src: string,
  options: { readonly caption?: string; readonly volume?: number } = {},
): void {
  const where = "sound";
  emit("sound", {
    src: checkSrc(where, src),
    ...(options.caption !== undefined && { caption: options.caption }),
    ...(options.volume !== undefined && { volume: checkVolume(where, options.volume) }),
  });
}

/** What a channel plays in `store`, for presentation: a cue, or `undefined` for none. @internal */
export function _channelCue(
  store: { get(id: string, key: string): unknown },
  name: AudioChannelName,
): ChannelCue | undefined {
  const cue = store.get(AUDIO_ID, name) as ChannelCue | undefined;
  return cue && typeof cue.src === "string" ? cue : undefined;
}

/** `{music "…"}` and `{ambience "…"}` in a passage, played as the player reaches them. */
function cueChannel(
  args: {
    readonly channel: AudioChannelName;
    readonly src: string;
    readonly fade?: number;
    readonly volume?: number;
  },
  context: EffectContext,
): void {
  void context;
  (args.channel === "music" ? music : ambience).play(args.src, {
    ...(args.fade !== undefined && { fade: args.fade }),
    ...(args.volume !== undefined && { volume: args.volume }),
  });
}

/** `{music "…"}` in a passage. */
export function cueMusic(
  args: { readonly src: string; readonly fade?: number; readonly volume?: number },
  context: EffectContext,
): void {
  cueChannel({ ...args, channel: "music" }, context);
}

/** `{ambience "…"}` in a passage. */
export function cueAmbience(
  args: { readonly src: string; readonly fade?: number; readonly volume?: number },
  context: EffectContext,
): void {
  cueChannel({ ...args, channel: "ambience" }, context);
}

/** `{music stop}` in a passage. */
export function stopMusic(args: { readonly fade?: number }, context: EffectContext): void {
  void context;
  music.stop(args.fade === undefined ? {} : { fade: args.fade });
}

/** `{ambience stop}` in a passage. */
export function stopAmbience(args: { readonly fade?: number }, context: EffectContext): void {
  void context;
  ambience.stop(args.fade === undefined ? {} : { fade: args.fade });
}

/** `{sound "…"}` in a passage. */
export function cueSound(
  args: { readonly src: string; readonly caption?: string; readonly volume?: number },
  context: EffectContext,
): void {
  void context;
  sound(args.src, {
    ...(args.caption !== undefined && { caption: args.caption }),
    ...(args.volume !== undefined && { volume: args.volume }),
  });
}
