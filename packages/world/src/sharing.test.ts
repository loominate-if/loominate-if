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
import { beforeEach, describe, expect, it } from "vitest";
import {
  actor,
  ask,
  companion,
  connect,
  defineFacts,
  enterRoom,
  found,
  knowledgeSharing,
  place,
  player,
  registerRoom,
  startAs,
  thing,
  waitHere,
  type Place,
} from "./index.js";

const hall = place("hall", { name: "hall" });
const study = place("study", { name: "study" });
connect(hall, { east: study });
connect(study, { west: hall });
const you = actor("you", { body: { name: "you", location: hall } });
const mira = actor("mira", { body: { name: "Mira", location: hall } });
const tom = actor("tom", { body: { name: "Tom", location: hall } });
const ann = actor("ann", { body: { name: "Ann", location: hall } });
const ledger = thing("ledger", { name: "ledger", location: study });
const facts = defineFacts({
  diary: "The diary was in the bureau.",
  letter: "The letter was forged.",
  map: "The map shows a cellar.",
});
startAs(you);

// #region sharing
knowledgeSharing("reunion"); // the default
companion(mira); // shares as the game does: on reunion
companion(tom, { shares: "together" });
companion(ann, { shares: "conversation" });
// #endregion

const room = (id: string, r: Place): Passage => {
  registerRoom(r, { id, tags: [`room: ${r.id}`] });
  return {
    id,
    tags: [`room: ${r.id}`],
    effects: { enter: () => enterRoom(r) },
    body: () => [{ type: "link", label: "Wait", target: id }],
  };
};
const passages = [room("Hall", hall), room("Study", study)];
let store: StateStore;
let record: EventRecord;
let story: Story;
beforeEach(() => {
  store = createStore();
  record = createEventRecord(store);
  story = createStory(store, record, passages, { start: "Hall" });
  story.begin();
});
const goTo = (passage: string) => {
  story.goTo(passage);
};
const wait = () => {
  story.follow({ type: "link", label: "Wait", target: story.current ?? "Hall" });
};
const act = <A>(call: ActionCall<A>) => {
  story.act(call as unknown as ActionCall);
};
/** Everyone waits in the hall while the player goes to the study and back; `who` learns `fact` apart, and the player the letter. */
const splitUp = (
  who: typeof mira | typeof tom | typeof ann,
  fact: (typeof facts)[keyof typeof facts],
) => {
  waitHere(mira);
  waitHere(tom);
  waitHere(ann);
  goTo("Study"); // the player sees the ledger, apart from them
  player.learn(facts.letter);
  who.learn(fact);
  goTo("Hall");
};

describe("knowledge sharing (#124)", () => {
  it("on reunion: everything, when they're together again, sourced to who knew it", () => {
    splitUp(mira, facts.diary);
    expect(player.knows(facts.diary)).toBe(true);
    expect(player.sourceOf(facts.diary)?.from?.id).toBe("mira");
    expect(mira.knows(facts.letter)).toBe(true);
    // What the player saw apart, she now knows of, without having seen it.
    expect([mira.knowsAbout(ledger), mira.hasSeen(ledger)]).toEqual([true, false]);
  });

  it("together: what's learned while together at once, but not what was learned apart", () => {
    splitUp(tom, facts.diary);
    // Tom learned the diary apart; the player, the letter. Neither is shared.
    expect([player.knows(facts.diary), tom.knows(facts.letter)]).toEqual([false, false]);
    tom.learn(facts.map); // together now
    wait();
    expect(player.sourceOf(facts.map)?.from?.id).toBe("tom");
    // What he learned apart, he tells when asked.
    act(ask({ who: tom, about: found }));
    expect(player.sourceOf(facts.diary)?.from?.id).toBe("tom");
  });

  it("conversation: nothing by itself, but asking what they found tells it", () => {
    ann.learn(facts.map); // together, but Ann only shares by talking
    wait();
    expect(player.knows(facts.map)).toBe(false);
    act(ask({ who: ann, about: found }));
    expect(player.sourceOf(facts.map)?.from?.id).toBe("ann");
    act(ask({ who: ann, about: found }));
    const said = record.events({ kinds: ["action-result"] }).map((e) => e.text);
    expect(said).toContain("“The map shows a cellar.”");
    expect(said.at(-1)).toBe("“Nothing you don't know,” Ann says.");
  });

  it("can only be set as the game loads", () => {
    expect(() => {
      knowledgeSharing("together");
    }).toThrow("in story.ts");
  });

  it("give the same state for the same moves (determinism)", () => {
    wait();
    goTo("Study");
    goTo("Hall");
    const again = createStore();
    createStory(again, createEventRecord(again), passages, { start: "Hall" }).playReplay(
      story.toReplay(),
    );
    expect(again.snapshot()).toEqual(store.snapshot());
  });
});
