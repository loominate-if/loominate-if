// @vitest-environment jsdom
/**
 * The pseudo-locale test (#60, ADR 0077): every library message is replaced
 * with its marked key, and a world-model game is played through the player
 * shell. Every word the player can see or hear that isn't the game's own
 * must come from the message table, so a translation could replace it.
 * The game's own words are marked with ω or Ω, and the replaced messages
 * with ⟦…⟧; anything else is library English that bypassed the table.
 */
import {
  createMemoryStorage,
  menuLink,
  messageFallbacks,
  messageParameters,
  messages,
  type Passage,
} from "@loominate-if/core";
import { addToHeader, playGame } from "@loominate-if/presentation";
import { afterEach, describe, expect, it } from "vitest";
import {
  actor,
  connect,
  door,
  enterRoom,
  exitLinks,
  lockable,
  place,
  registerRoom,
  stack,
  stackable,
  startAs,
  startClock,
  thing,
  type Place,
} from "./index.js";

const hall = place("ωhall", { name: "ωhall" });
const garden = place("ωgarden", { name: "ωgarden" });
const gate = thing("ωgate", { ...door, ...lockable, name: "ωgate", isLocked: true });
connect(hall, { north: { to: garden, via: gate }, east: garden });
connect(garden, { south: hall });
const you = actor("ωyou", { body: { name: "ωyou", location: hall } });
thing("ωlamp", { name: "ωlamp", location: you });
const coin = stackable("ωcoin", { name: "ωcoin" });
const purse = stack("ωpurse", coin, { count: 12, location: hall });
startAs(you);
startClock({ at: "21:00" });
addToHeader("clock");
addToHeader("compass");

const room = (id: string, r: Place, text: string): Passage => {
  registerRoom(r, { id, tags: [`room: ${r.id}`] });
  return {
    id,
    tags: [`room: ${r.id}`],
    effects: { enter: () => enterRoom(r) },
    body: () => [
      {
        type: "text",
        text: `${text} Ωpurse.`,
        links: [
          {
            type: "link",
            label: "Ωpurse",
            target: "Ωpurse",
            guard: menuLink({ thing: purse }),
            start: text.length + 1,
            end: text.length + 7,
          },
        ],
      },
      ...exitLinks(),
    ],
  };
};
const passages = [room("Ωhall", hall, "Ωa-hall."), room("Ωgarden", garden, "Ωa-garden.")];

/**
 * Every message, as its key in marks, so library English can't hide in one.
 * The grammar's parameters and its verbs too: a language package replaces
 * them through the same registries (ADR 0077).
 */
for (const { key } of messages.entries()) {
  messages.replace(key as never, (() => `⟦${key}⟧`) as never);
}
for (const { key } of messageParameters.entries()) {
  messageParameters.replace(key, () => `⟦${key}⟧`);
}
for (const { key } of messageFallbacks.entries()) {
  messageFallbacks.replace(key, () => `⟦${key}⟧`);
}

/** jsdom's page, typed narrowly, since the world model is compiled without DOM types. */
type El = {
  readonly tagName: string;
  readonly className: string;
  readonly textContent: string | null;
  readonly childNodes: ArrayLike<{
    readonly nodeType: number;
    readonly textContent: string | null;
  }>;
  readonly classList: { contains(name: string): boolean };
  getAttribute(name: string): string | null;
  closest(selector: string): El | null;
  querySelectorAll(selector: string): ArrayLike<El>;
  click(): void;
  append(child: El): void;
  dispatchEvent(event: unknown): void;
  replaceChildren(): void;
};
const page = globalThis as unknown as {
  document: { body: El; documentElement: { lang: string }; createElement(tag: string): El };
  KeyboardEvent: new (type: string, init: object) => unknown;
};
const doc = page.document;

/** What's left of a piece of text once the marked messages and the game's own words are taken out. */
const leftover = (text: string): string =>
  text
    .replace(/⟦[^⟧]*⟧/g, " ")
    .replace(/[ωΩ][^\s.,:;!?()]*/g, " ")
    .replace(/[\d\s.,:;!?()×·–—\-…"'“”‘’/]+/g, " ")
    .trim();

/** Every word a player sees or hears, by where it is: text, and accessible names and descriptions. */
function words(root: El): { where: string; text: string }[] {
  const found: { where: string; text: string }[] = [];
  for (const el of Array.from(root.querySelectorAll("*"))) {
    if (el.closest("style, script, [hidden], template")) continue;
    const where = el.tagName.toLowerCase() + (el.className ? `.${el.className}` : "");
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === 3) found.push({ where, text: n.textContent ?? "" });
    }
    for (const attr of [
      "aria-label",
      "aria-description",
      "aria-roledescription",
      "title",
      "placeholder",
      "alt",
    ]) {
      const value = el.getAttribute(attr);
      if (value) found.push({ where: `${where}[${attr}]`, text: value });
    }
  }
  return found;
}

const bypassed = (root: El) =>
  words(root)
    .filter((w) => leftover(w.text) !== "")
    .map((w) => `${w.where}: ${JSON.stringify(w.text)}`);

const players: { destroy(): void }[] = [];
afterEach(() => {
  for (const p of players.splice(0)) p.destroy();
  doc.body.replaceChildren();
});

describe("the pseudo-locale (#60)", () => {
  it("leaves no library English outside the message table, through play and the shell's menus", async () => {
    doc.documentElement.lang = "en";
    const container = doc.createElement("div");
    doc.body.append(container);
    const player = await playGame(container as never, {
      passages,
      start: "Ωhall",
      game: { id: "pseudo", version: "1.0.0" },
      title: "Ωpseudo",
      seed: () => "fixed",
      storage: createMemoryStorage(),
    });
    players.push(player);
    const seen: string[] = [];
    const look = () => {
      seen.push(...bypassed(doc.body));
    };
    const buttons = () => Array.from(doc.body.querySelectorAll("button, [role=menuitem]"));
    const press = (text: string) => {
      const b = buttons().find((x) => x.textContent === text);
      if (!b)
        throw new Error(
          `no ${text} among: ${buttons()
            .map((x) => x.textContent)
            .join(" / ")}`,
        );
      b.click();
    };
    const escape = () => {
      doc.body.dispatchEvent(new page.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      doc.body.click();
    };
    look();
    // A thing's menu, and the form asking how many.
    press("Ωpurse");
    look();
    press("⟦stack.takeSome⟧");
    look();
    escape();
    // Every button in the header and the game menu, opened and looked at in turn.
    for (const label of buttons().map((b) => b.textContent ?? "")) {
      const b = buttons().find((x) => x.textContent === label);
      if (!b || b.closest(".loominate-passage")) continue;
      b.click();
      look();
      escape();
    }
    // Through the locked gate's way, and east to the garden.
    for (const b of buttons().filter((x) => x.textContent === "⟦exit.label⟧")) b.click();
    look();
    expect([...new Set(seen)]).toEqual([]);
  });
});
