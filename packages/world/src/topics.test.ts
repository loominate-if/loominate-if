import {
  createEventRecord,
  createStore,
  createStory,
  object,
  statusOf,
  type ActionCall,
  type EventRecord,
  type Passage,
  type StateStore,
  type Story,
} from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  _matchTopic,
  _topicExplanations,
  actor,
  actorStateOf,
  actorStates,
  anything,
  ask,
  clock,
  conversation,
  defineFacts,
  goodbye,
  hello,
  move,
  no,
  place,
  player,
  setActorState,
  startAs,
  startClock,
  tell,
  thing,
  topic,
  topics,
  yes,
} from "./index.js";

const study = place("study", { name: "study" });
const hall = place("hall", { name: "hall" });
const you = actor("you", { body: { name: "you", location: study } });
const butler = actor("butler", { body: { name: "butler", location: study } });
const maid = actor("maid", { body: { name: "maid", location: study } });
const cook = actor("cook", { body: { name: "cook", location: hall } });
const letter = thing("letter", { name: "letter", location: study });
startAs(you);
startClock({ at: "20:00" });
const facts = defineFacts({ missingLetter: "The letter is missing." });
const weather = object("weatherNow", { isStormy: false });
const storm = {
  id: "storm",
  name: "the storm",
  get isHappening() {
    return weather.isStormy;
  },
};

// #region entries
const { war } = topics({ war: "the war" });
const [onDuty, offDuty] = actorStates(butler, ["onDuty", "offDuty"], { starts: "onDuty" });

topic(butler, { ask: letter, says: "“I placed it on the desk myself, sir.”" });
topic(butler, { ask: letter, in: offDuty, says: "“Off the record? I took it.”" });
topic(butler, { ask: letter, in: storm, says: "“Not now, sir, the windows!”" });
topic(butler, { ask: war, says: "“I'd rather not, sir.”" });
topic(butler, { ask: facts.missingLetter, says: "“Missing, sir? Surely not.”" });
topic(butler, { askOrTell: anything, says: "“I couldn't say, sir.”" });
topic(butler, { hello: true, says: "“Sir?”" });
topic(butler, { bye: true, implicit: false, says: "“Very good, sir.”" });
topic(butler, { bye: true, implicit: true, says: "The butler bows as you go." });
// #endregion
const toldWar = object("toldWar", { times: 0 });
topic(maid, {
  tell: war,
  priority: 2,
  when: () => toldWar.times < 1,
  says: () => {
    toldWar.times += 1;
    return "“Oh! I hadn't heard.”";
  },
});
topic(maid, { tell: war, says: "“So you said, miss.”" });
topic(maid, { yes: true, says: "“Thank you, miss.”" });
void onDuty;

const passages: Passage[] = [
  { id: "Study", tags: [], body: () => [{ type: "link", label: "Wait", target: "Study" }] },
];
let store: StateStore;
let record: EventRecord;
let story: Story;
beforeEach(() => {
  store = createStore();
  record = createEventRecord(store);
  story = createStory(store, record, passages, { start: "Study" });
  story.begin();
});
const act = <A>(call: ActionCall<A>) => {
  story.act(call as unknown as ActionCall);
};
let seen = 0;
/** What's been said since the last call. */
const said = () => {
  const all = record.events({ kinds: ["action-result"] }).filter((e) => !e.tags.includes("player"));
  const out = all.slice(seen).map((e) => e.text);
  seen = all.length;
  return out;
};
beforeEach(() => {
  seen = 0;
});

describe("topic entries (#111)", () => {
  it("answer asking about a thing, a named topic, or a fact, and anything else by the catch-all", () => {
    act(ask({ who: butler, about: letter }));
    expect(said()).toEqual(["“Sir?”", "“I placed it on the desk myself, sir.”"]);
    act(ask({ who: butler, about: war }));
    player.learn(facts.missingLetter); // asking about a fact needs knowing it (#113)
    act(ask({ who: butler, about: facts.missingLetter.id }));
    act(tell({ who: butler, about: you }));
    expect(said()).toEqual([
      "“I'd rather not, sir.”",
      "“Missing, sir? Surely not.”",
      "“I couldn't say, sir.”",
    ]);
  });

  it("start the conversation by asking, with an implicit hello, and take a minute each", () => {
    const before = clock.minutes;
    act(ask({ who: butler, about: letter }));
    expect([conversation.active, conversation.addressee?.id]).toEqual([true, "butler"]);
    // An unqualified hello answers implicitly too.
    expect(said()).toEqual(["“Sir?”", "“I placed it on the desk myself, sir.”"]);
    act(ask({ who: butler, about: war }));
    expect(said()).toEqual(["“I'd rather not, sir.”"]);
    expect(clock.minutes - before).toBe(2);
  });

  it("prefer a scene's entry over an actor state's over the actor's", () => {
    setActorState(butler, offDuty);
    expect(actorStateOf(butler)?.name).toBe("offDuty");
    act(ask({ who: butler, about: letter }));
    weather.isStormy = true;
    act(ask({ who: butler, about: letter }));
    expect(said().slice(1)).toEqual([
      "“Off the record? I took it.”",
      "“Not now, sir, the windows!”",
    ]);
  });

  it("go by priority first, and conditions, and can change state", () => {
    act(tell({ who: maid, about: war }));
    act(tell({ who: maid, about: war }));
    expect(said()).toEqual(["“Oh! I hadn't heard.”", "“So you said, miss.”"]);
  });

  it("ask about things and people out of reach, but not talk to them", () => {
    act(ask({ who: butler, about: cook })); // in the hall
    expect(said()).toEqual(["“Sir?”", "“I couldn't say, sir.”"]);
  });

  it("give a default response when nothing matches", () => {
    act(ask({ who: maid, about: letter }));
    act(yes({}));
    act(no({}));
    expect(said()).toEqual([
      "The maid has nothing to say about that.",
      "“Thank you, miss.”",
      "The maid wasn't asking you anything.",
    ]);
  });

  it("greet and say goodbye, explicitly or implicitly", () => {
    act(hello({ who: butler }));
    expect(said()).toEqual(["“Sir?”"]);
    expect(statusOf(hello({ who: butler })).disabled).toBe("You're already talking to the butler.");
    act(goodbye({}));
    expect([said(), conversation.active]).toEqual([["“Very good, sir.”"], false]);
    act(hello({ who: maid }));
    expect(said()).toEqual(["The maid nods to you."]);
    act(goodbye({}));
    expect(said()).toEqual(["You take your leave of the maid."]);
  });

  it("say an implicit goodbye when the conversation ends without one", () => {
    act(ask({ who: butler, about: letter }));
    said();
    move(you, hall);
    story.follow({ type: "link", label: "Wait", target: "Study" });
    expect([said(), conversation.active]).toEqual([["The butler bows as you go."], false]);
  });

  it("explain which entry answers, and why each other doesn't", () => {
    setActorState(butler, offDuty);
    const { candidates } = _matchTopic(butler, "ask", letter);
    expect(candidates.map((c) => [c.id, c.wins, c.why])).toEqual([
      ["butler:mind:ask:letter#1", false, "Outranked by butler:mind:ask:letter#2."],
      ["butler:mind:ask:letter#2", true, undefined],
      ["butler:mind:ask:letter#3", false, "Its scene, the storm, isn't happening."],
      ["butler:mind:ask:topic:war#4", false, "It's about something else."],
      ["butler:mind:ask:fact:missingLetter#5", false, "It's about something else."],
      ["butler:mind:ask|tell:*#6", false, "Outranked by butler:mind:ask:letter#2."],
    ]);
  });

  it("list each entry of those here for the inspector, with whether it answers now", () => {
    setActorState(butler, offDuty);
    const shown = _topicExplanations().map(
      (e) => `${e.available ? "✓" : "✗"} ${e.label}${e.why ? `: ${e.why}` : ""}`,
    );
    expect(shown).toContain("✓ Ask the butler about the letter (butler:mind:ask:letter#2)");
    expect(shown).toContain(
      "✗ Ask the butler about the letter (butler:mind:ask:letter#1): Outranked by butler:mind:ask:letter#2.",
    );
    expect(shown).toContain(
      "✓ Ask or tell the butler about anything else (butler:mind:ask|tell:*#6)",
    );
    expect(shown).toContain("✓ Say goodbye to the butler, unprompted (butler:mind:bye#9)");
    expect(shown).toContain("✓ Tell the maid about the war (maid:mind:tell:topic:war#1)");
    expect(shown).toContain(
      "✓ Ask the butler about the fact “The letter is missing.” (butler:mind:ask:fact:missingLetter#5)",
    );
    // In a conversation, only those in it.
    act(hello({ who: maid }));
    expect(_topicExplanations().every((e) => e.label.includes("maid"))).toBe(true);
  });

  it("refuse to talk to someone who isn't here, or to no one", () => {
    expect(statusOf(ask({ who: cook, about: letter })).hidden).toBe("The cook isn't here.");
    expect(statusOf(ask({ who: letter, about: war })).hidden).toBe("You can't talk to the letter.");
    expect(statusOf(ask({ who: butler, about: "nonsense" })).hidden).toBe(
      'There\'s no subject called "nonsense".',
    );
    expect(statusOf(goodbye({})).hidden).toBe("You aren't talking to anyone.");
  });

  it("give the same state for the same moves (determinism)", () => {
    act(ask({ who: butler, about: letter }));
    act(tell({ who: maid, about: war }));
    act(goodbye({}));
    const again = createStore();
    createStory(again, createEventRecord(again), passages, { start: "Study" }).playReplay(
      story.toReplay(),
    );
    expect(again.snapshot()).toEqual(store.snapshot());
  });
});
