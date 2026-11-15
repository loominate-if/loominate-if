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
export {
  createHistory,
  type History,
  type HistoryOptions,
  type HistoryStep,
} from "./state/history.js";
export {
  createInstances,
  instanceId,
  type InstanceRef,
  type Instances,
  type Template,
  type TemplateParams,
} from "./state/instances.js";
export {
  createEventRecord,
  type EventKind,
  type EventKinds,
  type EventQuery,
  type EventRecord,
  type LineId,
  type ProseFields,
  type RecordedEvent,
} from "./events/record.js";
export {
  createStory,
  type Choice,
  type ContinueNode,
  type EffectContext,
  type EffectPhase,
  type GuardMode,
  type LinkGuard,
  type LinkNode,
  type Passage,
  type PassageEffects,
  type PassageId,
  type PassageNode,
  type RenderContext,
  type RenderedLink,
  type RenderedNode,
  type RenderedPassage,
  type StateReader,
  type StateWriter,
  type Story,
  type StoryOptions,
  type TextNode,
  type UnavailableLink,
} from "./passages/story.js";
