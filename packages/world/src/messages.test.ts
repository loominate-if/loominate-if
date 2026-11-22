import {
  createEventRecord,
  createStore,
  createStory,
  message,
  messages,
  t,
  type MessageText,
  type Messages,
} from "@loominate-if/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  actor,
  connect,
  door,
  enterRoom,
  exitLinks,
  lockable,
  move,
  place,
  registerRoom,
  startAs,
  thing,
} from "./index.js";

const deck = place("deck", { name: "deck" });
const hold = place("hold", { name: "hold" });
const hatch = thing("hatch", { ...door, ...lockable, name: "hatch" });
connect(deck, { down: { to: hold, via: hatch } });
connect(hold, { up: { to: deck, via: hatch } });
registerRoom(deck, { id: "Deck", tags: [] });
registerRoom(hold, { id: "Hold", tags: [] });
const you = actor("you", { body: { name: "you", location: deck } });
const parrot = actor("parrot", { body: { name: "parrot", location: hold } });
startAs(you);

/** The world's own texts, to put back after each test, since the table is global. */
const saved = (["door.locked", "exit.label", "actor.arrives", "direction.label"] as const).map(
  (key) => [key, messages.get(key)] as const,
);
afterEach(() => {
  for (const [key, text] of saved) {
    messages.replace(key, text as MessageText<Messages[typeof key]>, {
      source: "@loominate-if/world",
    });
  }
});
beforeEach(() => {
  const store = createStore();
  createStory(store, createEventRecord(store), [{ id: "Start", tags: [], body: () => [] }], {
    start: "Start",
  });
});

describe("the world model's messages", () => {
  it("can be reworded in a pirate voice", () => {
    // #region pirate
    messages.replace("door.locked", t`Arr, {the door} be locked tight!`);
    messages.replace("direction.label", ({ direction }) =>
      direction === "down" ? "Below decks" : direction === "up" ? "Topside" : direction,
    );
    messages.replace("actor.arrives", t`{The subj actor} {flutters} in, squawkin'.`);
    // #endregion
    const [down] = exitLinks();
    expect(down?.label).toBe("Below decks");
    expect(down?.guard?.reason).toBe("Arr, the hatch be locked tight!");
    expect(message("actor.arrives", { actor: parrot })).toBe("The parrot flutters in, squawkin'.");
  });

  it("read as before when nobody rewords them", () => {
    hatch.unlock();
    hatch.open();
    move(you, hold);
    enterRoom(hold);
    move(you, deck);
    expect(exitLinks()[0]?.label).toBe("Down, to the hold");
    expect(message("door.closed", { door: hatch })).toBe("The hatch is closed.");
    expect(message("actor.leaves", { actor: parrot, toward: "upstairs" })).toBe(
      "The parrot leaves upstairs.",
    );
  });

  it("explain a name the message isn't about", () => {
    messages.replace("door.locked", t`{The subj hatch} {is} locked.`);
    expect(() => message("door.locked", { door: hatch })).toThrow(
      '{The}: "hatch" isn\'t something this text is about. It can name "door".',
    );
  });
});
