/**
 * Undo history over the state store.
 *
 * History stores diffs rather than snapshots, so a long session costs only what
 * actually changed. Each checkpoint (one per real event, such as an effect phase
 * or an action) becomes one undo step.
 */
import { invertDiff, type StateDiff, type StateStore } from "./store.js";
import { StateError } from "./value.js";

/** One undo step: the changes a checkpoint committed. */
export interface HistoryStep {
  /** What the store changed, as committed at the checkpoint. */
  readonly diff: StateDiff;
  /** A description for the inspector and undo UI, e.g. the passage or action. */
  readonly label?: string;
}

/** Options for {@link createHistory}. */
export interface HistoryOptions {
  /**
   * The most undo steps to keep. Older steps are dropped first. Defaults to
   * `Infinity` (unlimited). `0` disables undo, for example for permadeath.
   */
  readonly limit?: number;
}

/** Undo and redo over a {@link StateStore}. */
export interface History {
  /** The most undo steps kept. */
  readonly limit: number;
  /** Steps that can be undone, oldest first. */
  readonly past: readonly HistoryStep[];
  /** Steps that can be redone, next first. */
  readonly future: readonly HistoryStep[];
  /** Whether there is a step to undo. */
  readonly canUndo: boolean;
  /** Whether there is a step to redo. */
  readonly canRedo: boolean;
  /**
   * Commits the store's changes as one undo step and returns them. If nothing
   * changed, adds no step and keeps the redo steps. Otherwise the redo steps are
   * discarded, since they no longer follow from the current state.
   */
  checkpoint(label?: string): StateDiff;
  /**
   * Undoes the most recent step. Returns false if there was nothing to undo.
   * @throws {@link StateError} if the store has uncommitted changes.
   */
  undo(): boolean;
  /**
   * Redoes the most recently undone step. Returns false if there was nothing to redo.
   * @throws {@link StateError} if the store has uncommitted changes.
   */
  redo(): boolean;
  /** Discards every undo and redo step, for example after loading a save. */
  clear(): void;
}

function checkLimit(limit: number): void {
  if (limit !== Infinity && !(Number.isInteger(limit) && limit >= 0)) {
    throw new StateError(
      `history: limit must be a whole number of steps (0 or more) or Infinity, not ${String(limit)}.`,
    );
  }
}

/**
 * Creates an undo history for `store`. Changes made before the first checkpoint
 * aren't undoable; call {@link History.checkpoint} after setting up initial state.
 * @throws {@link StateError} if `limit` isn't a whole number of steps or `Infinity`.
 */
export function createHistory(store: StateStore, options: HistoryOptions = {}): History {
  const limit = options.limit ?? Infinity;
  checkLimit(limit);
  let past: HistoryStep[] = [];
  let future: HistoryStep[] = [];

  const ensureClean = (what: "undo" | "redo"): void => {
    if (store.dirty) {
      throw new StateError(
        `${what}: there are uncommitted changes; checkpoint or roll them back first.`,
      );
    }
  };

  return {
    limit,
    get past() {
      return Object.freeze([...past]);
    },
    get future() {
      return Object.freeze([...future].reverse());
    },
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
    checkpoint(label) {
      const diff = store.commit();
      if (diff.length === 0) return diff;
      future = [];
      if (limit === 0) return diff;
      past.push(Object.freeze({ diff, ...(label !== undefined && { label }) }));
      if (past.length > limit) past = past.slice(past.length - limit);
      return diff;
    },
    undo() {
      ensureClean("undo");
      const step = past.at(-1);
      if (!step) return false;
      // Apply before moving the step, so a failed apply leaves history as it was.
      store.apply(invertDiff(step.diff));
      past.pop();
      future.push(step);
      return true;
    },
    redo() {
      ensureClean("redo");
      const step = future.at(-1);
      if (!step) return false;
      store.apply(step.diff);
      future.pop();
      past.push(step);
      return true;
    },
    clear() {
      past = [];
      future = [];
    },
  };
}
