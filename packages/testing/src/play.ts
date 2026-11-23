/**
 * Walkthrough tests (#54, ADR 0026): scripted playthroughs that make moves in
 * order and check what the player sees and what the game's state is, run
 * headless in Vitest by `loominate test`.
 */
import {
  _noticeParagraphs,
  createEventRecord,
  createHistory,
  createStore,
  createStory,
  type BeatNode,
  type EventRecord,
  type History,
  type Passage,
  type PassageId,
  type RecordedEvent,
  type RenderedPassage,
  type Replay,
  type StateSnapshot,
  type StateStore,
  type Story,
  type StoryOptions,
} from "@loominate-if/core";

/** A game to play: its passages and where a new game starts. */
export type GameDefinition = {
  /** The game's passages. */
  readonly passages: readonly Passage[];
  /** The passage a new game starts in. */
  readonly start: PassageId;
  /** Other story options, such as `guardMode`. */
  readonly story?: Omit<StoryOptions, "start" | "seed">;
};

/** Options for {@link play}. */
export type WalkthroughOptions = Partial<GameDefinition> & {
  /** The master seed, so random results are the same every run. Defaults to `"walkthrough"`. */
  readonly seed?: string;
  /** A saved state to start from, such as a save file's `state`, instead of a new game. */
  readonly from?: StateSnapshot;
};

/** A choice that can't be made now, and why. */
export type UnavailableChoice = {
  /** The link's label. */
  readonly label: string;
  /** The guard's condition, such as `lantern.isLit`. */
  readonly condition: string;
  /** The reason the player is shown, when the link shows one. */
  readonly reason?: string;
  /** Whether the player sees the link, disabled, or it's hidden. */
  readonly shown: boolean;
};

/** A game being played by a walkthrough test. */
export interface Walkthrough {
  /** The current passage. */
  readonly passage: PassageId;
  /** The prose on screen, one paragraph per line, with links inside paragraphs as their labels. */
  readonly text: string;
  /**
   * What the player noticed during the last move, what their actions did,
   * and what fuses and daemons said, one per line: the perception,
   * action-result, and scheduled events the page shows
   * where the passage's `{notices}` is, or else after its text, before its
   * choices. They're in {@link Walkthrough.text} there too.
   */
  readonly notices: string;
  /** The labels of the choices that can be made now, in order. A continue point without a label is "Continue". */
  readonly choices: readonly string[];
  /** Links on screen or hidden that can't be followed now, with why. */
  readonly unavailable: readonly UnavailableChoice[];
  /** The beat waiting to be moved past, if the passage has more to show. */
  readonly beat: BeatNode | undefined;
  /** Every paragraph of prose the player has read, in order, one per line. */
  readonly transcript: string;
  /**
   * Makes the choice with this label, as the player would. Writing `"Continue"`
   * follows a continue point without a label.
   * @throws Error if there's no such choice now, listing the choices there are,
   * and why a matching link can't be followed.
   */
  choose(label: string): this;
  /**
   * Moves past the next beat.
   * @throws Error if there's no beat waiting.
   */
  advance(): this;
  /** Moves past every remaining beat in the passage, as the player's Skip does. */
  skip(): this;
  /**
   * Takes back the last move, as the player's Undo does.
   * @throws Error if there's nothing to undo.
   */
  undo(): this;
  /** The replay file for the playthrough so far, for a bug report or a determinism check. */
  replay(): Replay;
  /** The story, for anything this API doesn't cover. */
  readonly story: Story;
  /** The state store. */
  readonly store: StateStore;
  /** The event record. */
  readonly record: EventRecord;
  /** The undo history, checkpointed after each move. */
  readonly history: History;
}

let loaded: GameDefinition | undefined;

/**
 * Sets the game `play()` plays when it isn't given one. `loominate test` calls
 * it with every passage file in the game and its config's start passage.
 *
 * @internal
 */
export function _setGame(game: GameDefinition | undefined): void {
  loaded = game;
}

const CONTINUE = "Continue";

/**
 * Starts a walkthrough of the game: a new game, or one from a saved state.
 *
 * @example
 * ```ts
 * import { play } from "@loominate-if/testing";
 * import { expect, test } from "vitest";
 * import { lamp } from "./story.js";
 *
 * test("lighting the lamp", () => {
 *   const game = play();
 *   game.choose("Light the lamp");
 *   expect(game.text).toContain("fills with light");
 *   expect(lamp.lit).toBe(true);
 * });
 * ```
 *
 * @throws Error if no game was given and none was loaded by `loominate test`.
 */
export function play(options: WalkthroughOptions = {}): Walkthrough {
  const passages = options.passages ?? loaded?.passages;
  const start = options.start ?? loaded?.start;
  if (!passages || start === undefined) {
    throw new Error(
      "play() has no game to play. Run walkthroughs with `loominate test`, which loads the game, or pass one: play({ passages, start }).",
    );
  }
  const store = createStore(options.from);
  const record = createEventRecord(store);
  const story = createStory(store, record, passages, {
    ...(options.story ?? loaded?.story),
    start,
    seed: options.seed ?? "walkthrough",
  });
  const history = createHistory(store);
  story.begin();
  // What came before the first move isn't undoable, as in play.
  history.clear();
  store.commit();

  const page = (): RenderedPassage => story.render();
  /** The texts of the perception, action-result, and scheduled events since the move on screen began. */
  const notices = (): string[] => {
    const out: RecordedEvent[] = [];
    for (const e of record.events({
      kinds: ["perception", "action-result", "scheduled", "navigation", "action", "beat"],
    })) {
      if (
        e.kind === "navigation" ||
        e.kind === "action" ||
        (e.kind === "beat" && e.page === true)
      ) {
        out.length = 0;
      } else if (e.kind !== "beat") out.push(e);
    }
    // One line per paragraph, as the page shows them: atmosphere runs together.
    return _noticeParagraphs(out).map((p) => p.map((e) => (e as { text: string }).text).join(" "));
  };
  const labelOf = (c: RenderedPassage["choices"][number]): string =>
    c.type === "continue" ? (c.label ?? CONTINUE) : c.label;
  const moved = (): void => {
    history.checkpoint();
  };

  const game: Walkthrough = {
    get passage() {
      return story.current ?? start;
    },
    get text() {
      // As the page shows them: where `{notices}` puts them, or else after the
      // text, before the first choice.
      const lines: string[] = [];
      const nodes = page().nodes;
      const placed = nodes.some((n) => n.type === "notices");
      let left = notices();
      for (const n of nodes) {
        if (n.type === "notices" || (!placed && (n.type === "link" || n.type === "continue"))) {
          lines.push(...left);
          left = [];
        } else if (n.type === "text") lines.push(n.text);
      }
      return [...lines, ...left].join("\n");
    },
    get notices() {
      return notices().join("\n");
    },
    get choices() {
      return page().choices.map(labelOf);
    },
    get unavailable() {
      return page().unavailable.map((u) => {
        const shown = page().nodes.some(
          (n) =>
            (n.type === "link" && n.label === u.link.label && n.target === u.link.target) ||
            (n.type === "text" && (n.links ?? []).some((l) => l.label === u.link.label)),
        );
        return {
          label: u.link.label,
          condition: u.condition,
          ...(u.mode === "disabled-with-reason" &&
            u.link.guard?.reason !== undefined && { reason: u.link.guard.reason }),
          shown,
        };
      });
    },
    get beat() {
      return page().beat;
    },
    get transcript() {
      return record
        .events({
          kinds: [
            "perception",
            "narrative",
            "scene",
            "dialogue",
            "room-description",
            "action-result",
            "scheduled",
          ],
        })
        .map((e) => (e as { text: string }).text)
        .join("\n");
    },
    choose(label) {
      const now = page();
      const choice = now.choices.find((c) => labelOf(c) === label);
      if (!choice) {
        const where = `passage ${JSON.stringify(game.passage)}`;
        const closed = game.unavailable.find((u) => u.label === label);
        const why = closed
          ? ` "${label}" can't be followed: \`${closed.condition}\` doesn't hold${closed.reason === undefined ? "" : ` (the player is told "${closed.reason}")`}.`
          : "";
        const list =
          now.choices.length === 0
            ? now.beat
              ? " There are no choices yet; a beat is waiting, so advance() first."
              : " There are no choices."
            : ` The choices are: ${now.choices.map((c) => JSON.stringify(labelOf(c))).join(", ")}.`;
        throw new Error(`There's no choice "${label}" in ${where}.${why}${list}`);
      }
      story.follow(choice);
      moved();
      return game;
    },
    advance() {
      if (!page().beat) {
        throw new Error(
          `There's no beat waiting in passage ${JSON.stringify(game.passage)}; choose one of its choices instead.`,
        );
      }
      story.advance();
      moved();
      return game;
    },
    skip() {
      while (page().beat) {
        story.advance();
        moved();
      }
      return game;
    },
    undo() {
      if (!history.canUndo) throw new Error("There's nothing to undo.");
      history.undo();
      return game;
    },
    replay: () => story.toReplay(),
    story,
    store,
    record,
    history,
  };
  return game;
}
