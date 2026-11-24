import {
  createEventRecord,
  createStore,
  createStory,
  message,
  statusOf,
  type ActionCall,
  type ObjectRef,
  type EventRecord,
  type Passage,
  type StateStore,
  type Story,
} from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  actor,
  connect,
  conversation,
  enterRoom,
  hello,
  place,
  playAs,
  playerBody,
  playable,
  registerRoom,
  startAs,
  switchTo,
  takeControl,
  type Place,
} from "./index.js";

const hall = place("hall", { name: "hall" });
const cellar = place("cellar", { name: "cellar" });
connect(hall, { down: cellar });
connect(cellar, { up: hall });
// #region switching
// A body the player may leave needs a real name: it's "you" only while played.
const alex = actor("alex", { body: { name: "Alex", location: hall } });
const mira = actor("mira", { body: { name: "Mira", location: cellar } });
startAs(alex);
playable(alex);
playable(mira);
// #endregion
const butler = actor("butler", { body: { name: "butler", location: hall } });
const ghost = actor("ghost", { body: { name: "you", location: hall } });

const room = (id: string, r: Place): Passage => {
  registerRoom(r, { id, tags: [`room: ${r.id}`] });
  return {
    id,
    tags: [`room: ${r.id}`],
    effects: { enter: () => enterRoom(r) },
    body: () => [{ type: "link", label: "Wait", target: id }],
  };
};
const passages = [room("Hall", hall), room("Cellar", cellar)];
let store: StateStore;
let record: EventRecord;
let story: Story;
beforeEach(() => {
  store = createStore();
  record = createEventRecord(store);
  story = createStory(store, record, passages, { start: "Hall" });
  story.begin();
});
const act = <A>(call: ActionCall<A>) => {
  story.act(call as unknown as ActionCall);
};
const leaves = (who: ObjectRef) => message("actor.leaves", { actor: who });

describe("switching the player character (#125)", () => {
  it("has narration's person follow the mind the player controls", () => {
    expect([leaves(alex), leaves(mira)]).toEqual(["You leave.", "Mira leaves."]);
    act(takeControl({ thing: mira }));
    expect(playerBody()?.id).toBe("mira");
    expect([leaves(alex), leaves(mira)]).toEqual(["Alex leaves.", "You leave."]);
  });

  it("says who the player is now, and goes to the room they're in", () => {
    act(takeControl({ thing: mira }));
    expect(story.current).toBe("Cellar");
    expect(record.events({ kinds: ["action-result"] }).at(-1)?.text).toBe("You are Mira now.");
    act(takeControl({ thing: alex }));
    expect([story.current, playerBody()?.id]).toEqual(["Hall", "alex"]);
  });

  it("ends a conversation the player was in", () => {
    act(hello({ who: butler }));
    expect(conversation.active).toBe(true);
    act(takeControl({ thing: mira }));
    expect(conversation.active).toBe(false);
  });

  it("offers only playable characters, not the one played", () => {
    expect(statusOf(takeControl({ thing: butler })).hidden).toBe("You can't play as the butler.");
    expect(statusOf(takeControl({ thing: alex })).hidden).toBe("You're playing as them already.");
    expect(statusOf(takeControl({ thing: mira })).label).toBe("Play as Mira");
    // Only bodies with a playable mind are offered it on their menu, and any thing can be asked.
    expect(takeControl.offeredFor(hall)).toBe(false);
  });

  it('says to name a body the player leaves that\'s named "you"', () => {
    playAs(ghost);
    expect(() => {
      story.act(takeControl({ thing: alex }) as unknown as ActionCall);
    }).toThrow('is named "you"');
    expect(() => {
      switchTo(mira);
    }).toThrow('is named "you"');
  });

  it("give the same state for the same moves (determinism)", () => {
    act(takeControl({ thing: mira }));
    story.follow({ type: "link", label: "Wait", target: "Cellar" });
    const again = createStore();
    createStory(again, createEventRecord(again), passages, { start: "Hall" }).playReplay(
      story.toReplay(),
    );
    expect(again.snapshot()).toEqual(store.snapshot());
  });
});
