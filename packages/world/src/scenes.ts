/**
 * Scenes (#68, ADR 0060): named periods of the story, as Inform 7 and
 * adv3Lite have them, with start and end conditions, which add rules and
 * actions while they're happening.
 *
 * A scene starts when its `startsWhen` holds, at its `startsAt` time, or
 * when code starts it; it ends when one of its `endsWhen` endings holds,
 * when it `lasts` out, or when code ends it. Its conditions are checked
 * after every move and whenever a fuse or daemon fires. Whether it's
 * happening, how often it has, and how it last ended are state.
 *
 * Its rules are registered once, when the game loads, and take part only
 * while it's happening, so undo and loading a save always agree with what's
 * happening. (Not to be confused with a cut scene, a passage of beats.)
 */
import {
  emit,
  hook,
  object,
  StateError,
  type Period,
  type RuleList,
  type RuleOptions,
  type Text,
} from "@loominate-if/core";
import type { CalendarQuery } from "./calendar.js";
import { clock } from "./clock.js";
import { daemon, fuse, onFired, type Delay } from "./schedule.js";

const SOURCE = "@loominate-if/world";

/** How a scene ends: one condition, or several, each naming an ending. */
export type Endings = (() => boolean) | { readonly [ending: string]: () => boolean };

/** How {@link scene} defines a scene. */
export type SceneOptions = {
  /** What to call it, for the inspector and messages: "the storm". Defaults to its ID. */
  readonly name?: string;
  /** It starts once this holds, checked after every move and whenever a fuse or daemon fires. */
  readonly startsWhen?: () => boolean;
  /**
   * It ends once this holds, or once one of these does, which names how it
   * ended: `{ escaped: () => …, caught: () => … }`. A single condition's
   * ending is `"ended"`.
   */
  readonly endsWhen?: Endings;
  /** A time of day it starts at, `"HH:MM"`, every day or on the days `on` says. */
  readonly startsAt?: string;
  /** With `startsAt`, the days: weekdays, or any calendar check. */
  readonly on?: string | readonly string[] | CalendarQuery;
  /** How long it lasts once started, as `minutes(30)`; then it ends, as `"timeUp"`. */
  readonly lasts?: Delay;
  /**
   * Whether it can happen again after it ends: `true` for any number of
   * times, or how many times at most. Defaults to `false`: once.
   */
  readonly recurring?: boolean | number;
  /** What happens as it starts, which may say something to the player. */
  readonly onStart?: () => string | Text | undefined;
  /** What happens as it ends, given how, which may say something to the player. */
  readonly onEnd?: (how: string) => string | Text | undefined;
  /** The package that defines it, for the inspector. Defaults to the game. */
  readonly source?: string;
};

/** A scene: a named period of the story. */
export type Scene = Period & {
  /** Its name, for the inspector and messages. */
  readonly name: string;
  /** Whether it has ever started. */
  readonly hasHappened: boolean;
  /** Whether it has started and ended, and isn't happening now. */
  readonly hasEnded: boolean;
  /** How many times it has started. */
  readonly timesStarted: number;
  /** How it last ended, such as `"escaped"`, or `undefined` if it hasn't. */
  readonly howEnded: string | undefined;
  /** The clock's `minutes` when it last started, if it has. */
  readonly startedAt: number | undefined;
  /** Whether it could start now: it isn't happening, and it hasn't happened as often as it may. */
  readonly canStart: boolean;
  /**
   * Starts it now, from an effect, an action, or a fuse.
   *
   * @throws StateError if it's happening, or can't happen again.
   */
  start(): void;
  /**
   * Ends it now, as `how` (`"ended"` unless it says).
   *
   * @throws StateError if it isn't happening.
   */
  end(how?: string): void;
  /**
   * Adds a rule to a rulebook, hook, or action stage that takes part only
   * while the scene is happening, as Inform's "Instead of jumping during
   * the Storm". Call it when the game loads. While the scene isn't
   * happening, a decide rule decides nothing, a fold rule passes its value
   * on, and a hook's rule does nothing.
   *
   * @example
   * ```ts
   * storm.rule(open.check, "the door won't budge in the storm", ({ thing }) =>
   *   thing.id === "frontDoor" ? "The wind holds the door shut." : undefined,
   * );
   * ```
   */
  rule<F extends (...args: never[]) => unknown>(
    book: RuleList<F>,
    name: string,
    fn: F,
    options?: RuleOptions,
  ): void;
};

/** Every scene, in the order they were defined, which is the order they're checked in. */
const scenes: { readonly scene: Scene; readonly check: () => void }[] = [];

const said = (text: string | Text | undefined): string =>
  text === undefined ? "" : typeof text === "function" ? text() : text;

/**
 * Defines a scene. Define it in `story.ts`, or a module it imports, so it
 * exists when a save loads.
 *
 * @example
 * ```ts
 * export const storm = scene("storm", {
 *   name: "the storm",
 *   startsWhen: () => clock.is("evening") && you.location?.id === "cliff",
 *   endsWhen: { sheltered: () => you.location?.id === "cave", over: () => storm.startedAt !== undefined && clock.minutes - storm.startedAt >= 60 },
 *   onStart: () => "Thunder cracks overhead.",
 * });
 * ```
 *
 * @throws StateError if another scene has the ID.
 */
export function scene(id: string, options: SceneOptions = {}): Scene {
  const where = `scene ${JSON.stringify(id)}`;
  if (scenes.some((s) => s.scene.id === id)) {
    throw new StateError(`${where}: another scene has this ID. Give each its own.`);
  }
  const recurring = options.recurring ?? false;
  if (typeof recurring === "number" && (!Number.isInteger(recurring) || recurring < 1)) {
    throw new StateError(
      `${where}: recurring ${String(recurring)} isn't a number of times, 1 or more; give true for any number.`,
    );
  }
  if (options.on !== undefined && options.startsAt === undefined) {
    throw new StateError(
      `${where}: \`on\` says which days it starts at its \`startsAt\` time; give it \`startsAt\` too.`,
    );
  }
  if (options.lasts !== undefined && !("minutes" in options.lasts)) {
    throw new StateError(`${where}: \`lasts\` is a time, as minutes(30).`);
  }
  const source = options.source ?? "game";
  const state = object(`world:scene:${id}`, {
    happening: false,
    times: 0,
    startedAt: null as number | null,
    howEnded: null as string | null,
  });
  const name = options.name ?? id;
  const limit = recurring === true ? Infinity : recurring === false ? 1 : recurring;
  const tell = (text: string): void => {
    if (text !== "") emit("scheduled", { text, source: `scene:${id}`, standsOut: true });
  };

  const timeUp =
    options.lasts === undefined
      ? undefined
      : fuse(`scene:${id}:lasts`, { after: options.lasts, source }, () => {
          if (state.happening) end("timeUp");
          return undefined;
        });

  const start = (): void => {
    if (state.happening) throw new StateError(`${where}: it's already happening.`);
    if (state.times >= limit) {
      throw new StateError(
        `${where}: it has happened ${state.times === 1 ? "once" : `${String(state.times)} times`}, and can't happen again. Give it recurring: true, or a number of times, to let it.`,
      );
    }
    state.happening = true;
    state.times += 1;
    state.startedAt = clock.minutes;
    state.howEnded = null;
    timeUp?.start();
    tell(said(options.onStart?.()));
  };
  const end = (how = "ended"): void => {
    if (!state.happening) throw new StateError(`${where}: it isn't happening, so it can't end.`);
    state.happening = false;
    state.howEnded = how;
    if (timeUp?.isRunning === true) timeUp.cancel();
    tell(said(options.onEnd?.(how)));
  };

  const endings: readonly (readonly [string, () => boolean])[] =
    options.endsWhen === undefined
      ? []
      : typeof options.endsWhen === "function"
        ? [["ended", options.endsWhen]]
        : Object.entries(options.endsWhen);

  const handle: Scene = Object.freeze({
    id,
    name,
    get isHappening() {
      return state.happening;
    },
    get hasHappened() {
      return state.times > 0;
    },
    get hasEnded() {
      return state.times > 0 && !state.happening;
    },
    get timesStarted() {
      return state.times;
    },
    get howEnded() {
      return state.howEnded ?? undefined;
    },
    get startedAt() {
      return state.startedAt ?? undefined;
    },
    get canStart() {
      return !state.happening && state.times < limit;
    },
    start,
    end,
    rule<F extends (...args: never[]) => unknown>(
      book: RuleList<F>,
      ruleName: string,
      fn: F,
      ruleOptions: RuleOptions = {},
    ): void {
      const fold = (book as { readonly kind?: string }).kind === "fold";
      const wrapped = ((...args: never[]) => {
        if (state.happening) return fn(...args);
        // Not happening: decide nothing, pass a fold's value on, or do nothing.
        return fold ? (args[0] as unknown) : undefined;
      }) as unknown as F;
      book.rule(ruleName, wrapped, {
        ...ruleOptions,
        source: ruleOptions.source ?? `${source} (during ${name})`,
      });
    },
  });

  if (options.startsAt !== undefined) {
    daemon(
      `scene:${id}:startsAt`,
      {
        at: options.startsAt,
        ...(options.on !== undefined && { on: options.on }),
        running: true,
        source,
      },
      () => {
        if (handle.canStart) start();
        return undefined;
      },
    );
  }

  const check = (): void => {
    if (state.happening) {
      const ending = endings.find(([, holds]) => holds());
      if (ending) end(ending[0]);
    } else if (options.startsWhen && handle.canStart && options.startsWhen()) {
      start();
    }
  };
  scenes.push({ scene: handle, check });
  return handle;
}

/** Checks every scene's conditions, in the order they were defined. */
function checkScenes(): void {
  for (const s of scenes) s.check();
}

// After every move, and whenever a fuse or daemon fires.
hook("turnEnd").rule(
  "scenes",
  () => {
    checkScenes();
  },
  { source: SOURCE },
);
onFired(checkScenes);

/** Every scene, for the inspector. @internal */
export function _scenes(): readonly Scene[] {
  return scenes.map((s) => s.scene);
}
