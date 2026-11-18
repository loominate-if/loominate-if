/**
 * Saving: save files, named slots, autosave, export and import (#22, ADR 0010).
 *
 * A save is the state store's snapshot plus who made it: the game and its
 * version, and the engine version. The snapshot already holds the event record,
 * the action log, and the seed, so a loaded save carries on exactly. Undo
 * history isn't saved; loading starts it afresh.
 *
 * Core touches no browser storage. Slots live in a {@link SaveStorage} the host
 * provides; {@link createMemoryStorage} is the in-memory one.
 */
import type { PassageId } from "../passages/story.js";
import { createStore, type StateSnapshot, type StateStore } from "../state/store.js";
import { StateError } from "../state/value.js";
import { hook } from "../rules/hooks.js";

/** This engine's version: `@loominate-if/core`'s package version. Saves record it. */
export const ENGINE_VERSION = "0.0.0";
/** The `format` field of every save file. */
export const SAVE_FORMAT = "loominate-save";
/** The save file version this engine reads and writes. */
export const SAVE_VERSION = 1;
/** The slot {@link Saves.autosave} writes. Named saves can't use it. */
export const AUTOSAVE_SLOT = "autosave";

/** Which game a save belongs to. */
export type GameInfo = {
  /** The game's stable ID. A save only loads into the game with the same ID. */
  readonly id: string;
  /** The game's version, for example `1.2.0`. Saves from another version still load, and say so. */
  readonly version: string;
};

/** A save file: a state snapshot, and what made it. */
export type SaveFile = {
  /** Always {@link SAVE_FORMAT}, so a save can't be mistaken for another JSON file. */
  readonly format: typeof SAVE_FORMAT;
  /** The file's version, {@link SAVE_VERSION}. */
  readonly version: typeof SAVE_VERSION;
  /** The game that made the save. */
  readonly game: GameInfo;
  /** The {@link ENGINE_VERSION} that made the save. */
  readonly engine: string;
  /** When the save was made, as an ISO 8601 timestamp. Metadata only; the game never reads it. */
  readonly savedAt: string;
  /** The player's name for the save, when they gave one. */
  readonly label?: string;
  /** The whole state store. */
  readonly state: StateSnapshot;
};

/** A save without its state: what a save menu shows. */
export type SaveSummary = Omit<SaveFile, "state"> & {
  /** The slot it's in. */
  readonly slot: string;
  /** The passage the story was at, if it had begun. */
  readonly passage?: PassageId;
  /** Whether it was made by the same version of the game as the one running. */
  readonly sameGameVersion: boolean;
};

/** A slot whose contents can't be loaded, with the reason. */
export type UnreadableSave = {
  /** The slot. */
  readonly slot: string;
  /** What's wrong, as {@link readSave} explains it. */
  readonly problem: string;
};

/** A save read back from a slot or an imported file, ready to load. */
export type LoadedSave = {
  /** What the save is. */
  readonly summary: SaveSummary;
  /**
   * The state to load: pass it to `createStore`, then create the story over that
   * store and start a fresh undo history.
   */
  readonly state: StateSnapshot;
};

/**
 * Where save slots are kept, supplied by the host: browser storage, files, or
 * memory. Keys are slot names and values are save file text. Methods may be
 * asynchronous, since most real storage is.
 */
export interface SaveStorage {
  /** The text in a slot, or `undefined` if it's empty. */
  get(slot: string): Promise<string | undefined> | string | undefined;
  /** Writes a slot, replacing what was there. */
  set(slot: string, text: string): Promise<void> | void;
  /** Empties a slot. */
  delete(slot: string): Promise<void> | void;
  /** Every slot that holds something, in any order. */
  slots(): Promise<readonly string[]> | readonly string[];
}

/** Options for {@link createSaves}. */
export interface SavesOptions {
  /** Where slots are kept. */
  readonly storage: SaveStorage;
  /** The running game. */
  readonly game: GameInfo;
  /** The wall clock, for {@link SaveFile.savedAt}. Defaults to the system clock; tests pass a fixed one. */
  readonly now?: () => Date;
}

/** Saving and loading slots for one game. */
export interface Saves {
  /**
   * Saves `store` to a named slot, replacing what was there.
   * @throws {@link StateError} if `slot` is empty or is {@link AUTOSAVE_SLOT}.
   */
  save(
    slot: string,
    store: StateStore,
    options?: { readonly label?: string },
  ): Promise<SaveSummary>;
  /** Saves `store` to {@link AUTOSAVE_SLOT}. The player shell calls this after each action; core does no timing. */
  autosave(store: StateStore): Promise<SaveSummary>;
  /**
   * Reads a slot, or returns `undefined` if it's empty.
   * @throws {@link StateError} if the slot holds something that can't be loaded into this game.
   */
  load(slot: string): Promise<LoadedSave | undefined>;
  /** Every slot, most recent save first, with slots that can't be loaded listed last, with the reason. */
  list(): Promise<readonly (SaveSummary | UnreadableSave)[]>;
  /** Empties a slot. Returns false if it was already empty. */
  delete(slot: string): Promise<boolean>;
  /** A slot's save file text, to download or send, or `undefined` if it's empty. */
  export(slot: string): Promise<string | undefined>;
  /**
   * Checks a save file and writes it to a slot.
   * @throws {@link StateError} if it can't be loaded into this game, or `slot` is invalid.
   */
  import(slot: string, text: string): Promise<SaveSummary>;
}

/** Slot storage in memory, for tests and hosts with nowhere else to keep saves. */
export function createMemoryStorage(): SaveStorage {
  const slots = new Map<string, string>();
  return {
    get: (slot) => slots.get(slot),
    set: (slot, text) => {
      slots.set(slot, text);
    },
    delete: (slot) => {
      slots.delete(slot);
    },
    slots: () => [...slots.keys()],
  };
}

/**
 * Creates save and load for one game over a slot storage.
 * @throws {@link StateError} if the game's ID or version is empty.
 */
export function createSaves(options: SavesOptions): Saves {
  const { storage, game } = options;
  checkGame(game, "createSaves");
  // Wall-clock time is allowed for save metadata (design principle 4); the game never reads it.
  // eslint-disable-next-line no-restricted-syntax -- save metadata, not game logic
  const now = options.now ?? (() => new Date());

  const write = async (slot: string, store: StateStore, label?: string) => {
    const file = createSave(store, {
      game,
      savedAt: now(),
      ...(label !== undefined && { label }),
    });
    await storage.set(slot, writeSave(file));
    const summary = summarize(slot, file, game);
    hook("save").run({ slot, summary });
    return summary;
  };

  const read = async (slot: string): Promise<LoadedSave | undefined> => {
    const text = await storage.get(slot);
    if (text === undefined) return undefined;
    return loadable(slot, text, game);
  };

  return {
    async save(slot, store, saveOptions = {}) {
      checkSlot(slot);
      if (slot === AUTOSAVE_SLOT) {
        throw new StateError(
          `save: the slot "${AUTOSAVE_SLOT}" is for autosave(); give the save another name.`,
        );
      }
      return write(slot, store, saveOptions.label);
    },
    autosave: (store) => write(AUTOSAVE_SLOT, store),
    async load(slot) {
      const save = await read(slot);
      if (save) hook("load").run({ slot, summary: save.summary });
      return save;
    },
    async list() {
      const loaded: SaveSummary[] = [];
      const unreadable: UnreadableSave[] = [];
      for (const slot of [...(await storage.slots())].sort()) {
        try {
          const save = await read(slot);
          if (save) loaded.push(save.summary);
        } catch (error) {
          unreadable.push({
            slot,
            problem: error instanceof Error ? error.message : String(error),
          });
        }
      }
      // Newest first; ties by slot name, so the order never depends on the storage.
      loaded.sort((a, b) =>
        a.savedAt === b.savedAt ? (a.slot < b.slot ? -1 : 1) : a.savedAt < b.savedAt ? 1 : -1,
      );
      return [...loaded, ...unreadable];
    },
    async delete(slot) {
      if ((await storage.get(slot)) === undefined) return false;
      await storage.delete(slot);
      return true;
    },
    export: async (slot) => storage.get(slot),
    async import(slot, text) {
      checkSlot(slot);
      const { summary } = loadable(slot, text, game);
      await storage.set(slot, text);
      return summary;
    },
  };
}

/**
 * Makes a save file from a store's current state.
 * @throws {@link StateError} if the game's ID or version is empty, or `savedAt` isn't a valid date.
 */
export function createSave(
  store: StateStore,
  options: { readonly game: GameInfo; readonly savedAt: Date; readonly label?: string },
): SaveFile {
  checkGame(options.game, "createSave");
  if (Number.isNaN(options.savedAt.getTime())) {
    throw new StateError("createSave: savedAt isn't a valid date.");
  }
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    game: { id: options.game.id, version: options.game.version },
    engine: ENGINE_VERSION,
    savedAt: options.savedAt.toISOString(),
    ...(options.label !== undefined && { label: options.label }),
    state: store.snapshot(),
  };
}

/** Writes a save file as JSON, with fields in a fixed order. */
export function writeSave(file: SaveFile): string {
  const ordered: SaveFile = {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    game: { id: file.game.id, version: file.game.version },
    engine: file.engine,
    savedAt: file.savedAt,
    ...(file.label !== undefined && { label: file.label }),
    state: file.state,
  };
  return `${JSON.stringify(ordered)}\n`;
}

/**
 * Reads a save file written by {@link writeSave}, checking its shape and its
 * state. It doesn't check which game made it; {@link Saves} does.
 * @throws {@link StateError} if `text` isn't a save file this engine can read, saying what's wrong.
 */
export function readSave(text: string): SaveFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new StateError(`save: the file isn't valid JSON (${reason}).`, { cause: error });
  }
  if (!isRecord(data) || data.format !== SAVE_FORMAT) {
    throw new StateError(`save: this isn't a save file; it needs "format": "${SAVE_FORMAT}".`);
  }
  if (data.version !== SAVE_VERSION) {
    throw new StateError(
      typeof data.version === "number" && data.version > SAVE_VERSION
        ? `save: the file is version ${String(data.version)}, made by a newer engine; this one reads version ${String(SAVE_VERSION)}.`
        : `save: "version" must be ${String(SAVE_VERSION)}.`,
    );
  }
  onlyFields(
    data,
    ["format", "version", "game", "engine", "savedAt", "label", "state"],
    "the file",
  );
  const game = data.game;
  if (!isRecord(game) || !isText(game.id) || !isText(game.version)) {
    throw new StateError(`save: "game" needs a non-empty "id" and "version".`);
  }
  onlyFields(game, ["id", "version"], `"game"`);
  if (!isText(data.engine)) throw new StateError(`save: "engine" must be a version string.`);
  if (typeof data.savedAt !== "string" || Number.isNaN(Date.parse(data.savedAt))) {
    throw new StateError(`save: "savedAt" must be an ISO 8601 timestamp.`);
  }
  if (data.label !== undefined && typeof data.label !== "string") {
    throw new StateError(`save: "label" must be a string.`);
  }
  if (!isRecord(data.state)) throw new StateError(`save: "state" must be an object of entities.`);
  // The store checks every ID and value, as it does for any snapshot.
  const state = createStore(data.state as StateSnapshot).snapshot();
  const label = data.label;
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    game: { id: game.id, version: game.version },
    engine: data.engine,
    savedAt: data.savedAt,
    ...(label !== undefined && { label }),
    state,
  };
}

/** Reads a save and checks it belongs to `game`. */
function loadable(slot: string, text: string, game: GameInfo): LoadedSave {
  const file = readSave(text);
  if (file.game.id !== game.id) {
    throw new StateError(
      `save: this save is from the game ${JSON.stringify(file.game.id)}, not ${JSON.stringify(game.id)}.`,
    );
  }
  return { summary: summarize(slot, file, game), state: file.state };
}

function summarize(slot: string, file: SaveFile, game: GameInfo): SaveSummary {
  const { state, ...rest } = file;
  // The story keeps its current passage at `$story.current` (see story.ts).
  const passage = state.$story?.current;
  return {
    ...rest,
    slot,
    ...(typeof passage === "string" && { passage }),
    sameGameVersion: file.game.version === game.version,
  };
}

function checkGame(game: GameInfo, where: string): void {
  if (!isText(game.id) || !isText(game.version)) {
    throw new StateError(`${where}: the game needs a non-empty id and version.`);
  }
}

function checkSlot(slot: string): void {
  if (!isText(slot)) throw new StateError("save: a slot name must be non-empty.");
}

function onlyFields(value: Record<string, unknown>, allowed: readonly string[], where: string) {
  const extra = Object.keys(value).find((k) => !allowed.includes(k));
  if (extra !== undefined) {
    throw new StateError(
      `save: ${where} has an unknown field ${JSON.stringify(extra)}; expected ${allowed.map((k) => JSON.stringify(k)).join(", ")}.`,
    );
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isText = (v: unknown): v is string => typeof v === "string" && v.length > 0;
