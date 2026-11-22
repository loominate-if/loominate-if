/**
 * The player shell (#230): one call that plays a game in the browser. It
 * creates the store, story, undo history, and page; keeps saves in the
 * browser; autosaves after each move; offers Continue when the player comes
 * back; and puts Undo, Save, Load, and Restart in a `game-menu` widget.
 */
import {
  AUTOSAVE_SLOT,
  createEventRecord,
  createHistory,
  createPersistent,
  createMemoryStorage,
  createSaves,
  createStore,
  createStory,
  type GameInfo,
  type BeatNode,
  type Choice,
  type History,
  type HistoryStep,
  type LoadedSave,
  type Passage,
  type PassageId,
  type Replay,
  type ReplayCheck,
  type SaveStorage,
  type StateSnapshot,
  type StateStore,
  type Story,
  type StoryAction,
  type StoryOptions,
  ENGINE_VERSION,
} from "@loominate-if/core";
import { message } from "@loominate-if/core";
import "../messages.js";
import { layouts, widget, widgets, type WidgetDefinition } from "../page/layout.js";
import { mountPage, type Page, type PageOptions } from "../page/page.js";
import { addStyles } from "../page/theme.js";
import { createSaveMenu } from "./menu.js";
import { createBrowserStorage } from "./storage.js";

const SOURCE = "@loominate-if/presentation";

/** Options for {@link playGame}. */
export type PlayOptions = {
  /** The game's passages, as the compiler builds them. */
  readonly passages: readonly Passage[];
  /** The passage a new game starts in. */
  readonly start: PassageId;
  /** The game's stable ID and version, which saves record. */
  readonly game: GameInfo;
  /** The game's name, on the start screen. Defaults to the game's ID. */
  readonly title?: string;
  /**
   * Where save slots are kept. Defaults to the browser's IndexedDB, or to
   * memory, for this visit only, where the browser has none.
   */
  readonly storage?: SaveStorage;
  /**
   * Makes the master seed for a new game. Defaults to a fresh random seed
   * each game; pass a fixed one for a seed-of-the-day or for tests.
   */
  readonly seed?: () => string;
  /** Story options other than the start passage and seed, such as `guardMode`. */
  readonly story?: Omit<StoryOptions, "start" | "seed">;
  /** Page options. `onMove` is called after the shell's own checkpoint and autosave. */
  readonly page?: PageOptions;
  /** Called when an autosave fails, for example because storage is full. Defaults to `console.error`. */
  readonly onError?: (error: unknown) => void;
};

/** A game being played by {@link playGame}. */
export interface Player {
  /** The story in play, once a game has started. */
  readonly story: Story | undefined;
  /** The page in play, once a game has started. */
  readonly page: Page | undefined;
  /** The state store of the game in play, once a game has started. */
  readonly store: StateStore | undefined;
  /**
   * Calls `listener` whenever the game in play changes: when a game starts or
   * loads, after each move, and after an undo or a {@link Player.travel}. Tools
   * such as the inspector use it to keep up with the game.
   * @returns A function that stops calling the listener.
   */
  onChange(listener: () => void): () => void;
  /**
   * The moves of the game in play that can be undone and redone, once a game
   * has started. Each step is labeled with its move, such as a link's label.
   */
  readonly history: PlayHistory | undefined;
  /**
   * Moves through the undo history: back that many moves when `steps` is
   * negative, forward again when it's positive. Moving forward is only
   * possible after moving back, until the next move discards the steps ahead.
   * The page, autosave, and {@link Player.onChange} listeners see one change.
   * @throws RangeError if `steps` isn't a whole number, or goes past either end of the history.
   */
  travel(steps: number): void;
  /**
   * Starts a new game from a replay file's seed and persistent data, and takes
   * its actions in order, each one an undo step, so {@link Player.travel} can
   * step through them. If an action can't be taken, for example because the
   * game changed since the replay was made, the game stays after the last one
   * that could, and the result says which failed and why. The player's own
   * persistent data is never read or changed by the replay.
   * @throws Error if the replay is from another game.
   */
  playReplay(replay: Replay): PlayedReplay;
  /** The game in play as a replay: its seed and every action taken so far. `undefined` before a game starts. */
  toReplay(): Replay | undefined;
  /** Starts a new game, replacing the one in play. */
  newGame(): Promise<void>;
  /** Loads a save slot, replacing the game in play. */
  load(slot: string): Promise<void>;
  /** Removes the game from the page. */
  destroy(): void;
}

/** The undo history of a game being played, as {@link Player.history} shows it. */
export interface PlayHistory {
  /** The moves that can be undone, oldest first. */
  readonly past: readonly HistoryStep[];
  /** The moves undone that can be made again, next first. */
  readonly future: readonly HistoryStep[];
}

/** What {@link Player.playReplay} did with a replay. */
export interface PlayedReplay {
  /** How many of the replay's actions were taken. */
  readonly played: number;
  /** Whether the replay came from the same game and engine versions. */
  readonly check: ReplayCheck;
  /** The first action that couldn't be taken, if one couldn't. */
  readonly failed?: {
    /** Its position in the replay, from 0. */
    readonly index: number;
    /** The action. */
    readonly action: StoryAction;
    /** Why it couldn't be taken. */
    readonly message: string;
  };
}

/** How a replayed action is labeled in the undo history, as the move would be when played. */
function actionLabel(action: StoryAction, story: Story): string {
  if (action.type === "goTo") return message("history.goTo", { passage: action.passage });
  if (action.type === "follow") return action.choice.label ?? message("page.continue");
  const beat = story.render().beat;
  return beat ? moveLabel(beat) : message("page.continue");
}

/** How a move is labeled in the undo history. */
function moveLabel(move: Choice | BeatNode): string {
  if (move.type === "link") return move.label;
  if (move.type === "continue") return move.label ?? message("page.continue");
  if (move.page) return message("history.nextPage");
  return move.duration === undefined ? message("page.continue") : message("history.afterBeat");
}

/** The data the game menu shows. */
type MenuData = { readonly canUndo: boolean };

/** What the game menu can do, supplied by the shell. */
type MenuActions = {
  readonly canUndo: () => boolean;
  readonly undo: () => void;
  readonly open: (focus: "save" | "load") => void;
  readonly restart: () => void;
};

/** The game menu widget: Undo, Save, Load, and Restart buttons. */
function gameMenu(actions: MenuActions): WidgetDefinition<MenuData> {
  return widget({
    data: () => ({ canUndo: actions.canUndo() }),
    view: {
      mount(element, data) {
        const doc = element.ownerDocument;
        const bar = doc.createElement("div");
        bar.className = "loominate-game-menu";
        const make = (text: string, onClick: () => void) => {
          const b = doc.createElement("button");
          b.type = "button";
          b.textContent = text;
          b.addEventListener("click", onClick);
          bar.append(b);
          return b;
        };
        let canUndo = data.canUndo;
        const undo = make(message("menu.undo"), () => {
          if (canUndo) actions.undo();
        });
        make(message("menu.save"), () => {
          actions.open("save");
        });
        make(message("menu.load"), () => {
          actions.open("load");
        });
        // Restart abandons the game in play, so it asks once more on the same
        // button, as the save menu's Delete does; leaving the button cancels.
        let confirming = false;
        const restart = make(message("menu.restart"), () => {
          if (!confirming) {
            confirming = true;
            restart.textContent = message("menu.confirmRestart");
            restart.setAttribute("aria-label", message("menu.confirmRestartLabel"));
            return;
          }
          actions.restart();
        });
        restart.addEventListener("blur", () => {
          confirming = false;
          restart.textContent = message("menu.restart");
          restart.removeAttribute("aria-label");
        });
        element.append(bar);
        const show = (d: MenuData) => {
          canUndo = d.canUndo;
          // Still focusable when there's nothing to undo, so it's found and explained.
          undo.setAttribute("aria-disabled", String(!d.canUndo));
        };
        show(data);
        return {
          update: show,
          unmount: () => {
            bar.remove();
          },
        };
      },
    },
  });
}

/** A fresh master seed for a new game (ADR 0008: whatever starts a game supplies one). */
function freshSeed(): string {
  const words = new Uint32Array(2);
  // Choosing a new game's master seed is the one place randomness enters; it's stored with the game.
  // eslint-disable-next-line no-restricted-properties
  crypto.getRandomValues(words);
  return [...words].map((w) => w.toString(36)).join("-");
}

/**
 * Plays a game in `container`. A reload in the same tab carries on from the
 * autosave; a player who comes back after closing the tab is offered
 * Continue or New game. Then it shows the page, with Undo, Save, Load, and Restart in the `game-menu` widget,
 * which goes in the `page` layout's header unless the game has changed that
 * layout.
 *
 * @example
 * ```ts
 * import { playGame } from "@loominate-if/presentation";
 * import { passages } from "./game.weft";
 *
 * await playGame(document.querySelector("#app")!, {
 *   passages,
 *   start: "Start",
 *   game: { id: "lantern-road", version: "1.0.0" },
 * });
 * ```
 */
export async function playGame(container: HTMLElement, options: PlayOptions): Promise<Player> {
  const doc = container.ownerDocument;
  const onError =
    options.onError ??
    ((error: unknown) => {
      console.error(error);
    });
  let storage = options.storage;
  if (!storage) {
    try {
      storage = createBrowserStorage(options.game.id);
    } catch (error) {
      onError(error);
      storage = createMemoryStorage();
    }
  }
  const saves = createSaves({ storage, game: options.game });

  let store: StateStore | undefined;
  let story: Story | undefined;
  let history: History | undefined;
  let page: Page | undefined;
  let autosaving: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();
  /** Tells the listeners the game changed; one that throws doesn't stop the others, or the game. */
  const changed = (): void => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        onError(error);
      }
    }
  };

  const autosave = (): void => {
    const current = store;
    if (!current) return;
    autosaving = autosaving
      .then(() => saves.autosave(current))
      .catch((error: unknown) => {
        onError(error);
      });
  };

  // Before anything is drawn: the start screen and save menu come before any page does.
  if (options.page?.styles !== false) addStyles(doc);
  const host = doc.createElement("div");
  host.className = "loominate-player";
  container.append(host);

  const menu = createSaveMenu(host, saves, options.game.id, {
    save: async (slot, label) => {
      if (!store) throw new Error("There's no game to save yet.");
      await autosaving;
      return saves.save(slot, store, label === "" ? {} : { label });
    },
    load: async (slot) => {
      const loaded = await saves.load(slot);
      if (!loaded) throw new Error("That slot is empty.");
      start(loaded.state);
    },
  });

  const menuWidget = gameMenu({
    canUndo: () => history?.canUndo ?? false,
    undo: () => {
      if (!history?.canUndo) return;
      history.undo();
      page?.refresh();
      autosave();
      changed();
    },
    open: (focus) => {
      menu.open(focus).catch(onError);
    },
    restart: () => {
      autosaving
        .then(() => {
          start();
          host.querySelector<HTMLElement>(".loominate-passage")?.focus({ preventScroll: true });
        })
        .catch(onError);
    },
  });
  if (widgets.get("game-menu")) widgets.replace("game-menu", menuWidget, { source: SOURCE });
  else widgets.register("game-menu", menuWidget, { source: SOURCE });
  // The menu goes in the default page's header, unless the game has made the page its own.
  const pageLayout = layouts.entries().find((e) => e.key === "page");
  if (pageLayout?.source === SOURCE && !pageLayout.value.widgets) {
    layouts.replace(
      "page",
      { ...pageLayout.value, widgets: { header: ["game-menu"] } },
      { source: SOURCE },
    );
  }

  // Session storage lasts as long as the tab, through reloads, so it tells a
  // reload from a return. It can be missing or refuse writes; then every visit is a return.
  const sessionKey = `loominate:playing:${options.game.id}`;
  const playingInThisTab = (): boolean => {
    try {
      return doc.defaultView?.sessionStorage.getItem(sessionKey) === "1";
    } catch {
      return false;
    }
  };
  const markPlaying = (): void => {
    try {
      doc.defaultView?.sessionStorage.setItem(sessionKey, "1");
    } catch {
      // Without session storage, a reload offers Continue, which is still safe.
    }
  };

  /** Starts a game: a loaded one from its state, a new one, or a new one from a replay. */
  const start = (snapshot?: StateSnapshot, replay?: Replay): PlayedReplay | undefined => {
    markPlaying();
    page?.destroy();
    host.querySelector(".loominate-start")?.remove();
    store = createStore(snapshot);
    const record = createEventRecord(store);
    story = createStory(store, record, options.passages, {
      ...options.story,
      start: options.start,
      ...(snapshot === undefined && { seed: replay?.seed ?? (options.seed ?? freshSeed)() }),
      // A replay plays against the persistent data it began with, in memory.
      ...(replay && { persistent: createPersistent(replay.persistent ?? {}) }),
    });
    const playing = store;
    history = createHistory(playing);
    const undoable = history;
    page = mountPage(
      host,
      { story, record },
      {
        ...options.page,
        onMove: (move) => {
          undoable.checkpoint(moveLabel(move));
          autosave();
          options.page?.onMove?.(move);
          changed();
        },
      },
    );
    // What came before the first move, the start passage's effects, isn't undoable.
    undoable.clear();
    playing.commit();
    let played: PlayedReplay | undefined;
    if (replay) {
      const check: ReplayCheck = {
        ...(replay.game && { sameGameVersion: replay.game.version === options.game.version }),
        ...(replay.engine !== undefined && { sameEngineVersion: replay.engine === ENGINE_VERSION }),
      };
      let count = 0;
      let failed: PlayedReplay["failed"];
      for (const action of replay.actions) {
        let label: string;
        try {
          // Labeled before it's taken, while the beat it moves past is still ahead.
          label = actionLabel(action, story);
          story.perform(action);
        } catch (error) {
          // A failed action rolls itself back; anything it left uncommitted goes too.
          playing.rollback();
          failed = {
            index: count,
            action,
            message: error instanceof Error ? error.message : String(error),
          };
          break;
        }
        undoable.checkpoint(label);
        count++;
      }
      played = { played: count, check, ...(failed && { failed }) };
    }
    page.refresh();
    autosave();
    changed();
    return played;
  };

  /**
   * Resumes a saved game. When the game has changed so the save no longer
   * fits it, for example a passage it was at was renamed, the start screen
   * says so instead, and the save is kept until the player starts a new game.
   */
  const resume = (autosaved: LoadedSave): void => {
    try {
      start(autosaved.state);
    } catch (error) {
      onError(error);
      page = undefined;
      for (const half of host.querySelectorAll(".loominate-page:not([data-screen])")) half.remove();
      offer(autosaved, error instanceof Error ? error.message : String(error));
    }
  };

  /**
   * The start screen for a returning player: Continue or New game. It's drawn
   * as a page, with the game's own styles, so the first thing the player sees
   * looks like the game: the title as a heading, then choices like a passage's.
   */
  const offer = (autosaved: LoadedSave, problem?: string): void => {
    const el = <K extends keyof HTMLElementTagNameMap>(
      tag: K,
      className?: string,
      text?: string,
    ): HTMLElementTagNameMap[K] => {
      const node = doc.createElement(tag);
      if (className !== undefined) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const screen = el("div", "loominate-page loominate-start");
    screen.dataset.screen = "start";
    const main = el("main", "loominate-main");
    const passage = el("div", "loominate-passage");
    const heading = el("h1", undefined, options.title ?? options.game.id);
    heading.id = "loominate-start-title";
    main.setAttribute("aria-labelledby", heading.id);
    const where = autosaved.summary.passage;
    passage.append(
      heading,
      el(
        "p",
        undefined,
        problem !== undefined
          ? message("start.cannotContinue")
          : where === undefined
            ? message("start.inProgress")
            : message("start.inProgressAt", { where }),
      ),
    );
    if (problem !== undefined) passage.append(el("p", "loominate-note", problem));
    if (!autosaved.summary.sameGameVersion) {
      passage.append(
        el(
          "p",
          "loominate-note",
          message("start.savedByVersion", { version: autosaved.summary.game.version }),
        ),
      );
    }
    const choice = (text: string, className: string, onClick: () => void) => {
      const b = el("button", className, text);
      b.type = "button";
      b.addEventListener("click", onClick);
      const p = el("p", "loominate-choice");
      p.append(b);
      passage.append(p);
      return b;
    };
    const first =
      problem === undefined
        ? choice(message("start.continue"), "loominate-continue", () => {
            host.querySelector(".loominate-start")?.remove();
            resume(autosaved);
          })
        : undefined;
    const fresh = choice(message("start.newGame"), "loominate-link", () => {
      start();
    });
    main.append(passage);
    screen.append(main);
    host.prepend(screen);
    (first ?? fresh).focus();
  };

  let autosaved: LoadedSave | undefined;
  try {
    autosaved = await saves.load(AUTOSAVE_SLOT);
  } catch (error) {
    // An autosave that can't be loaded mustn't stop the game; it's listed in the save menu.
    onError(error);
  }
  // A reload, or back and forward, in the same tab carries straight on; a
  // player who closed the tab and came back chooses.
  if (autosaved && playingInThisTab()) resume(autosaved);
  else if (autosaved) offer(autosaved);
  else start();

  return {
    get story() {
      return story;
    },
    get page() {
      return page;
    },
    get store() {
      return store;
    },
    get history() {
      return history && { past: history.past, future: history.future };
    },
    travel(steps) {
      const moving = history;
      const past = moving?.past.length ?? 0;
      const future = moving?.future.length ?? 0;
      if (!Number.isInteger(steps) || steps < -past || steps > future) {
        throw new RangeError(
          `travel: can go back ${String(past)} and forward ${String(future)} moves, not ${String(steps)}.`,
        );
      }
      if (!moving || steps === 0) return;
      for (let i = 0; i < Math.abs(steps); i++) {
        if (steps < 0) moving.undo();
        else moving.redo();
      }
      page?.refresh();
      autosave();
      changed();
    },
    playReplay(replay) {
      if (replay.game && replay.game.id !== options.game.id) {
        throw new Error(
          `This replay is from the game "${replay.game.id}", not "${options.game.id}".`,
        );
      }
      return start(undefined, replay) as PlayedReplay;
    },
    toReplay() {
      return story?.current === undefined ? undefined : story.toReplay(options.game);
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    newGame: async () => {
      await autosaving;
      start();
    },
    load: async (slot) => {
      const loaded = await saves.load(slot);
      if (!loaded) throw new Error(`The save slot "${slot}" is empty.`);
      start(loaded.state);
    },
    destroy() {
      listeners.clear();
      page?.destroy();
      host.remove();
    },
  };
}
