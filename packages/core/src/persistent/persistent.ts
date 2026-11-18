/**
 * The persistent cross-playthrough store (#23, ADR 0011): achievements,
 * unlocked endings, and settings.
 *
 * It's a second store, beside the game state: undo, restarting, and loading a
 * save never touch it, and it's kept apart from save slots. Authors reach it as
 * `context.persistent`, read-only while rendering. So that replays stay exact,
 * the story copies it into game state when it begins (ADR 0011); a replay plays
 * against that copy, never the player's real data.
 */
import type { GameInfo } from "../save/save.js";
import { createStore, type StateSnapshot, type StateStore } from "../state/store.js";
import { StateError } from "../state/value.js";

/** The `format` field of every persistent data file. */
export const PERSISTENT_FORMAT = "loominate-persistent";
/** The persistent data file version this engine reads and writes. */
export const PERSISTENT_VERSION = 1;

/**
 * Where persistent data is kept, supplied by the host: one file of text per
 * game, separate from save slots. Methods may be asynchronous.
 */
export interface PersistentStorage {
  /** The stored text, or `undefined` if nothing's been stored yet. */
  read(): Promise<string | undefined> | string | undefined;
  /** Replaces the stored text. */
  write(text: string): Promise<void> | void;
}

/**
 * Persistent data: the same reads and writes as game state, kept across
 * playthroughs. Writes are stored in the background; {@link PersistentStore.flush}
 * waits for them.
 */
export interface PersistentStore extends Pick<
  StateStore,
  "get" | "has" | "entity" | "ids" | "set" | "delete" | "snapshot"
> {
  /**
   * Waits until every write so far is in storage.
   * @throws the storage's error, if a write failed.
   */
  flush(): Promise<void>;
}

/** Each store's inner state store, so the story can roll back a failed move's writes. */
const inner = new WeakMap<PersistentStore, StateStore>();

/** @internal The state store behind a persistent store. */
export function persistentState(persistent: PersistentStore): StateStore {
  const store = inner.get(persistent);
  if (!store) {
    throw new StateError(
      "persistent: use a store from openPersistent() or createPersistent(), not a hand-made one.",
    );
  }
  return store;
}

/**
 * Persistent data in memory only, optionally starting from a snapshot. Stories
 * get one when the host gives none, and replays play against one.
 * @throws {@link StateError} if the snapshot contains anything that isn't a `StateValue`.
 */
export function createPersistent(snapshot: StateSnapshot = {}): PersistentStore {
  return wrap(createStore(snapshot), undefined);
}

/**
 * Opens a game's persistent data from storage, or starts it empty.
 * @throws {@link StateError} if the stored data can't be read or belongs to another game.
 */
export async function openPersistent(options: {
  readonly storage: PersistentStorage;
  readonly game: GameInfo;
}): Promise<PersistentStore> {
  const { storage, game } = options;
  const text = await storage.read();
  const state = text === undefined ? {} : readPersistent(text, game.id);
  return wrap(createStore(state), (snapshot) =>
    storage.write(writePersistent({ id: game.id, version: game.version }, snapshot)),
  );
}

function wrap(
  store: StateStore,
  save: ((snapshot: StateSnapshot) => Promise<void> | void) | undefined,
): PersistentStore {
  let pending: Promise<void> = Promise.resolve();
  let queued = false;
  let failure: { error: unknown } | undefined;

  // Writes made together are stored together: one write per turn, not per field.
  const schedule = () => {
    if (!save || queued) return;
    queued = true;
    pending = pending.then(async () => {
      queued = false;
      try {
        await save(store.snapshot());
      } catch (error) {
        failure = { error };
      }
    });
  };

  const persistent: PersistentStore = {
    get: (id, key) => store.get(id, key),
    has: (id, key) => store.has(id, key),
    entity: (id) => store.entity(id),
    ids: () => store.ids(),
    snapshot: () => store.snapshot(),
    set(id, key, value) {
      store.set(id, key, value);
      schedule();
    },
    delete(id, key) {
      store.delete(id, key);
      schedule();
    },
    async flush() {
      await pending;
      if (failure) {
        const { error } = failure;
        failure = undefined;
        throw error;
      }
    },
  };
  inner.set(persistent, store);
  return persistent;
}

/** Writes persistent data as JSON. */
export function writePersistent(game: GameInfo, state: StateSnapshot): string {
  return `${JSON.stringify({
    format: PERSISTENT_FORMAT,
    version: PERSISTENT_VERSION,
    game: { id: game.id, version: game.version },
    state,
  })}\n`;
}

/**
 * Reads persistent data written by {@link writePersistent} for the game `gameId`.
 * @throws {@link StateError} if `text` isn't persistent data this engine can read, or is another game's.
 */
export function readPersistent(text: string, gameId: string): StateSnapshot {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new StateError(`persistent data: the file isn't valid JSON (${reason}).`, {
      cause: error,
    });
  }
  if (!isRecord(data) || data.format !== PERSISTENT_FORMAT) {
    throw new StateError(
      `persistent data: this isn't a persistent data file; it needs "format": "${PERSISTENT_FORMAT}".`,
    );
  }
  if (data.version !== PERSISTENT_VERSION) {
    throw new StateError(
      typeof data.version === "number" && data.version > PERSISTENT_VERSION
        ? `persistent data: the file is version ${String(data.version)}, made by a newer engine; this one reads version ${String(PERSISTENT_VERSION)}.`
        : `persistent data: "version" must be ${String(PERSISTENT_VERSION)}.`,
    );
  }
  const extra = Object.keys(data).find((k) => !["format", "version", "game", "state"].includes(k));
  if (extra !== undefined) {
    throw new StateError(
      `persistent data: the file has an unknown field ${JSON.stringify(extra)}; expected "format", "version", "game", "state".`,
    );
  }
  const game = data.game;
  if (!isRecord(game) || typeof game.id !== "string" || typeof game.version !== "string") {
    throw new StateError(`persistent data: "game" needs an "id" and "version".`);
  }
  if (game.id !== gameId) {
    throw new StateError(
      `persistent data: this is the game ${JSON.stringify(game.id)}'s, not ${JSON.stringify(gameId)}'s.`,
    );
  }
  if (!isRecord(data.state)) {
    throw new StateError(`persistent data: "state" must be an object of entities.`);
  }
  // The store checks every ID and value, as it does for any snapshot.
  return createStore(data.state as StateSnapshot).snapshot();
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
