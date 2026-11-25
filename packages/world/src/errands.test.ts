/** Splitting up (#139): a companion sent off on an errand, what they find, and their report on reunion. */
import {
  createEventRecord,
  createStore,
  createStory,
  type ActionCall,
  type EventRecord,
  type Passage,
  type StateStore,
  type Story,
} from "@loominate-if/core";
import { storyLog } from "@loominate-if/presentation";
import { beforeEach, describe, expect, it } from "vitest";
import {
  actor,
  askToSearch,
  companion,
  companionState,
  connect,
  defineFacts,
  enterRoom,
  errandOf,
  obeying,
  place,
  placeOf,
  player,
  registerRoom,
  searchable,
  sendOff,
  startAs,
  thing,
  type Place,
} from "./index.js";

export const hall = place("hall", { name: "hall" });
export const study = place("study", { name: "study" });
export const library = place("library", { name: "library" });
export const cellar = place("cellar", { name: "cellar" });
connect(hall, { east: study, down: cellar });
connect(study, { west: hall, east: library });
connect(library, { west: study });
connect(cellar, { up: hall });
export const you = actor("you", { body: { name: "you", location: hall } });
// #region errand
export const facts = defineFacts({ diary: "The diary was in the bureau." });
// Whoever sees the bureau learns where the diary was, from the bureau.
export const bureau = thing("bureau", { name: "bureau", location: library, found: facts.diary });
export const mira = actor("mira", { body: { name: "Mira", location: hall } });
companion(mira);
// "Ask Mira to search the library", on her menu.
searchable(library, cellar);
// #endregion
export const tom = actor("tom", { body: { name: "Tom", location: hall } });
companion(tom);
obeying.rule("Tom won't go into the cellar", ({ who, call }) =>
  who.id === "tom" && call.args.place === cellar ? "“Not the cellar,” says Tom." : undefined,
);
startAs(you);

const room = (id: string, r: Place): Passage => {
  registerRoom(r, { id, tags: [`room: ${r.id}`] });
  return {
    id,
    tags: [`room: ${r.id}`],
    effects: { enter: () => enterRoom(r) },
    body: () => [{ type: "link", label: "Wait", target: id }],
  };
};
const passages = [
  room("Hall", hall),
  room("Study", study),
  room("Library", library),
  room("Cellar", cellar),
];
let store: StateStore;
let record: EventRecord;
let story: Story;
beforeEach(() => {
  store = createStore();
  record = createEventRecord(store);
  story = createStory(store, record, passages, { start: "Hall" });
  story.begin();
});
const wait = () => {
  story.follow({ type: "link", label: "Wait", target: story.current ?? "Hall" });
};
const act = (call: unknown) => {
  story.act(call as ActionCall);
};
/** What was said or seen in the last move. */
const told = () => {
  const since = record.events({ kinds: ["action", "navigation"] }).at(-1)?.seq ?? -1;
  return record
    .events({ kinds: ["action-result", "perception"] })
    .filter((e) => e.seq > since)
    .map((e) => e.text);
};
const where = () => placeOf(mira)?.id;

describe("splitting up (#139)", () => {
  it("sends a companion off to search, there and back, and they tell what they found", () => {
    act(askToSearch({ thing: mira, place: library } as never));
    expect(told()).toEqual([
      "You ask Mira to search the library.",
      "Mira sets off for the library.",
      "Mira leaves to the east.",
    ]);
    expect([companionState(mira), errandOf(mira)]).toEqual([
      "independent",
      { to: "library", then: "return" },
    ]);
    expect(where()).toBe("study");
    wait();
    // In the library, she sees the bureau, and learns where the diary was, from it.
    expect(where()).toBe("library");
    expect(mira.sourceOf(facts.diary)?.from?.id).toBe("bureau");
    expect(player.knows(facts.diary)).toBe(false);
    wait();
    wait();
    // Back, she says what she found, as her own words, and the player knows it from her.
    expect(where()).toBe("hall");
    expect(told()).toEqual(["Mira arrives from the east.", "“The diary was in the bureau.”"]);
    expect([player.knows(facts.diary), player.sourceOf(facts.diary)?.from?.id]).toEqual([
      true,
      "mira",
    ]);
    expect([companionState(mira), errandOf(mira)]).toEqual(["accompanying", undefined]);
    // The story log has it as dialogue.
    expect(storyLog(record.events()).map((e) => [e.speaker ?? "", e.text])).toContainEqual([
      "Mira",
      "“The diary was in the bureau.”",
    ]);
  });

  it("can wait where they were sent, and tell the player who comes to find them", () => {
    sendOff(mira, { to: library, then: "wait" });
    wait();
    wait();
    expect([where(), companionState(mira)]).toEqual(["library", "independent"]);
    story.goTo("Study");
    story.goTo("Library");
    // The player sees the bureau as they come in, so she's nothing new to tell.
    expect(told()).toContain("“Nothing worth telling,” Mira says.");
    expect(player.sourceOf(facts.diary)?.from?.id).toBe("bureau");
    expect(companionState(mira)).toBe("waiting");
  });

  it("says when there's nothing worth telling", () => {
    sendOff(mira, { to: cellar });
    wait();
    wait();
    expect(told()).toContain("“Nothing worth telling,” Mira says.");
  });

  it("goes through obeying, so a companion can refuse", () => {
    act(askToSearch({ thing: tom, place: cellar } as never));
    expect(told()).toContain("“Not the cellar,” says Tom.");
    expect(companionState(tom)).toBe("accompanying");
  });

  it("isn't offered for where they already are, nor sent to something that isn't a place", () => {
    expect(() => {
      sendOff(mira, { to: bureau });
    }).toThrow("isn't a place");
    expect(() => {
      sendOff(you, { to: library });
    }).toThrow("isn't a companion");
  });

  it("gives the same moves the same results (determinism)", () => {
    act(askToSearch({ thing: mira, place: library } as never));
    wait();
    wait();
    wait();
    const snapshot = store.snapshot();
    store = createStore();
    record = createEventRecord(store);
    story = createStory(store, record, passages, { start: "Hall" });
    story.begin();
    act(askToSearch({ thing: mira, place: library } as never));
    wait();
    wait();
    wait();
    expect(store.snapshot()).toEqual(snapshot);
  });
});
