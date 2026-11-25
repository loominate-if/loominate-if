// Gate 3's walkthroughs (ADR 0027): topic matching, a soft and a hard lock
// with their ways out, a traveller who starts a conversation, timetables,
// both endings, replays, and the story log, exported.
// #region setup
import type { ActionCall } from "@loominate-if/core";
import { exportStoryLog } from "@loominate-if/presentation";
import { play, type Walkthrough } from "@loominate-if/testing";
import {
  ask,
  conversation,
  openNodeOf,
  placeOf,
  wait,
  waitUntil,
  whereScheduled,
} from "@loominate-if/world";
import { describe, expect, it } from "vitest";
import {
  facts,
  favour,
  marta,
  night,
  sealedLetter,
  stew,
  timeOfDay,
  tobias,
  wren,
  you,
} from "./story.js";

/** Takes an action the page doesn't offer as a choice, as a parser would. */
const take = (game: Walkthrough, call: unknown) => {
  game.story.act(call as ActionCall);
  return game;
};
/** Lets `minutes` pass, as the Wait menu does. */
const pass = (game: Walkthrough, minutes = 15) => take(game, wait({ minutes }));
/** Begins a new game, and goes in from the storm to the taproom. */
const start = (seed?: string) => (seed === undefined ? play() : play({ seed })).choose("Continue");
/** Goes through an exit by its direction, named with where it leads or not. */
const go = (game: Walkthrough, direction: string) => {
  const exit = game.choices.find((c) => c === direction || c.startsWith(`${direction},`));
  if (exit === undefined) throw new Error(`no way ${direction}: ${game.choices.join(", ")}`);
  return game.choose(exit);
};
/** Waits, five minutes at a time, until Wren has found you and asked her favour. */
const untilAsked = (game: Walkthrough) => {
  for (let i = 0; i < 20 && openNodeOf(wren) !== favour; i++) pass(game, 5);
  return game;
};
/** Plays until Wren has come to the taproom and asked her favour. */
const asked = (seed?: string) => untilAsked(start(seed));
// #endregion

describe("The Wayfarer's Rest: talking (#102)", () => {
  it("starts out of the storm, then in the taproom at half past nine, with Marta at the bar", () => {
    const arrived = play();
    expect([arrived.passage, arrived.choices]).toEqual(["Arrival", ["Continue"]]);
    const game = arrived.choose("Continue");
    expect([game.passage, timeOfDay(), placeOf(marta)?.id]).toEqual([
      "Taproom",
      "9:30 pm",
      "taproom",
    ]);
    expect(game.text).toContain("Marta works behind the bar.");
    expect(game.choices).toContain("Talk to Marta");
  });

  it("matches topics: the first answer, then again; a catch-all, in turn; and a condition", () => {
    const game = start().choose("Talk to Marta");
    expect(game.notices).toContain("“Evening. Foul night for it.”");
    game.choose("Ask about the storm");
    expect(game.notices).toContain("“Three days of it now. The river's never been so high.”");
    game.choose("Ask about the storm");
    expect(game.notices).toContain("“Still raining, love. Still raining.”");
    game.choose("Ask about the road");
    expect(game.notices).toContain("“The bridge road? Ask Tobias.");
    // Nothing of her own about the stew: her catch-all answers, in turn.
    take(game, ask({ who: marta, about: stew }));
    expect(game.notices).toContain("“Couldn't say, love.”");
    take(game, ask({ who: marta, about: stew }));
    expect(game.notices).toContain("Marta shrugs and wipes a glass.");
    game.choose("Say goodbye");
    expect(game.notices).toContain("“Mind the stairs.”");
  });

  it("holds you, softly, to settle the bill: she objects once, then lets you go", () => {
    const game = start().choose("Talk to Marta").choose("Ask about your room");
    expect(game.notices).toContain("You'll settle up now, before I forget?”");
    game.choose("Say goodbye");
    expect(game.notices).toContain("“Now, before you go,” says Marta. “The room?”");
    expect(conversation.active).toBe(true);
    // Trying again insists, and goes: she'll remember in the morning.
    game.choose("Say goodbye");
    expect(conversation.active).toBe(false);
    expect(night.paid).toBe(false);
    game.choose("Talk to Marta").choose("Ask about your room").choose("Say no");
    expect(game.notices).toContain("“In the morning, then. I'll remember.”");
    game.choose("Ask about your room").choose("Say yes");
    expect(game.notices).toContain("“Bless you.” She drops your coins in the till.");
    expect(night.paid).toBe(true);
  });

  it("learns from Tobias that the bridge is out, which anyone can then be asked about", () => {
    const game = go(start(), "East").choose("Talk to Tobias");
    expect(game.notices).toContain("“Mm?”");
    game.choose("Ask about the stew");
    expect(game.notices).toContain("“Mutton. Don't ask what else.”");
    take(game, ask({ who: tobias, about: wren }));
    expect(game.notices).toContain("Tobias grunts and goes on with his work.");
    expect(game.choices.join()).not.toContain("the bridge");
    game.choose("Ask about the road");
    expect(game.notices).toContain("The bridge isn't. Washed clean away this afternoon.”");
    expect(you.knows(facts.bridgeOut)).toBe(true);
    game.choose("Ask about the bridge");
    expect(game.notices).toContain("“Watched it go. Took a cart with it.”");
    // Walking off ends it without goodbye: his unprompted one.
    go(game, "West");
    expect(game.notices).toContain("Tobias goes back to what he was doing.");
    game.choose("Talk to Marta").choose("Ask about the bridge");
    expect(game.notices).toContain("“Gone? Then nobody's leaving tomorrow but by the ferry.”");
    go(game.choose("Say goodbye"), "East").choose("Talk to Tobias").choose("Say goodbye");
    expect(game.notices).toContain("“Mm.”");
  });
});

describe("The Wayfarer's Rest: Wren (#102)", () => {
  it("comes to find you at ten, a room a turn, and starts the conversation herself", () => {
    const game = go(start(), "East");
    pass(game);
    expect(placeOf(wren)?.id).toBe("landing");
    pass(game);
    // Ten o'clock: she's on her way down.
    expect(placeOf(wren)?.id).toBe("taproom");
    pass(game, 1);
    expect(placeOf(wren)?.id).toBe("kitchen");
    expect(game.notices).toContain("Wren arrives from");
    // Here, she speaks first.
    pass(game, 1);
    expect(game.notices).toContain(
      "“There you are. I've a letter that must cross the river, and you look honest.”",
    );
    expect(conversation.addressee?.id).toBe("wren");
    expect(openNodeOf(wren)).toBe(favour);
  });

  it("won't let you go until you answer: goodbye and the exits are barred, with why", () => {
    const game = asked();
    const barred = game.unavailable.map((u) => [u.label, u.reason]);
    expect(barred).toContainEqual(["Out", "You can't leave until you answer Wren."]);
    expect(() => game.choose("Say goodbye")).toThrow("You can't leave until you answer Wren.");
    // Asking about the letter in the node answers, and keeps it open.
    game.choose("Ask about the letter");
    expect(game.notices).toContain("“It must reach the ferryman at first light.");
    expect(openNodeOf(wren)).toBe(favour);
    // Changing the subject: she presses the point.
    take(game, ask({ who: wren, about: stew }));
    expect(game.notices).toContain("“Please. Will you take it?”");
    // The way out: an answer.
    game.choose("Say yes");
    expect(game.notices).toContain("She presses a sealed letter into your hand.");
    expect([openNodeOf(wren), conversation.exit, sealedLetter.location?.id]).toEqual([
      undefined,
      "free",
      "you",
    ]);
    expect(game.choices).toContain("Out");
  });

  it("tells her tale when asked about the letter, and comes back to the conversation", () => {
    const game = asked().choose("Say no");
    expect(game.notices).toContain("“I see.” She turns away. “Forget I asked.”");
    expect(night.refused).toBe(true);
    game.choose("Ask about the letter");
    expect(game.passage).toBe("Wren's Tale");
    expect(game.text).toContain("“I ride for the duchess,” Wren says, low.");
    game.advance();
    expect(game.text).toContain("But a ferry crosses at first light.”");
    game.choose("Continue");
    expect([game.passage, conversation.addressee?.id]).toEqual(["Taproom", "wren"]);
    expect(you.knows(facts.wrenIsCourier)).toBe(true);
    game.choose("Ask about Wren's errand");
    expect(game.notices).toContain("“Keep that to yourself. Please.”");
    game.choose("Ask about the ferryman").choose("Ask about the road");
    expect(game.notices).toContain("“I came the bridge road. Before.”");
    take(game, ask({ who: wren, about: stew }));
    expect(game.notices).toContain("“I wouldn't know.”");
    game.choose("Say goodbye");
    expect(game.notices).toContain("“Goodnight.”");
    game.choose("Talk to Wren");
    expect(game.notices).toContain("“Oh. Hello.”");
    game.choose("Say goodbye").choose("Talk to Marta").choose("Ask about Wren's errand");
    expect(game.notices).toContain("“The duchess's courier, under my roof?");
    game.choose("Ask about Wren");
    expect(game.notices).toContain("“Came in at dusk, soaked through.");
  });

  it("asks about the bridge, once you know of it", () => {
    const game = go(start(), "East").choose("Talk to Tobias").choose("Ask about the road");
    untilAsked(go(game, "West"));
    game.choose("Say no").choose("Ask about the bridge");
    expect(game.notices).toContain("“Then the ferry's the only way across.");
  });
});

describe("The Wayfarer's Rest: timetables (#102)", () => {
  it("sends Tobias to the stable at half past ten, and Marta to the cellar at eleven", () => {
    const game = asked().choose("Say yes").choose("Say goodbye");
    expect(whereScheduled(tobias)?.id).toBe("kitchen");
    take(game, waitUntil({ time: "22:35" }));
    expect(placeOf(tobias)?.id).toBe("stable");
    go(game, "Out");
    expect(game.text).toContain("Tobias forks hay into the mangers.");
    take(game, waitUntil({ time: "23:05" }));
    expect([placeOf(tobias)?.id, placeOf(marta)?.id]).toEqual(["kitchen", "cellar"]);
    go(game, "In");
    expect(game.text).not.toContain("Marta works behind the bar.");
    go(game, "Down");
    expect(game.text).toContain("Marta wrestles a fresh barrel onto its stand.");
    // Busy in the cellar, she won't talk about the weather.
    game.choose("Talk to Marta").choose("Ask about the storm");
    expect(game.notices).toContain("“Not now, love. This barrel won't change itself.”");
    take(game, waitUntil({ time: "23:30" }));
    // Half past eleven: back to the bar, seen going.
    expect(game.notices).toContain("Marta leaves upstairs.");
    expect(placeOf(marta)?.id).toBe("taproom");
  });
});

describe("The Wayfarer's Rest: endings and replays (#102)", () => {
  /** Says yes or no to Wren, then goes up to bed. */
  const toBed = (answer: "Say yes" | "Say no", seed?: string) => {
    const game = asked(seed);
    return go(go(game.choose(answer).choose("Say goodbye"), "Up"), "East").choose("Sleep");
  };

  it("ends at the ferry with her letter, if you said yes", () => {
    const game = toBed("Say yes");
    expect(game.passage).toBe("The Ferry");
    expect(game.text).toContain("hand him Wren's letter");
    expect(game.text).toContain("Marta shouts something about your bill.");
  });

  it("ends with Wren gone, if you said no, and Marta waving if you paid", () => {
    const game = start().choose("Talk to Marta").choose("Ask about your room").choose("Say yes");
    untilAsked(game.choose("Say goodbye"));
    go(go(game.choose("Say no").choose("Say goodbye"), "Up"), "East");
    expect(game.text).toContain("A small room with a hard bed.");
    game.choose("Sleep");
    expect(game.passage).toBe("Morning");
    expect(game.text).toContain("Wren is gone, her room empty");
    expect(game.text).toContain("Marta waves you off from the door.");
  });

  it("saves and loads to the same state", () => {
    const game = asked().choose("Say yes");
    const saved = game.store.snapshot();
    expect(play({ from: saved }).store.snapshot()).toEqual(saved);
  });

  it("replays exactly, from the seed and the moves (determinism)", () => {
    const game = toBed("Say yes", "storm");
    const replay = game.replay();
    const snapshot = game.store.snapshot();
    const fresh = toBed("Say yes", "storm");
    expect(fresh.replay()).toEqual(replay);
    expect(fresh.store.snapshot()).toEqual(snapshot);
  });
});

describe("The Wayfarer's Rest: the story log (#102)", () => {
  it("exports as a readable book: chapters, then what was said, by whom, in order", () => {
    const game = asked().choose("Say no").choose("Ask about the letter").advance();
    go(go(game.choose("Continue").choose("Say goodbye"), "Up"), "East").choose("Sleep");
    const book = exportStoryLog(game.record.events(), "markdown", {
      title: "The Wayfarer's Rest",
      author: "Loominate IF",
    });
    // Markdown is text; only EPUB is bytes.
    const text = typeof book.data === "string" ? book.data : new TextDecoder().decode(book.data);
    expect(book.name).toBe("The Wayfarer's Rest.md");
    const order = [
      "# The Wayfarer's Rest",
      "*Loominate IF*",
      "## Evening",
      "You shoulder the door shut on the storm.",
      "Rain hammers the shutters",
      "Wren arrives from above.",
      "**Wren:** “There you are. I've a letter that must cross the river",
      "*You say no.*",
      "**Wren:** “I see.” She turns away.",
      "*You ask Wren about the letter.*",
      "## Wren's Tale",
      "“I ride for the duchess,”",
      "*You say goodbye to Wren.*",
      "## Morning",
      "Wren is gone, her room empty",
    ];
    const at = order.map((line) => text.indexOf(line));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // A chapter starts once, however often its passage is visited; choices aren't prose.
    expect(text.split("## Evening").length - 1).toBe(1);
    expect(text).not.toContain("Talk to");
  });
});
