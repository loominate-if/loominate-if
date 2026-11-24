// The Tollhouse: Gate 2's acceptance game (ADR 0027). A short world-model
// piece with containers, a locked gate and its key, and a toll keeper who
// reacts, through rules, to what you show and give them.
// #region world
import {
  accept,
  actor,
  connect,
  container,
  door,
  giving,
  listContents,
  lockable,
  openable,
  place,
  react,
  showing,
  startAs,
  thing,
} from "@loominate-if/world";
import { addToHeader } from "@loominate-if/presentation";

export const road = place("road", { name: "river road" });
export const tollhouse = place("tollhouse", { name: "tollhouse" });
export const bridge = place("bridge", { name: "bridge" });
export const farBank = place("farBank", { name: "far bank" });

export const you = actor("you", { body: { name: "you", location: road } });
export const satchel = thing("satchel", { ...container, name: "satchel", location: you });
export const coin = thing("coin", { name: "silver coin", location: satchel });
export const pass = thing("pass", { name: "travel pass", location: satchel });
export const pebble = thing("pebble", { name: "river pebble", location: road });

export const keeper = actor("keeper", {
  body: { name: "toll keeper", location: tollhouse, description: "Grey-bearded, and in no hurry." },
  mind: { hasSeenPass: false, isPaid: false },
});
// The keeper wears the strongbox's key, out of your reach.
export const boxKey = thing("boxKey", { name: "little brass key", location: keeper });
export const strongbox = thing("strongbox", {
  ...container,
  ...openable,
  ...lockable,
  name: "strongbox",
  key: boxKey,
  isFixed: true,
  isLocked: true,
  location: tollhouse,
  description: "Iron-bound. The keeper keeps its key on a cord round their neck.",
});
export const gateKey = thing("gateKey", { name: "iron key", location: strongbox });
export const gate = thing("gate", {
  ...door,
  ...lockable,
  name: "toll gate",
  key: gateKey,
  isLocked: true,
  description: "Oak bars, and a lock as big as your fist.",
});
connect(road, { east: tollhouse });
connect(tollhouse, { west: road, north: { to: bridge, via: gate } });
connect(bridge, { south: { to: tollhouse, via: gate }, north: farBank });
connect(farBank, { south: bridge });
startAs(you);
// The compass in the header, showing the ways out and why any is barred.
addToHeader("compass");
// #endregion

// #region keeper
// The keeper reads your pass, but won't open the strongbox until the toll is paid.
showing.rule("the keeper reads the pass", ({ thing, to }) => {
  if (to.id !== keeper.id || thing.id !== pass.id) return undefined;
  return react(
    keeper.isPaid
      ? "“All in order,” says the keeper, without looking up."
      : "“All in order,” says the keeper. “Toll's one silver coin.”",
    () => {
      keeper.hasSeenPass = true;
    },
  );
});
giving.rule("the keeper takes the toll", ({ thing, to }) => {
  if (to.id !== keeper.id || thing.id !== coin.id) return undefined;
  if (!keeper.hasSeenPass) return react("“Pass first,” says the keeper, pushing the coin back.");
  return accept(
    "The keeper bites the coin, unlocks the strongbox, and opens it. “Key's inside.”",
    () => {
      keeper.isPaid = true;
      strongbox.unlock();
      strongbox.open();
    },
  );
});
// #endregion

export { listContents };
