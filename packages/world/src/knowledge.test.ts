import {
  createEventRecord,
  createHistory,
  createStore,
  createStory,
  type EffectContext,
  type StateStore,
} from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  actor,
  container,
  defineFacts,
  enterRoom,
  fact,
  factNamed,
  mind,
  move,
  openable,
  place,
  playAs,
  player,
  possess,
  reveal,
  startAs,
  thing,
} from "./index.js";

// #region facts
export const facts = defineFacts({
  missingLetter: "The letter is missing from the desk.",
  butlerHandledLetter: "The butler handled the letter before supper.",
});
export const affair = fact("affair", { text: "The colonel and the cook are lovers." });
// #endregion

const study = place("study", { name: "study" });
const cellar = place("cellar", { name: "cellar", isDark: true });
const desk = thing("desk", { name: "desk", location: study });
const box = thing("box", { ...container, ...openable, name: "box", location: study });
const ring = thing("ring", { name: "ring", location: box });
const coal = thing("coal", { name: "coal", article: "some", location: cellar });
// #region familiar
export const portrait = thing("portrait", { name: "late duke's portrait", isFamiliar: true });
// #endregion
const diary = thing("diary", { name: "diary", location: study });

const you = actor("you", { body: { name: "you", location: null } });
const maid = actor("maid", { body: { name: "maid", location: study } });
const ghost = mind("ghost", { name: "ghost" });
startAs(you);

let store: StateStore;
beforeEach(() => {
  store = createStore();
  createStory(store, createEventRecord(store), [{ id: "Start", tags: [], body: () => [] }], {
    start: "Start",
  });
});

/** An effect context for a passage, as `{reveal}` receives it. */
const inPassage = (passage: string) => ({ passage }) as EffectContext;

describe("facts", () => {
  it("are defined one at a time or several at once", () => {
    expect(facts.missingLetter).toEqual({
      id: "missingLetter",
      text: "The letter is missing from the desk.",
    });
    expect(factNamed("affair")).toBe(affair);
    expect(() => fact("affair", { text: "again" })).toThrow(
      'fact "affair": another fact has this ID. Give each fact its own.',
    );
    expect(() => defineFacts({ missingLetter: "again" })).toThrow('fact "missingLetter"');
  });
});

describe("what a mind knows", () => {
  it("is learned with a source, and the first source is kept", () => {
    // #region learn
    expect(maid.knows(affair)).toBe(false);
    maid.learn(affair, { from: diary });
    maid.learn(affair, { from: you });
    expect(maid.knows(affair)).toBe(true);
    expect(maid.sourceOf(affair)?.from?.id).toBe("diary");
    // #endregion
    expect(you.knows(affair)).toBe(false);
    expect(maid.knownFacts()).toEqual([affair]);
  });

  it("is revealed to the player in a passage, from someone or not", () => {
    reveal({ fact: facts.butlerHandledLetter, from: maid }, inPassage("Kitchen"));
    reveal({ fact: facts.missingLetter }, inPassage("Study"));
    expect(player.sourceOf(facts.butlerHandledLetter)).toEqual({
      from: maid,
      passage: "Kitchen",
    });
    expect(player.sourceOf(facts.missingLetter)).toEqual({ passage: "Study" });
    expect(you.knows(facts.missingLetter)).toBe(true);
    expect(you.mind.knows(facts.missingLetter)).toBe(true);
  });

  it("follows the player's mind, not one actor's", () => {
    // #region player
    you.learn(affair);
    playAs(maid);
    expect(player.knows(affair)).toBe(false); // the player is the maid now
    expect(you.knows(affair)).toBe(true);
    // #endregion
    possess(ghost, maid);
    playAs(ghost);
    player.learn(facts.missingLetter);
    expect(ghost.knows(facts.missingLetter)).toBe(true);
    expect(maid.knows(facts.missingLetter)).toBe(false);
  });

  it("can be forgotten, and undo brings it back", () => {
    const history = createHistory(store);
    you.learn(affair);
    history.checkpoint("learned");
    you.forget(affair);
    history.checkpoint("forgot");
    expect(you.knows(affair)).toBe(false);
    expect(you.sourceOf(affair)).toBeUndefined();
    history.undo();
    expect(you.knows(affair)).toBe(true);
  });

  it("explains mistakes", () => {
    expect(() => you.knows({ id: "missingLetter", text: "a forgery" })).toThrow(
      'knows: "missingLetter" isn\'t a fact. Define it with fact() or defineFacts().',
    );
    expect(() => {
      you.see({ id: "nowhere" });
    }).toThrow('see: "nowhere" isn\'t defined with thing() or place().');
    expect(() =>
      // @ts-expect-error `knows` is every mind's own.
      mind("sage", { knows: true }),
    ).toThrow('mind "sage": "knows" is what every mind does with what it knows');
    // An actor's mind half and body half are checked too, at compile time and when the game loads.
    expect(() =>
      // @ts-expect-error `knows` is every mind's own.
      actor("cook", { body: { name: "cook" }, mind: { knows: "stuff" } }),
    ).toThrow('actor "cook": "knows" is what every mind does with what it knows');
    expect(() =>
      // @ts-expect-error `learn` is every mind's own.
      actor("valet", { body: { name: "valet", learn: 1 } }),
    ).toThrow('actor "valet": "learn" is what every mind does with what it knows');
  });
});

describe("what a mind has seen", () => {
  it("is everything in sight when the player arrives in a room", () => {
    move(you, study);
    expect(you.hasSeen(desk)).toBe(false); // moving alone doesn't look around
    enterRoom(study);
    expect([study, desk, box, diary, maid].map((t) => you.hasSeen(t))).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(you.hasSeen(ring)).toBe(false); // inside the closed box
    expect(maid.hasSeen(desk)).toBe(false); // only minds in the player's body look
    box.open();
    you.see(ring);
    expect(you.hasSeen(ring)).toBe(true);
  });

  it("is nothing in the dark", () => {
    enterRoom(cellar);
    expect(you.hasSeen(coal)).toBe(false);
    expect(you.hasSeen(cellar)).toBe(false);
  });

  it("is seen by a passenger too", () => {
    possess(ghost, you);
    playAs(ghost);
    enterRoom(study);
    expect(ghost.hasSeen(desk)).toBe(true);
    expect(you.hasSeen(desk)).toBe(true);
  });

  it("can be familiar without being seen, and forgotten", () => {
    // #region knowsAbout
    expect(you.knowsAbout(portrait)).toBe(true); // isFamiliar: everyone knows of it
    expect(you.knowsAbout(diary)).toBe(false);
    you.learnAbout(diary); // the maid mentioned it
    expect(you.knowsAbout(diary)).toBe(true);
    expect(you.hasSeen(diary)).toBe(false);
    // #endregion
    you.forget(diary);
    expect(you.knowsAbout(diary)).toBe(false);
  });
});
