/**
 * @packageDocumentation
 * Core runtime: state store, passages, effect phases, action pipeline, event record, save/undo, random streams. DOM-free.
 */
export { StateError, type StateValue } from "./state/value.js";
export {
  createStore,
  invertDiff,
  type StateChange,
  type StateDiff,
  type StateId,
  type StateSnapshot,
  type StateStore,
} from "./state/store.js";
