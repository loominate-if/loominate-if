// @vitest-environment jsdom
/** Beats on the page (#41): timed pauses, waits, page breaks, skipping, and pacing. */
import {
  beat,
  createEventRecord,
  createHistory,
  createStore,
  createStory,
  namedEffect,
  pageBreak,
  wait,
  type Passage,
  type StateSnapshot,
} from "@loominate-if/core";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effects } from "./effects.js";
import { mountPage, type PageOptions } from "./page.js";

const passages: Passage[] = [
  {
    id: "Train",
    tags: [],
    body: () => [
      { type: "text", text: "The train slows." },
      beat({ duration: 1500 }),
      namedEffect({ name: ["mark"] }),
      { type: "text", text: "Brakes scream." },
      wait(),
      { type: "text", text: "Silence." },
      { type: "link", label: "Get off", target: "Intro" },
    ],
  },
  {
    id: "Intro",
    tags: [],
    body: () => [
      { type: "text", text: "Page one." },
      pageBreak(),
      { type: "text", text: "Page two." },
      { type: "link", label: "Back", target: "Train" },
    ],
  },
];

let marked: string[];
beforeEach(() => {
  vi.useFakeTimers();
  marked = [];
  effects.register("mark", {
    play: (element) => {
      marked.push(element.textContent);
      return undefined;
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  effects.remove("mark");
});

function play(options: PageOptions = {}, snapshot?: StateSnapshot, start = "Train") {
  const store = createStore(snapshot);
  const record = createEventRecord(store);
  const story = createStory(store, record, passages, { start });
  const history = createHistory(store);
  const moves: string[] = [];
  document.documentElement.lang = "en";
  document.title = "Train";
  document.body.replaceChildren();
  const container = document.createElement("div");
  document.body.append(container);
  const page = mountPage(
    container,
    { story, record },
    {
      ...options,
      onMove: (move) => {
        moves.push(move.type);
        history.checkpoint();
      },
    },
  );
  history.clear();
  store.commit();
  const root = page.element;
  const passage = () => root.querySelector(".loominate-passage") as HTMLElement;
  const shown = () => [...passage().querySelectorAll("p")].map((p) => p.textContent);
  const click = (label: string) => {
    const b = [...root.querySelectorAll<HTMLElement>("a, button")].find(
      (x) => x.textContent === label,
    );
    if (!b) throw new Error(`no button "${label}"`);
    b.click();
  };
  const drawer = () =>
    [...root.querySelectorAll(".loominate-turn")].map((t) =>
      [...t.querySelectorAll("p")].map((p) => p.textContent),
    );
  return { store, story, history, page, root, passage, shown, click, moves, drawer };
}

describe("beats on the page", () => {
  it("wait out a timed pause, then add the next part after what's shown", () => {
    const { story, passage, shown, moves } = play();
    expect(shown()).toEqual(["The train slows.", " Skip"]);
    const first = passage().querySelector("p");
    vi.advanceTimersByTime(1499);
    expect(story.render().step).toBe(0);
    vi.advanceTimersByTime(1);
    expect(shown()).toEqual(["The train slows.", "Brakes scream.", "Continue Skip"]);
    // The first part stays on screen as it was, so it isn't announced again.
    expect(passage().querySelector("p")).toBe(first);
    expect(moves).toEqual(["beat"]);
    // Named effects in the new part play as it appears.
    expect(marked).toEqual(["Brakes scream."]);
  });

  it("wait for the player at {wait}, and move focus to what it revealed, so only that is read", () => {
    const { passage, shown, click } = play();
    vi.advanceTimersByTime(1500);
    vi.advanceTimersByTime(60_000);
    expect(shown().at(-1)).toBe("Continue Skip");
    const next = [...passage().querySelectorAll<HTMLElement>("a, button")].find(
      (b) => b.textContent === "Continue",
    );
    next?.focus();
    click("Continue");
    expect(shown()).toEqual(["The train slows.", "Brakes scream.", "Silence.", "Get off"]);
    // A heading only screen readers see, just before what's new: they read on from it (#352).
    expect(document.activeElement?.textContent).toBe("More");
    expect(document.activeElement?.nextElementSibling?.textContent).toBe("Silence.");
  });

  it("move focus to what's revealed when the player skips, even if the click didn't focus Skip", () => {
    const { passage, click } = play();
    // As on macOS, where clicking a button doesn't focus it.
    (document.activeElement as HTMLElement | null)?.blur();
    click("Skip");
    expect(document.activeElement?.textContent).toBe("More");
    expect(document.activeElement?.nextElementSibling?.textContent).toBe("Brakes scream.");
    expect(passage().contains(document.activeElement)).toBe(true);
  });

  it("leave focus alone when a timed pause passes while the player is elsewhere, and read what's new", () => {
    const { passage } = play();
    (document.activeElement as HTMLElement | null)?.blur();
    vi.advanceTimersByTime(1500);
    expect(passage().contains(document.activeElement)).toBe(false);
    // The passage isn't a live region; a separate one reads only the new part.
    const live = document.querySelector(".loominate-announce");
    expect([live?.getAttribute("aria-live"), live?.textContent]).toEqual([
      "polite",
      "Brakes scream.",
    ]);
  });

  it("hurry a timed pause when the player clicks the page", () => {
    const { story, passage } = play();
    passage().querySelector("p")?.click();
    expect(story.render().step).toBe(1);
  });

  it("skip every remaining beat at once, without their effects", () => {
    const { story, shown, click, moves } = play();
    click("Skip");
    expect(shown()).toEqual(["The train slows.", "Brakes scream.", "Silence.", "Get off"]);
    expect(moves).toEqual(["beat", "beat"]);
    expect(story.actions.map((a) => a.type)).toEqual(["advance", "advance"]);
    expect(marked).toEqual([]);
    vi.advanceTimersByTime(10_000);
    expect(story.render().step).toBe(2);
  });

  it("clear the screen at a page break, keeping earlier pages in the story so far", () => {
    const { shown, click, drawer } = play({}, undefined, "Intro");
    expect(shown()).toEqual(["Page one.", "Continue Skip"]);
    click("Continue");
    expect(shown()).toEqual(["Page two.", "Back"]);
    expect(drawer()).toEqual([["Page one."]]);
  });

  it("move past timed beats at once when pacing is immediate, but still wait at {wait}", () => {
    const { story, shown } = play({ pacing: "immediate" });
    expect(story.render().step).toBe(1);
    expect(shown()).toEqual(["The train slows.", "Brakes scream.", "Continue Skip"]);
  });

  it("do the same when the player prefers reduced motion", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const { story } = play();
    expect(story.render().step).toBe(1);
  });

  it("stop at beat boundaries on undo, without moving on again by themselves", () => {
    const { story, history, page, shown, click } = play(
      { pacing: "immediate" },
      undefined,
      "Intro",
    );
    click("Continue");
    click("Back");
    expect(story.render().step).toBe(1);
    history.undo();
    page.refresh();
    expect(story.render().step).toBe(0);
    // Undo isn't arriving, so the pause waits for the player.
    expect(shown()).toEqual(["The train slows.", "Continue Skip"]);
  });

  it("restore a game saved at a beat boundary", () => {
    const { store } = play();
    vi.advanceTimersByTime(1500);
    const saved = store.snapshot();
    const loaded = play({}, saved);
    expect(loaded.shown()).toEqual(["The train slows.", "Brakes scream.", "Continue Skip"]);
    expect(marked).toEqual(["Brakes scream."]);
    loaded.click("Continue");
    expect(loaded.shown().at(-1)).toBe("Get off");
  });

  it("pass automated accessibility checks while waiting", async () => {
    vi.useRealTimers();
    play();
    const results = await axe.run(document, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html}`))).toEqual([]);
  });
});
