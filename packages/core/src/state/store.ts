/**
 * The state store: the one place mutable game state lives.
 *
 * State is a set of entities, each keyed by a stable ID and holding named fields.
 * Every write is recorded as a change; {@link StateStore.commit} hands the
 * accumulated changes back as a {@link StateDiff} for undo, save, and replay.
 */
import { freezeValue, StateError, valuesEqual, type StateValue } from "./value.js";

/**
 * A stable, author-visible ID for something in the state store, such as a passage,
 * an object, or a runtime instance (`gen:crypt-3:room-7`).
 */
export type StateId = string;

/**
 * One field's change. `from` is absent when the field didn't exist before, and
 * `to` is absent when the change deleted it.
 */
export interface StateChange {
  /** The entity that changed. */
  readonly id: StateId;
  /** The field that changed. */
  readonly key: string;
  /** The value before the change; absent if the field didn't exist. */
  readonly from?: StateValue;
  /** The value after the change; absent if the field was deleted. */
  readonly to?: StateValue;
}

/**
 * The changes between two commits, at most one per field, ordered by entity ID
 * and then field name. Plain JSON data, so it can be saved or sent as-is.
 */
export type StateDiff = readonly StateChange[];

/** The full contents of a store, as plain JSON data: entity ID → field → value. */
export type StateSnapshot = { readonly [id: StateId]: { readonly [key: string]: StateValue } };

/** The single serializable store holding all mutable game state. */
export interface StateStore {
  /** Returns a field's value, or `undefined` if it isn't set. The value is frozen. */
  get(id: StateId, key: string): StateValue | undefined;
  /** Whether the field is set. */
  has(id: StateId, key: string): boolean;
  /** Returns all of an entity's fields as a frozen object, or `undefined` if it has none. */
  entity(id: StateId): { readonly [key: string]: StateValue } | undefined;
  /** IDs of every entity with at least one field, in sorted order. */
  ids(): StateId[];
  /**
   * Sets a field. The value is validated and copied, so later changes to the
   * object you passed in don't affect the store.
   * @throws {@link StateError} if `value` isn't a {@link StateValue}.
   */
  set(id: StateId, key: string, value: StateValue): void;
  /** Deletes a field. An entity with no fields left disappears from the store. */
  delete(id: StateId, key: string): void;
  /** Whether there are changes since the last commit. */
  readonly dirty: boolean;
  /**
   * Returns the changes since the last commit and starts a new one. A field
   * changed several times appears once, from its first value to its last; a field
   * set back to where it started doesn't appear at all.
   */
  commit(): StateDiff;
  /** Reverts every change since the last commit, for example when an effect phase fails. */
  rollback(): void;
  /**
   * Applies a diff, for example to redo or replay. Apply {@link invertDiff} of a
   * diff to undo it. Applied changes aren't recorded for the next commit.
   * @throws {@link StateError} if there are uncommitted changes, or if the store
   * doesn't match the diff's `from` values. The store is unchanged when it throws.
   */
  apply(diff: StateDiff): void;
  /** Returns the store's current contents, with entities and fields in sorted order. */
  snapshot(): StateSnapshot;
}

/** Sorts by UTF-16 code unit, so order never depends on locale. */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function checkName(kind: "ID" | "field name", name: unknown, where: string): void {
  if (typeof name !== "string" || name.length === 0) {
    throw new StateError(`${where}: the ${kind} must be a non-empty string.`);
  }
}

function label(id: StateId, key: string): string {
  return `state ${JSON.stringify(id)}.${key}`;
}

/**
 * Creates a state store, optionally loaded from a snapshot.
 * @throws {@link StateError} if the snapshot contains anything that isn't a {@link StateValue}.
 */
export function createStore(snapshot: StateSnapshot = {}): StateStore {
  const entities = new Map<StateId, Map<string, StateValue>>();
  /**
   * Each field changed since the last commit, with its value before the first
   * change (`undefined` if it didn't exist).
   */
  let pending = new Map<StateId, Map<string, StateValue | undefined>>();

  const read = (id: StateId, key: string): StateValue | undefined => entities.get(id)?.get(key);

  const write = (id: StateId, key: string, value: StateValue | undefined): void => {
    if (value === undefined) {
      const fields = entities.get(id);
      fields?.delete(key);
      if (fields?.size === 0) entities.delete(id);
      return;
    }
    let fields = entities.get(id);
    if (!fields) entities.set(id, (fields = new Map()));
    fields.set(key, value);
  };

  const record = (id: StateId, key: string): void => {
    let fields = pending.get(id);
    if (!fields) pending.set(id, (fields = new Map()));
    if (!fields.has(key)) fields.set(key, read(id, key));
  };

  const isDirty = (): boolean => {
    for (const [id, fields] of pending) {
      for (const [key, original] of fields) {
        if (!valuesEqual(original, read(id, key))) return true;
      }
    }
    return false;
  };

  const entityOf = (id: StateId): { readonly [key: string]: StateValue } | undefined => {
    const fields = entities.get(id);
    if (!fields) return undefined;
    return Object.freeze(Object.fromEntries([...fields].sort(([a], [b]) => byCodeUnit(a, b))));
  };

  for (const id of Object.keys(snapshot)) {
    checkName("ID", id, "snapshot");
    const fields = snapshot[id];
    if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
      throw new StateError(`snapshot ${JSON.stringify(id)}: expected an object of fields.`);
    }
    for (const key of Object.keys(fields)) {
      checkName("field name", key, `snapshot ${JSON.stringify(id)}`);
      write(id, key, freezeValue(fields[key], label(id, key)));
    }
  }

  return {
    get: read,
    has: (id, key) => entities.get(id)?.has(key) ?? false,
    entity: entityOf,
    ids: () => [...entities.keys()].sort(byCodeUnit),
    set(id, key, value) {
      checkName("ID", id, "set");
      checkName("field name", key, `set ${JSON.stringify(id)}`);
      const frozen = freezeValue(value, label(id, key));
      record(id, key);
      write(id, key, frozen);
    },
    delete(id, key) {
      if (!entities.get(id)?.has(key)) return;
      record(id, key);
      write(id, key, undefined);
    },
    get dirty() {
      return isDirty();
    },
    commit() {
      const diff: StateChange[] = [];
      for (const id of [...pending.keys()].sort(byCodeUnit)) {
        const fields = pending.get(id);
        if (!fields) continue;
        for (const key of [...fields.keys()].sort(byCodeUnit)) {
          const from = fields.get(key);
          const to = read(id, key);
          if (valuesEqual(from, to)) continue;
          diff.push(
            Object.freeze({
              id,
              key,
              ...(from !== undefined && { from }),
              ...(to !== undefined && { to }),
            }),
          );
        }
      }
      pending = new Map();
      return Object.freeze(diff);
    },
    rollback() {
      for (const [id, fields] of pending) {
        for (const [key, original] of fields) write(id, key, original);
      }
      pending = new Map();
    },
    apply(diff) {
      if (isDirty()) {
        throw new StateError(
          "apply: there are uncommitted changes; commit or roll them back before applying a diff.",
        );
      }
      // Validate the whole diff against a staged view first, so a bad diff changes nothing.
      const staged = new Map<string, [StateId, string, StateValue | undefined]>();
      const current = (id: StateId, key: string): StateValue | undefined => {
        const slot = staged.get(JSON.stringify([id, key]));
        return slot ? slot[2] : read(id, key);
      };
      for (const change of diff) {
        checkName("ID", change.id, "apply");
        checkName("field name", change.key, `apply ${JSON.stringify(change.id)}`);
        const where = label(change.id, change.key);
        const from = "from" in change ? freezeValue(change.from, `${where} (from)`) : undefined;
        if (!valuesEqual(from, current(change.id, change.key))) {
          throw new StateError(
            `apply: ${where} doesn't match the diff, so the diff was made against a different state. Nothing was changed.`,
          );
        }
        const to = "to" in change ? freezeValue(change.to, `${where} (to)`) : undefined;
        staged.set(JSON.stringify([change.id, change.key]), [change.id, change.key, to]);
      }
      pending = new Map();
      for (const [id, key, value] of staged.values()) write(id, key, value);
    },
    snapshot() {
      return Object.freeze(
        Object.fromEntries(
          [...entities.keys()].sort(byCodeUnit).map((id) => [id, entityOf(id) ?? {}]),
        ),
      );
    },
  };
}

/** Returns the diff that undoes `diff`: each change reversed, in reverse order. */
export function invertDiff(diff: StateDiff): StateDiff {
  return Object.freeze(
    diff
      .map((c): StateChange =>
        Object.freeze({
          id: c.id,
          key: c.key,
          ...("to" in c && { from: c.to }),
          ...("from" in c && { to: c.from }),
        }),
      )
      .reverse(),
  );
}
