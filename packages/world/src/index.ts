/**
 * @packageDocumentation
 * The optional world model: things and places, the containment tree, and
 * what can be seen, reached, and heard. A game imports it only when it needs
 * them; a plain branching story never pays for it.
 */
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
  transparent,
  type Holding,
  type Place,
  type PlaceFields,
  type Thing,
  type ThingFields,
  type ThingOf,
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
export { enterRoom, isInRegion, regionsOf, visitsTo } from "./rooms.js";
