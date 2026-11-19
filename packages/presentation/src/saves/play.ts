/**
 * The player shell (#230): one call that plays a game in the browser. It
 * creates the store, story, undo history, and page; keeps saves in the
 * browser; autosaves after each move; offers Continue when the player comes
 * back; and puts Undo, Save, and Load in a `game-menu` widget.
 */
import {
  AUTOSAVE_SLOT,
  createEventRecord,
  createHistory,
  createMemoryStorage,
  createSaves,
  createStore,
  createStory,
  type GameInfo,
  type History,
  type LoadedSave,
  type Passage,
  type PassageId,
  type SaveStorage,
  type StateSnapshot,
  type StateStore,
  type Story,
  type StoryOptions,
} from "@loominate-if/core";
import { layouts, widget, widgets, type WidgetDefinition } from "../page/layout.js";
import { mountPage, type Page, type PageOptions } from "../page/page.js";
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
  /** Starts a new game, replacing the one in play. */
  newGame(): Promise<void>;
  /** Loads a save slot, replacing the game in play. */
  load(slot: string): Promise<void>;
  /** Removes the game from the page. */
  destroy(): void;
}

/** The data the game menu shows. */
type MenuData = { readonly canUndo: boolean };

/** What the game menu can do, supplied by the shell. */
type MenuActions = {
  readonly canUndo: () => boolean;
  readonly undo: () => void;
  readonly open: (focus: "save" | "load") => void;
};

/** The game menu widget: Undo, Save, and Load buttons. */
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
        const undo = make("Undo", () => {
          if (canUndo) actions.undo();
        });
        make("Save", () => {
          actions.open("save");
        });
        make("Load", () => {
          actions.open("load");
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
 * Plays a game in `container`: offers Continue when there's an autosave,
 * then shows the page, with Undo, Save, and Load in the `game-menu` widget,
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

  const autosave = (): void => {
    const current = store;
    if (!current) return;
    autosaving = autosaving
      .then(() => saves.autosave(current))
      .catch((error: unknown) => {
        onError(error);
      });
  };

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
    },
    open: (focus) => {
      menu.open(focus).catch(onError);
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

  /** Starts a game: a loaded one from its state, or a new one. */
  const start = (snapshot?: StateSnapshot): void => {
    page?.destroy();
    host.querySelector(".loominate-start")?.remove();
    store = createStore(snapshot);
    const record = createEventRecord(store);
    story = createStory(store, record, options.passages, {
      ...options.story,
      start: options.start,
      ...(snapshot === undefined && { seed: (options.seed ?? freshSeed)() }),
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
          undoable.checkpoint();
          autosave();
          options.page?.onMove?.(move);
        },
      },
    );
    // What came before the first move, the start passage's effects, isn't undoable.
    undoable.clear();
    playing.commit();
    page.refresh();
    autosave();
  };

  /** The start screen for a returning player: Continue or New game. */
  const offer = (autosaved: LoadedSave): void => {
    const screen = doc.createElement("section");
    screen.className = "loominate-start";
    const heading = doc.createElement("h1");
    heading.id = "loominate-start-title";
    heading.textContent = options.title ?? options.game.id;
    screen.setAttribute("aria-labelledby", heading.id);
    const where = doc.createElement("p");
    where.textContent =
      autosaved.summary.passage === undefined
        ? "You have a game in progress."
        : `You have a game in progress, at ${autosaved.summary.passage}.`;
    const choices = doc.createElement("p");
    const button = (text: string, onClick: () => void) => {
      const b = doc.createElement("button");
      b.type = "button";
      b.textContent = text;
      b.addEventListener("click", onClick);
      choices.append(b, " ");
      return b;
    };
    const resume = button("Continue", () => {
      start(autosaved.state);
    });
    button("New game", () => {
      start();
    });
    screen.append(heading, where, choices);
    if (!autosaved.summary.sameGameVersion) {
      const note = doc.createElement("p");
      note.textContent = `It was saved by version ${autosaved.summary.game.version} of the game.`;
      screen.insertBefore(note, choices);
    }
    host.prepend(screen);
    resume.focus();
  };

  let autosaved: LoadedSave | undefined;
  try {
    autosaved = await saves.load(AUTOSAVE_SLOT);
  } catch (error) {
    // An autosave that can't be loaded mustn't stop the game; it's listed in the save menu.
    onError(error);
  }
  if (autosaved) offer(autosaved);
  else start();

  return {
    get story() {
      return story;
    },
    get page() {
      return page;
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
      page?.destroy();
      host.remove();
    },
  };
}
