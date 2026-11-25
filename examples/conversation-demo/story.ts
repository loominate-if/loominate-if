// The Wayfarer's Rest: Gate 3's acceptance game (ADR 0027). A conversation-
// driven piece at an inn on a stormy night: an innkeeper and a cook on
// their timetables, and a traveller who comes to find you with a favour to
// ask, and won't let you go until you've answered.
// #region inn
import { object, type ObjectRef } from "@loominate-if/core";
import { addToHeader } from "@loominate-if/presentation";
import {
  actor,
  agenda,
  anything,
  approach,
  clock,
  connect,
  conversation,
  convNode,
  defineFacts,
  hello,
  move,
  place,
  placeOf,
  player,
  schedule,
  startAs,
  startClock,
  stepToward,
  thing,
  timeOfDay,
  topic,
  topics,
  wait,
  waitMenu,
  waitUntil,
} from "@loominate-if/world";

startClock({ at: "21:30", travelMinutes: 1 });

export const taproom = place("taproom", { name: "taproom" });
export const kitchen = place("kitchen", { name: "kitchen" });
export const cellar = place("cellar", { name: "cellar" });
export const stable = place("stable", { name: "stable" });
export const landing = place("landing", { name: "landing" });
export const yourRoom = place("yourRoom", { name: "bedroom" });
connect(taproom, {
  east: kitchen,
  down: cellar,
  up: landing,
  out: { to: stable, minutes: 2 },
});
connect(kitchen, { west: taproom });
connect(cellar, { up: taproom });
connect(stable, { in: { to: taproom, minutes: 2 } });
connect(landing, { down: taproom, east: yourRoom });
connect(yourRoom, { west: landing });

export const you = actor("you", { body: { name: "you", location: taproom } });
startAs(you);
// #endregion

// #region people
// Marta keeps the taproom, and changes a barrel in the cellar at eleven.
export const marta = actor("marta", {
  body: { name: "Marta", location: taproom, description: "The innkeeper, sleeves rolled." },
});
schedule(marta, [
  { at: "21:00", in: taproom },
  { at: "23:00", in: cellar },
  { at: "23:30", in: taproom },
]);
// Tobias cooks, and sees to the horses in the stable at half past ten.
export const tobias = actor("tobias", {
  body: { name: "Tobias", location: kitchen, description: "The cook, floury to the elbows." },
});
schedule(tobias, [
  { at: "21:00", in: kitchen },
  { at: "22:30", in: stable },
  { at: "23:00", in: kitchen },
]);
// Wren, a traveller, keeps to the landing until she comes to find you.
export const wren = actor("wren", {
  body: { name: "Wren", location: landing, description: "A traveller in a wet grey cloak." },
});
// #endregion

// #region talk
export const { storm, road, room, stew, ferryman, letter } = topics({
  storm: "the storm",
  road: "the road",
  room: "your room",
  stew: "the stew",
  ferryman: "the ferryman",
  // Unknown until Wren mentions it.
  letter: { name: "the letter", known: false },
});
export const facts = defineFacts({
  bridgeOut: { text: "The bridge on the road east is washed away.", name: "the bridge" },
  wrenIsCourier: { text: "Wren carries letters for the duchess.", name: "Wren's errand" },
});
/** What's been settled tonight: the bill, and Wren's favour. */
export const night = object("night", { paid: false, promised: false, refused: false });

// Marta asks you to settle up, and objects once if you try to leave first.
export const settling = convNode(marta, "settling", {
  presses: "“So, the room?”",
  exit: "soft",
  objects: "“Now, before you go,” says Marta. “The room?”",
});
// Wren asks her favour, and won't let you go until you've answered.
export const favour = convNode(wren, "favour", {
  exit: "hard",
  presses: "“Please. Will you take it?”",
  // Opened by her approach, not by a topic.
  openedElsewhere: true,
});
// Busy in the cellar, Marta has no time for the weather.
topic(marta, {
  ask: storm,
  priority: 5,
  when: () => placeOf(marta)?.id === "cellar",
  says: "“Not now, love. This barrel won't change itself.”",
});
topic(marta, {
  askOrTell: anything,
  order: "cycle",
  says: ["“Couldn't say, love.”", "Marta shrugs and wipes a glass."],
});
// The sealed letter Wren gives you, if you say you'll take it.
export const sealedLetter = thing("sealedLetter", { name: "sealed letter", location: wren });
export const promise = (): void => {
  night.promised = true;
  move(sealedLetter, you);
};
// #endregion

// #region agenda
// At ten, Wren comes down to find you, a room a turn, and asks her favour
// as soon as she reaches you, in the same turn, so she speaks first.
agenda(wren, "ask a favour", {
  ready: () => clock.minutes >= 30,
  act: ({ npc, done }) => {
    if (!stepToward(npc, you)) return;
    approach(npc, {
      says: "“There you are. I've a letter that must cross the river, and you look honest.”",
      opens: favour,
    });
    player.learnAbout(letter);
    done();
  },
});
// #endregion

// #region page
// The time, and ways to let it pass, in the header.
addToHeader("clock");
waitMenu([
  { call: wait({ minutes: 15 }) },
  { call: waitUntil({ time: "23:00" }), label: "Wait until eleven" },
]);
/** Whether `npc` is in the room with you. */
export const isHere = (npc: ObjectRef): boolean => placeOf(npc)?.id === placeOf(you)?.id;
/** Whether you're talking to `npc` now. */
export const talkingTo = (npc: ObjectRef): boolean =>
  conversation.active && conversation.participants.some((p) => p.id === npc.id);
export { anything, hello, timeOfDay };
// #endregion
