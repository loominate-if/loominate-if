import {
  createEventRecord,
  createStore,
  createStory,
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
  ask,
  convNode,
  goodbye,
  hello,
  no,
  openNode,
  openNodeOf,
  place,
  show,
  startAs,
  suggestedTopics,
  thing,
  topic,
  topics,
  yes,
} from "./index.js";

const study = place("study", { name: "study" });
const you = actor("you", { body: { name: "you", location: study } });
const butler = actor("butler", { body: { name: "butler", location: study } });
const maid = actor("maid", { body: { name: "maid", location: study } });
const photograph = thing("photograph", { name: "photograph", location: you });
const { job, weather, secret } = topics({
  job: "the job",
  weather: "the weather",
  secret: "the secret",
});
startAs(you);

// #region node
export const proposal = convNode(butler, "proposal", {
  restricts: true,
  presses: "“Well, sir? Will you take the post?”",
});
topic(butler, { ask: job, opens: proposal, says: "“There is a post, sir. Will you take it?”" });
topic(butler, { yes: true, in: proposal, says: "“Splendid, sir.”" });
topic(butler, { no: true, in: proposal, says: "“A pity, sir.”" });
// #endregion
topic(butler, { ask: weather, says: "“Grey, sir.”" });
topic(butler, { show: photograph, says: "He glances at it." });

// Not restrictive: other topics are answered, then she presses the point.
const gossip = convNode(maid, "gossip", { presses: "“But the secret, miss…”" });
topic(maid, { ask: secret, opens: gossip, says: "“I know a secret, miss.”" });
topic(maid, { ask: weather, says: "“Cold, miss.”" });
topic(maid, { ask: weather, in: gossip, stays: true, says: "“Never mind the weather, miss!”" });
topic(maid, { ask: butler, in: gossip, says: "“He did it, miss!”" });

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
  seen = 0;
});
const act = <A>(call: ActionCall<A>) => {
  story.act(call as unknown as ActionCall);
};
let seen = 0;
const said = () => {
  const all = record.events({ kinds: ["action-result"] }).filter((e) => !e.tags.includes("player"));
  const out = all.slice(seen).map((e) => e.text);
  seen = all.length;
  return out;
};
const labels = () => suggestedTopics().map((s) => s.label);

describe("conversation nodes (#116)", () => {
  it("open after the entry that asks, and answer only their replies while restrictive", () => {
    act(ask({ who: butler, about: job }));
    expect(said()).toEqual(["“There is a post, sir. Will you take it?”"]);
    expect(openNodeOf(butler)?.name).toBe("proposal");
    expect(labels()).toEqual(["Say yes", "Say no", "Say goodbye"]);
    // Changing the subject: he presses the point, and doesn't answer.
    act(ask({ who: butler, about: weather }));
    act(show({ thing: photograph, to: butler }));
    expect(said()).toEqual([
      "“Well, sir? Will you take the post?”",
      "“Well, sir? Will you take the post?”",
    ]);
    // A reply closes it, and other topics are answered again.
    act(yes({}));
    act(ask({ who: butler, about: weather }));
    expect(said()).toEqual(["“Splendid, sir.”", "“Grey, sir.”"]);
    expect(openNodeOf(butler)).toBeUndefined();
  });

  it("answer other topics while not restrictive, then press the point; a reply that stays keeps it open", () => {
    act(ask({ who: maid, about: secret }));
    act(ask({ who: maid, about: weather })); // her node's own entry, which stays
    expect(openNodeOf(maid)?.name).toBe("gossip");
    act(ask({ who: maid, about: job })); // not hers: no answer, then she presses
    act(ask({ who: maid, about: butler }));
    expect(said()).toEqual([
      "“I know a secret, miss.”",
      "“Never mind the weather, miss!”",
      "The maid has nothing to say about that.",
      "“But the secret, miss…”",
      "“He did it, miss!”",
    ]);
    expect(openNodeOf(maid)).toBeUndefined();
    act(ask({ who: maid, about: weather }));
    expect(said()).toEqual(["“Cold, miss.”"]);
  });

  it("let the player say goodbye, which closes the node with the conversation", () => {
    act(ask({ who: butler, about: job }));
    act(goodbye({}));
    expect(openNodeOf(butler)).toBeUndefined();
    act(hello({ who: butler }));
    act(no({}));
    expect(said().at(-1)).toBe("The butler wasn't asking you anything.");
  });

  it("can be opened by code, as an agenda would, only with the NPC in the conversation", () => {
    expect(() => openNode(butler, proposal)).toThrow("isn't in the conversation");
    act(hello({ who: butler }));
    openNode(butler, proposal);
    expect(labels()).toEqual(["Say yes", "Say no", "Say goodbye"]);
    expect(() => openNode(maid, proposal)).toThrow("another NPC's node");
  });

  it("explain, while a restrictive node is open, that other entries are held up", () => {
    act(ask({ who: butler, about: job }));
    const shown = _topicExplanations().map(
      (e) =>
        `${e.available ? "✓" : "✗"} ${e.label.replace(/ \(.*\)$/, "")}${e.why ? `: ${e.why}` : ""}`,
    );
    expect(shown).toContain(
      "✗ Ask the butler about the weather: Its node, proposal, is open and restrictive, so the NPC presses the point instead.",
    );
    expect(shown).toContain("✓ Say yes to the butler");
  });

  it("explain an entry whose node isn't open", () => {
    const { candidates } = _matchTopic(butler, "yes");
    expect(candidates.map((c) => c.why)).toEqual(["Its node, proposal, isn't open."]);
    expect(statusOf(yes({})).hidden).toBe("You aren't talking to anyone.");
  });

  it("give the same state for the same moves (determinism)", () => {
    act(ask({ who: butler, about: job }));
    act(ask({ who: butler, about: weather }));
    act(yes({}));
    const again = createStore();
    createStory(again, createEventRecord(again), passages, { start: "Study" }).playReplay(
      story.toReplay(),
    );
    expect(again.snapshot()).toEqual(store.snapshot());
  });
});
