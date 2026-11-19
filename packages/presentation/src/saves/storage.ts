/**
 * Save slots in the browser (#230): a `SaveStorage` over IndexedDB, since
 * saves carry the event record and can outgrow localStorage. Every game on
 * an origin shares one database, with each slot keyed by game ID and slot
 * name, so games never see each other's saves.
 */
import type { SaveStorage } from "@loominate-if/core";

const DATABASE = "loominate-saves";
const SLOTS = "slots";

/** Options for {@link createBrowserStorage}. */
export type BrowserStorageOptions = {
  /** The IndexedDB to use. Defaults to the browser's own. */
  readonly indexedDB?: IDBFactory;
};

/**
 * Save slots for one game in the browser's IndexedDB, for `createSaves`.
 *
 * @throws Error if the browser has no IndexedDB, as in some private windows.
 */
export function createBrowserStorage(
  gameId: string,
  options: BrowserStorageOptions = {},
): SaveStorage {
  const factory = options.indexedDB ?? (globalThis.indexedDB as IDBFactory | undefined);
  if (!factory) {
    throw new Error(
      "This browser has no IndexedDB, so saves can't be kept between visits. Private windows sometimes turn it off.",
    );
  }
  let opened: Promise<IDBDatabase> | undefined;
  const database = (): Promise<IDBDatabase> =>
    (opened ??= new Promise((resolve, reject) => {
      const request = factory.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(SLOTS);
      };
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        opened = undefined;
        reject(request.error ?? new Error("The save database couldn't be opened."));
      };
    }));
  /** Runs one request in its own transaction, resolving once the transaction commits. */
  const run = async <T>(
    mode: IDBTransactionMode,
    make: (slots: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SLOTS, mode);
      const request = make(tx.objectStore(SLOTS));
      tx.oncomplete = () => {
        resolve(request.result);
      };
      const fail = () => {
        reject(tx.error ?? request.error ?? new Error("The save database refused the request."));
      };
      tx.onerror = fail;
      tx.onabort = fail;
    });
  };
  const key = (slot: string): IDBValidKey => [gameId, slot];
  return {
    async get(slot) {
      const value = await run("readonly", (s) => s.get(key(slot)) as IDBRequest<unknown>);
      return typeof value === "string" ? value : undefined;
    },
    async set(slot, text) {
      await run("readwrite", (s) => s.put(text, key(slot)));
    },
    async delete(slot) {
      await run("readwrite", (s) => s.delete(key(slot)));
    },
    async slots() {
      // Every key [gameId, slot]: arrays sort after strings, so [gameId, []] bounds them.
      const keys = await run("readonly", (s) =>
        s.getAllKeys(IDBKeyRange.bound([gameId], [gameId, []])),
      );
      return keys.map((k) => (k as [string, string])[1]);
    },
  };
}
