/**
 * @packageDocumentation
 * The optional world model: things and places, the containment tree, and
 * what can be seen, reached, and heard. A game imports it only when it needs
 * them; a plain branching story never pays for it.
 */
// Registers the message parameters `t` templates use: articles, pronouns, and verbs.
import "./grammar.js";
// Registers the world model's messages, which a game can reword.
import "./messages.js";
// Says who acts, and adds the rules every action needs: a body, and its things in reach.
export { reachNotNeeded } from "./acting.js";
export {
  container,
  contents,
  holding,
  isPlace,
  isWithin,
  lightSource,
  lockable,
  move,
  openable,
  parentOf,
  place,
  placeOf,
  surface,
  thing,
  thingTemplate,
  transparent,
  type Holding,
  type Place,
  type PlaceFields,
  type Thing,
  type ThingFields,
  type ThingOf,
  type Vocabulary,
} from "./things.js";
export { canHear, canReach, canSee, inScope, isInLight, type Sense } from "./scope.js";
export {
  actor,
  body,
  bodyOf,
  isBody,
  isMind,
  leaveBody,
  mind,
  mindOf,
  passengersOf,
  playAs,
  playerBody,
  playerMind,
  possess,
  startAs,
  swapBodies,
  type Actor,
  type ActorHalves,
  type Mind,
  type MindFields,
  type MindOf,
  type LeaveOptions,
  type PossessOptions,
} from "./actors.js";
export {
  isRegion,
  region,
  type Region,
  type RegionFields,
  type RegionHooks,
  type RegionOf,
  type RegionOptions,
} from "./regions.js";
export {
  enterRoom,
  isInRegion,
  registerRoom,
  regionsOf,
  totalVisitsTo,
  visitsTo,
} from "./rooms.js";
export {
  direction,
  directionNamed,
  directions,
  type Direction,
  type DirectionName,
  type DirectionOptions,
  type Directions,
} from "./directions.js";
export {
  blockedReason,
  connect,
  door,
  exitLinks,
  exitsOf,
  obstacle,
  setExit,
  type Exit,
  type ExitsDefinition,
  type ExitSpec,
} from "./exits.js";
export {
  defineFacts,
  fact,
  factNamed,
  player,
  reveal,
  type Fact,
  type FactOptions,
  type FactSource,
  type LearnOptions,
  type MindKnowledge,
  type Player,
  type RevealArguments,
} from "./knowledge.js";
export { happen, type HappenOptions } from "./perception.js";
export { type Grammar, type Pronoun } from "./grammar.js";
export { listContents, pluralize, pluralOf, type ListingFields } from "./listing.js";
export { vocabOf, type FullVocabulary } from "./vocabulary.js";
export {
  close,
  accept,
  drop,
  dropOne,
  dropSome,
  examine,
  isPortable,
  lock,
  open,
  give,
  giving,
  react,
  show,
  showing,
  take,
  type Offer,
  type Reaction,
  takeOne,
  takeSome,
  unlock,
  type ActingOn,
} from "./standard.js";
export { inventory } from "./inventory.js";
export {
  clock,
  clockWidget,
  dayParts,
  startClock,
  timeOfDay,
  type AdvanceOptions,
  type Advanced,
  type Clock,
  type ClockStart,
} from "./clock.js";
export {
  _scheduled,
  daemon,
  days,
  fuse,
  minutes,
  moves,
  sentence,
  type Clause,
  type SentenceWording,
  type Daemon,
  type DaemonOptions,
  type Delay,
  type Firing,
  type Fuse,
  type FuseOptions,
  type Repeated,
  type Scheduled,
  type _ScheduledInfo,
  type Ended,
  type Summary,
} from "./schedule.js";
export { wait, waitCondition, waitMenu, waitUntil, type WaitUntil } from "./waiting.js";
export {
  calendar,
  countedDays,
  dateText,
  defineCalendar,
  gregorian,
  holiday,
  useCalendar,
  type Calendar,
  type CalendarDefinition,
  type CalendarQuery,
  type CalendarView,
  type CountedDaysOptions,
  type DateSpec,
  type GregorianOptions,
  type HolidayRule,
  type SeasonsByMonth,
} from "./calendar.js";
export { isOpenNow, openingHours, type Hours, type StoredHours } from "./hours.js";
export { closingTime, type ClosingStep } from "./closing.js";
export { scene, type Endings, type Scene, type SceneOptions } from "./scenes.js";
export { journey, type JourneyOptions } from "./journeys.js";
export { compass, type CompassSettings } from "./compass.js";
export {
  disguise,
  disguisedAs,
  expose,
  seesThrough,
  undisguise,
  whoIs,
  type DisguiseAs,
} from "./identity.js";
export {
  changeRelationship,
  relationship,
  relationships,
  relationshipTo,
  setRelationship,
  threshold,
  type Crossing,
  type Dimension,
  type Dimensions,
  type DimensionSpec,
  type Relationship,
  type ThresholdSpec,
} from "./relationships.js";
export {
  _statsTable,
  baseStat,
  canSpend,
  changeStat,
  modifiersOf,
  modify,
  unmodify,
  type ActiveModifier,
  type _StatRow,
  type Modifier,
  restore,
  setStat,
  spend,
  stat,
  stats,
  type DerivedStat,
  type KeptStat,
  type StatName,
  type Stats,
  type StatSpec,
} from "./stats.js";
export {
  countOf,
  isStack,
  setCount,
  split,
  stack,
  stackable,
  stackIn,
  type StackFields,
  type StackKind,
} from "./stacks.js";
export {
  _playerPath,
  _worldDetails,
  _worldTree,
  type _Details,
  type _Knowledge,
  type _TreeNode,
  type _WorldTree,
} from "./tree.js";
export {
  actAs,
  catchUp,
  everyTurn,
  getsTurn,
  go,
  isSimulated,
  simulate,
  type CatchUp,
  type NpcTurn,
} from "./npcs.js";
export {
  agenda,
  isAgendaActive,
  say,
  startAgenda,
  stepToward,
  stopAgenda,
  type AgendaItem,
  type AgendaTurn,
} from "./agendas.js";
export { schedule, whereScheduled, type TimetableEntry } from "./timetables.js";
export {
  _npcRows,
  type _NpcAgendaItem,
  type _NpcRow,
  type _NpcTimetableEntry,
} from "./npc-view.js";
export {
  address,
  conversation,
  endConversation,
  inConversationWith,
  joinConversation,
  type LeftBy,
  leaveConversation,
  lockConversation,
  startConversation,
  unlockConversation,
  type ConversationExit,
  type ConversationLock,
  type ConversationView,
  type LockLevel,
} from "./conversations.js";
export {
  actorStateOf,
  actorStates,
  anything,
  ask,
  goodbye,
  hello,
  no,
  setActorState,
  registerActorPassage,
  registerNodePassage,
  registerScenePassage,
  registerStatePassage,
  suggestedTopics,
  tell,
  topic,
  topicBlock,
  topicLinks,
  topics,
  yes,
  _addressAction,
  _matchTopic,
  _topicCharacters,
  _topicEntries,
  _topicRows,
  _topicExplanations,
  type ActorState,
  type ListOrder,
  type Says,
  type Subject,
  type SuggestedTopic,
  type Topic,
  type TopicDefinition,
  type TopicBlockArguments,
  type TopicBlockPassage,
  type TopicCandidate,
  type _TopicRow,
  type TopicContext,
  type TopicEntry,
  type TopicKind,
  type TopicOptions,
} from "./topics.js";
export { closeNode, convNode, openNode, openNodeOf, type ConvNode, type Presses } from "./nodes.js";
export {
  approach,
  conversationMode,
  expressionOf,
  portrait,
  setExpression,
  _cast,
  _conversationNow,
  type Portrait,
  type _ConversationNow,
} from "./conversation-mode.js";
export {
  accompany,
  companion,
  companionState,
  waitHere,
  type CompanionState,
  type SharingPolicy,
} from "./companions.js";
export { found, knowledgeSharing } from "./sharing.js";
export { follow } from "./following.js";
export {
  askFor,
  askToCome,
  askToWait,
  comeAlong,
  obeying,
  order,
  stay,
  type Ordered,
} from "./orders.js";
export { isPlayable, playable, switchTo, takeControl } from "./switching.js";
