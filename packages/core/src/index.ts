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
  instancesOf,
  mixin,
  object,
  spawn,
  template,
  type Handle,
  type ObjectData,
  type ObjectDefinition,
  type ObjectRef,
  type ObjectTemplate,
} from "./objects/objects.js";
export {
  createEventRecord,
  type EventKind,
  type EventKinds,
  type EventQuery,
  type EventRecord,
  type LineId,
  type ProseFields,
  type RecordedEvent,
  type TextStyle,
} from "./events/record.js";
export {
  createStory,
  type Choice,
  type ContinueNode,
  type EffectContext,
  type EffectPhase,
  type GuardMode,
  type InlineLink,
  type LinkGuard,
  type LinkNode,
  type Passage,
  type PassageEffects,
  type PassageId,
  type PassageNode,
  type RenderContext,
  type RenderedInlineLink,
  type RenderedLink,
  type RenderedNode,
  type RenderedPassage,
  type RenderedText,
  type StateReader,
  type StateWriter,
  type Story,
  type StoryOptions,
  type TextNode,
  type UnavailableLink,
} from "./passages/story.js";
export {
  emphasis,
  prose,
  strong,
  type ProseOptions,
  type ProsePart,
  type StyledProse,
} from "./passages/prose.js";
export { randomStream, type RandomStream } from "./random/random.js";
export {
  readReplay,
  REPLAY_FORMAT,
  REPLAY_VERSION,
  writeReplay,
  type ChoiceRef,
  type Replay,
  type ReplayCheck,
  type StoryAction,
} from "./replay/replay.js";
export {
  AUTOSAVE_SLOT,
  createMemoryStorage,
  createSave,
  createSaves,
  ENGINE_VERSION,
  readSave,
  SAVE_FORMAT,
  SAVE_VERSION,
  writeSave,
  type GameInfo,
  type LoadedSave,
  type SaveFile,
  type SaveStorage,
  type Saves,
  type SavesOptions,
  type SaveSummary,
  type UnreadableSave,
} from "./save/save.js";
export {
  createPersistent,
  openPersistent,
  PERSISTENT_FORMAT,
  PERSISTENT_VERSION,
  readPersistent,
  writePersistent,
  type PersistentStorage,
  type PersistentStore,
} from "./persistent/persistent.js";
