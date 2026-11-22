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
