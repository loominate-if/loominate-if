import { beat, emit, object, randomStream, wait, type Passage } from "@loominate-if/core";
import { afterEach, describe, expect, it } from "vitest";
import { _setGame, play } from "./play.js";

const lamp = object("walkthrough-lamp", { lit: false });
const weather = randomStream("walkthrough-weather");

const passages: Passage[] = [
  {
    id: "Start",
    tags: [],
    body: ({ state }) => [
      { type: "text", text: "A small room." },
      {
        type: "text",
        text: "You could look around.",
        links: [{ type: "link", label: "look around", target: "Room", start: 10, end: 21 }],
      },
      { type: "link", label: "Light the lamp", target: "Lit" },
      {
        type: "link",
        label: "Go down",
        target: "Cellar",
        guard: {
          open: state.get("walkthrough-lamp", "lit") === true,
          condition: "lamp.lit",
          mode: "disabled-with-reason",
          reason: "It's too dark.",
        },
      },
      {
        type: "link",
        label: "Secret door",
        target: "Cellar",
        guard: { open: false, condition: "found.door", mode: "hidden" },
      },
    ],
  },
  {
    id: "Lit",
    tags: [],
    effects: {
      enter: () => {
        lamp.lit = true;
        emit("system", { text: "The lamp is lit." }, ["lamp"]);
      },
    },
    body: () => [
      { type: "text", text: "The room fills with light." },
      { type: "continue", target: "Start" },
    ],
  },
  {
    id: "Room",
    tags: [],

    body: () => [
      { type: "text", text: "Bare walls." },
      { type: "continue", target: "Start", label: "Back" },
    ],
  },
  {
    id: "Cellar",
    tags: [],
    effects: {
      enter: ({ state }) => {
        state.set("cellar", "weather", weather.pick(["rain", "fog", "wind", "snow"]));
      },
    },
    body: ({ state }) => [
      { type: "text", text: "Steps go down." },
      beat({ duration: 1000 }),
      { type: "text", text: `Outside: ${String(state.get("cellar", "weather"))}.` },
      wait(),
      { type: "text", text: "The end." },
    ],
  },
];

afterEach(() => {
  _setGame(undefined);
});

describe("walkthroughs", () => {
  it("make moves by label and read what the player sees", () => {
    const game = play({ passages, start: "Start" });
    expect(game.passage).toBe("Start");
    expect(game.text).toBe("A small room.\nYou could look around.");
    expect(game.choices).toEqual(["look around", "Light the lamp"]);
    expect(game.unavailable).toEqual([
      { label: "Go down", condition: "lamp.lit", reason: "It's too dark.", shown: true },
      { label: "Secret door", condition: "found.door", shown: false },
    ]);
    game.choose("Light the lamp");
    expect(game.text).toBe("The room fills with light.");
    expect(lamp.lit).toBe(true);
    expect(game.choose("Continue").choices).toEqual(["look around", "Light the lamp", "Go down"]);
    game.choose("look around").choose("Back");
    expect(game.transcript).toBe(
      [
        "A small room.",
        "You could look around.",
        "The room fills with light.",
        "A small room.",
        "You could look around.",
        "Bare walls.",
        "A small room.",
        "You could look around.",
      ].join("\n"),
    );
  });

  it("explain a choice that can't be made", () => {
    const game = play({ passages, start: "Start" });
    expect(() => game.choose("Go down")).toThrow(
      `There's no choice "Go down" in passage "Start". "Go down" can't be followed: \`lamp.lit\` doesn't hold (the player is told "It's too dark."). The choices are: "look around", "Light the lamp".`,
    );
    expect(() => game.choose("Fly")).toThrow(
      `There's no choice "Fly" in passage "Start". The choices are: "look around", "Light the lamp".`,
    );
  });

  it("move past beats, one at a time or all at once", () => {
    const game = play({ passages, start: "Start" }).choose("Light the lamp").choose("Continue");
    game.choose("Go down");
    expect(game.beat).toEqual({ type: "beat", duration: 1000 });
    expect(() => game.choose("Anything")).toThrow(
      "There are no choices yet; a beat is waiting, so advance() first.",
    );
    game.advance();
    expect(game.text).toMatch(/^Steps go down\.\nOutside: \w+\.$/);
    game.skip();
    expect(game.beat).toBeUndefined();
    expect(game.text).toMatch(/The end\.$/);
    expect(() => game.advance()).toThrow(
      `There's no beat waiting in passage "Cellar"; choose one of its choices instead.`,
    );
  });

  it("undo moves, as the player does", () => {
    const game = play({ passages, start: "Start" });
    expect(() => game.undo()).toThrow("There's nothing to undo.");
    game.choose("Light the lamp").undo();
    expect(game.passage).toBe("Start");
    expect(lamp.lit).toBe(false);
  });

  it("check the events the game recorded, by kind and tag (#261)", () => {
    const game = play({ passages, start: "Start" });
    // #region events
    game.choose("Light the lamp");
    const lit = game.record.events({ kinds: ["system"], tags: ["lamp"] });
    expect(lit.map((e) => e.text)).toEqual(["The lamp is lit."]);
    // #endregion
    game.undo();
    expect(game.record.events({ tags: ["lamp"] })).toEqual([]);
  });

  it("show what the player noticed during the move after its text, as the page does", () => {
    const attic: Passage[] = [
      {
        id: "Stairs",
        tags: [],
        body: () => [{ type: "link", label: "Up", target: "Attic" }],
      },
      {
        id: "Attic",
        tags: [],
        effects: {
          enter: () => {
            emit("perception", { text: "A draught stirs the dust.", sense: "see" });
          },
        },
        body: () => [
          { type: "text", text: "Bare rafters." },
          { type: "continue", target: "Stairs" },
        ],
      },
    ];
    const game = play({ passages: attic, start: "Stairs" });
    game.choose("Up");
    expect(game.notices).toBe("A draught stirs the dust.");
    expect(game.text).toBe("Bare rafters.\nA draught stirs the dust.");
    game.choose("Continue");
    expect(game.notices).toBe("");
  });

  it("play the same with the same seed, and replay exactly", () => {
    const run = (seed: string) =>
      play({ passages, start: "Start", seed })
        .choose("Light the lamp")
        .choose("Continue")
        .choose("Go down")
        .skip();
    const one = run("fixed");
    const two = run("fixed");
    expect(two.text).toBe(one.text);
    const fresh = run("fixed");
    expect(fresh.replay()).toEqual(one.replay());
    expect(fresh.store.snapshot()).toEqual(one.store.snapshot());
  });

  it("start from a saved state", () => {
    const saved = play({ passages, start: "Start" }).choose("Light the lamp").store.snapshot();
    const game = play({ passages, start: "Start", from: saved });
    expect(game.passage).toBe("Lit");
    expect(game.choices).toEqual(["Continue"]);
  });

  it("play the game loominate test loaded, or explain there isn't one", () => {
    expect(() => play()).toThrow(
      "play() has no game to play. Run walkthroughs with `loominate test`, which loads the game, or pass one: play({ passages, start }).",
    );
    _setGame({ passages, start: "Room" });
    expect(play().text).toBe("Bare walls.");
  });
});
