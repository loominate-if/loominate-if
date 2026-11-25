/**
 * Scripted exchanges (#142, ADR 0114): NPCs trading lines in a
 * conversation, one at a time. While one plays, the conversation offers
 * only Continue, which says the next line, each as its speaker's own
 * words, so the story log reads them as theirs.
 */
import {
  _storyRunning,
  action,
  emit,
  message,
  messages,
  object,
  StateError,
  type ObjectRef,
} from "@loominate-if/core";
import { mindFor } from "./actors.js";
import { conversation } from "./conversations.js";
import { _useExchangeContinue, _useExchanges, type SuggestedTopic } from "./topics.js";

declare module "@loominate-if/core" {
  interface Messages {
    /** The one topic while a scripted exchange plays: "Continue". */
    "exchange.continue": Record<never, never>;
    /** Why Continue isn't offered: no exchange is playing. */
    "exchange.none": Record<never, never>;
  }
}
const SOURCE = "@loominate-if/world";
messages.register("exchange.continue", () => "Continue", { source: SOURCE });
messages.register("exchange.none", () => "No one is in the middle of saying anything.", {
  source: SOURCE,
});

/** One line of a scripted exchange: who says it, and what, with its quotation marks. */
export type ExchangeLine = readonly [speaker: ObjectRef, text: string];

const exchanges = new Map<string, readonly ExchangeLine[]>();
const state = object("world:exchange", {
  /** The exchange playing, by name, and the next line to say. */
  playing: null as string | null,
  next: 0,
});

/**
 * Defines a scripted exchange, in `story.ts`: lines NPCs say one after
 * another in a conversation, the player choosing Continue between them.
 * An entry's `then: "argument"` plays it after answering, or
 * {@link playExchange} does.
 *
 * @example
 * ```ts
 * exchange("argument", [
 *   [butler, "“You took it. I saw you.”"],
 *   [maid, "“I never! Ask Cook.”"],
 * ]);
 * ```
 *
 * @throws StateError during play, for a name already taken, or for no lines.
 */
export function exchange(name: string, lines: readonly ExchangeLine[]): void {
  if (_storyRunning()) {
    throw new StateError(
      `exchange ${JSON.stringify(name)}: define exchanges in story.ts, as the game loads.`,
    );
  }
  if (exchanges.has(name)) {
    throw new StateError(`exchange ${JSON.stringify(name)}: another exchange has this name.`);
  }
  if (lines.length === 0) {
    throw new StateError(`exchange ${JSON.stringify(name)}: give it at least one line.`);
  }
  for (const [speaker] of lines) mindFor(speaker, `exchange ${JSON.stringify(name)}`);
  exchanges.set(name, lines);
}

/** Says the line at `at` of the exchange playing, as its speaker's words. */
function sayLine(lines: readonly ExchangeLine[], at: number): void {
  const line = lines[at];
  if (!line) return;
  const [speaker, text] = line;
  emit("action-result", { text }, ["topic", `speaker:${speaker.id}`]);
}

/**
 * Plays a scripted exchange, during play, in the player's conversation: its
 * first line now, then the rest, one each time the player chooses Continue.
 *
 * @throws StateError for an exchange that isn't defined, or with no conversation.
 */
export function playExchange(name: string): void {
  const lines = exchanges.get(name);
  if (!lines) {
    throw new StateError(
      `playExchange: there's no exchange called ${JSON.stringify(name)}. Define it with exchange() in story.ts.`,
    );
  }
  if (!conversation.active) {
    throw new StateError(
      `playExchange ${JSON.stringify(name)}: it's played in a conversation, and none is going on.`,
    );
  }
  sayLine(lines, 0);
  state.playing = lines.length > 1 ? name : null;
  state.next = lines.length > 1 ? 1 : 0;
}

/** The exchange playing now, by name, if one is. */
export function exchangePlaying(): string | undefined {
  return state.playing ?? undefined;
}

/** Continue, while an exchange plays: says its next line, and ends it after the last. */
export const continueExchange = action<Record<never, never>>("world:continueExchange", {
  source: SOURCE,
  label: () => message("exchange.continue", {}),
  verify: () => (state.playing === null ? message("exchange.none", {}) : undefined),
  run: () => {
    const name = state.playing;
    const lines = name === null ? undefined : exchanges.get(name);
    if (!lines) return;
    sayLine(lines, state.next);
    const next = state.next + 1;
    state.playing = next < lines.length ? name : null;
    state.next = next < lines.length ? next : 0;
  },
});

// An entry's `then` plays its exchange; while one plays, Continue is the only topic.
_useExchanges((name) => {
  playExchange(name);
});
_useExchangeContinue((): SuggestedTopic | undefined =>
  state.playing === null
    ? undefined
    : {
        label: message("exchange.continue", {}),
        call: continueExchange({}) as unknown as SuggestedTopic["call"],
      },
);
