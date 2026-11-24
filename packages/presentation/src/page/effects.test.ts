// @vitest-environment jsdom
/** Named effects on the page (#42). jsdom has no Web Animations, so `animate` is a stand-in. */
import {
  createEventRecord,
  createHistory,
  createStore,
  createStory,
  namedEffect,
  type Passage,
} from "@loominate-if/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effects, type EffectDefinition } from "./effects.js";
import { mountPage } from "./page.js";

const passages: Passage[] = [
  {
    id: "Door",
    tags: [],
    body: () => [
      namedEffect({ name: ["shake"] }),
      namedEffect({ name: ["fade"], duration: 300 }),
      { type: "text", text: "The door bursts open." },
      { type: "link", label: "Hide", target: "Closet" },
    ],
  },
  {
    id: "Closet",
    tags: [],
    body: () => [
      namedEffect({ name: ["typewriter"], duration: 100 }),
      { type: "text", text: "Who's there?" },
      { type: "continue", target: "Door" },
      namedEffect({ name: ["fade"] }),
    ],
  },
];

type Played = { element: Element; keyframes: Keyframe[]; options: KeyframeAnimationOptions };
let played: Played[];
let finished: Element[];
beforeEach(() => {
  played = [];
  finished = [];
  const animate = function (
    this: HTMLElement,
    keyframes: Keyframe[],
    options: KeyframeAnimationOptions,
  ): Animation {
    played.push({ element: this, keyframes, options });
    return {
      finish: () => {
        finished.push(this);
      },
    } as unknown as Animation;
  };
  Object.defineProperty(HTMLElement.prototype, "animate", { value: animate, configurable: true });
});

const cleanup: (() => void)[] = [];
afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "animate");
  vi.unstubAllGlobals();
  for (const undo of cleanup.splice(0).reverse()) undo();
});

/** The player's motion preference, through a stand-in for matchMedia. */
function prefersReducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(prefers-reduced-motion: reduce)" && reduce,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

function play(extra: Passage[] = [], start = "Door") {
  const store = createStore();
  const record = createEventRecord(store);
  const story = createStory(store, record, [...passages, ...extra], { start });
  const history = createHistory(store);
  document.body.replaceChildren();
  const container = document.createElement("div");
  document.body.append(container);
  const page = mountPage(container, { story, record }, { onMove: () => history.checkpoint() });
  history.checkpoint();
  const root = page.element;
  const passage = () => root.querySelector(".loominate-passage") as HTMLElement;
  const click = (label: string) => {
    const b = [...root.querySelectorAll<HTMLElement>("a, button")].find(
      (x) => x.textContent === label,
    );
    if (!b) throw new Error(`no button "${label}"`);
    b.click();
  };
  return { store, record, story, history, page, root, passage, click };
}

const describeEl = (e: Element): string =>
  e.classList.contains("loominate-page")
    ? "page"
    : e.classList.contains("loominate-typewriter")
      ? `letter ${e.textContent ?? ""}`
      : `${e.tagName.toLowerCase()} ${e.textContent ?? ""}`;

describe("named effects", () => {
  it("play when a story starts on the page: shake on the page, fade on what follows", () => {
    play();
    expect(played.map((p) => describeEl(p.element))).toEqual(["page", "p The door bursts open."]);
    expect(played[1]?.options.duration).toBe(300);
    expect(played[1]?.keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
  });

  it("type text out with the whole of it already there for screen readers", () => {
    const { passage, click } = play();
    played = [];
    click("Hide");
    const paragraph = passage().querySelector("p");
    expect(paragraph?.textContent).toBe("Who's there?");
    const letters = played.filter((p) => describeEl(p.element).startsWith("letter"));
    expect(letters.map((p) => p.element.textContent).join("")).toBe("Who'sthere?");
    expect(letters.map((p) => p.options.delay)).toEqual(
      [...Array(11).keys()].map((i) => i * (100 / 11)),
    );
    expect(letters.every((p) => p.options.fill === "backwards")).toBe(true);
    // An effect with nothing after it has nothing to play on.
    expect(played).toHaveLength(11);
  });

  it("finish when the player clicks or presses a key, and before the next move", () => {
    const { root, passage, click } = play();
    root.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
    expect(finished.map(describeEl)).toEqual(["page", "p The door bursts open."]);
    finished = [];
    root.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
    expect(finished).toEqual([]);
    click("Hide");
    passage().querySelector("p")?.click();
    expect(finished).toHaveLength(11);
  });

  it("don't play again after undo, a refresh, or loading a save", () => {
    const { store, history, page, click } = play();
    click("Hide");
    played = [];
    history.undo();
    page.refresh();
    expect(played).toEqual([]);
    const loaded = createStore(store.snapshot());
    const record = createEventRecord(loaded);
    const story = createStory(loaded, record, passages, { start: "Door" });
    mountPage(document.body, { story, record });
    expect(story.current).toBe("Door");
    expect(played).toEqual([]);
  });

  it("are skipped when the player prefers reduced motion, unless they have a reduced variant", () => {
    prefersReducedMotion(true);
    const reduced = vi.fn<NonNullable<EffectDefinition["reduced"]>>(() => undefined);
    effects.register("flash", { target: "page", play: () => undefined, reduced });
    cleanup.push(() => {
      effects.remove("flash");
    });
    const { root } = play(
      [
        {
          id: "Bang",
          tags: [],
          body: () => [namedEffect({ name: ["flash"] }), namedEffect({ name: ["shake"] })],
        },
      ],
      "Bang",
    );
    expect(played).toEqual([]);
    expect(reduced).toHaveBeenCalledWith(root, { options: {}, page: root });
  });

  it("play with full motion when the player hasn't asked for less", () => {
    prefersReducedMotion(false);
    play();
    expect(played).toHaveLength(2);
  });

  it("can be registered, and get their duration, options, and page", () => {
    const glow = vi.fn<EffectDefinition["play"]>(() => undefined);
    effects.register("glow", { play: glow });
    cleanup.push(() => {
      effects.remove("glow");
    });
    const { root } = play(
      [
        {
          id: "Lamp",
          tags: [],
          body: () => [
            namedEffect({ name: ["glow"], duration: 800, options: { color: "gold" } }),
            { type: "link", label: "Touch it", target: "Door" },
          ],
        },
      ],
      "Lamp",
    );
    const [element, context] = glow.mock.calls[0] ?? [];
    expect(element?.className).toBe("loominate-choice");
    expect(context).toEqual({ duration: 800, options: { color: "gold" }, page: root });
  });

  it("run the guide's glow example", () => {
    {
      // #region glow-effect: shown in docs/guide/effects.md, kept in step by scripts/docs.test.ts
      effects.register("glow", {
        play(element, { duration = 800, options }) {
          const color = typeof options.color === "string" ? options.color : "gold";
          const glow = element.animate(
            [{ textShadow: `0 0 0.5em ${color}` }, { textShadow: "none" }],
            { duration },
          );
          return () => glow.finish();
        },
      });
      // #endregion
    }
    cleanup.push(() => {
      effects.remove("glow");
    });
    const { root } = play(
      [
        {
          id: "Lamp",
          tags: [],
          body: () => [
            namedEffect({ name: ["glow"], options: { color: "red" } }),
            { type: "text", text: "It glows." },
          ],
        },
      ],
      "Lamp",
    );
    expect(played.map((p) => [describeEl(p.element), p.keyframes[0], p.options])).toEqual([
      ["p It glows.", { textShadow: "0 0 0.5em red" }, { duration: 800 }],
    ]);
    root.click();
    expect(finished.map(describeEl)).toEqual(["p It glows."]);
  });

  it("explain an effect that isn't registered", () => {
    expect(() =>
      play([{ id: "Odd", tags: [], body: () => [namedEffect({ name: ["wobble"] })] }], "Odd"),
    ).toThrow(
      'The effect "wobble" isn\'t registered. Register it with effects.register("wobble", { play(element) { … } }), or use one that is: fade, typewriter, shake.',
    );
  });
});
