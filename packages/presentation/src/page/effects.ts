/**
 * Named effects (#42, ADR 0020): fades, typewriter text, and shakes that a
 * passage asks for with `{effect name}`. Core puts a named-effect node in the
 * rendered passage; the page looks the name up here and plays it on what
 * follows, or on the whole page.
 *
 * Effects are presentation only. They play when the player arrives at a
 * passage, never after undo or loading, and a click or key press finishes them.
 * When the player prefers reduced motion, an effect is skipped unless it has a
 * `reduced` variant.
 */
import { registry, type Registry } from "@loominate-if/core";

/** What an effect is told when it plays. */
export type EffectPlayContext = {
  /** How long the passage asked it to take, in milliseconds, if it said. */
  readonly duration?: number;
  /** Further settings from the passage's `options:`, or `{}`. */
  readonly options: Readonly<Record<string, unknown>>;
  /** The page's root element. */
  readonly page: HTMLElement;
};

/**
 * Ends an effect at once, in its finished state. The page calls it when the
 * player clicks or presses a key, and before the next move. It may be called
 * after the effect has already ended on its own, so it must be safe to repeat.
 */
export type EffectFinish = () => void;

/** A named effect. */
export type EffectDefinition = {
  /**
   * What it plays on: `next`, the element drawn for the passage's next
   * paragraph, link, or continue point (the default); or `page`, the page's
   * root element.
   */
  readonly target?: "next" | "page";
  /** Plays the effect on `element`. Returns how to finish it early, if it takes time. */
  readonly play: (element: HTMLElement, context: EffectPlayContext) => EffectFinish | undefined;
  /**
   * What to play instead when the player prefers reduced motion, such as a
   * brief highlight in place of a shake. Without it, the effect is skipped.
   */
  readonly reduced?: (element: HTMLElement, context: EffectPlayContext) => EffectFinish | undefined;
};

/**
 * Effects by name: `fade`, `typewriter`, and `shake` are registered by
 * default. Register your own and use it with `{effect name}`.
 *
 * @example
 * ```ts
 * effects.register("glow", {
 *   play(element, { duration = 800 }) {
 *     const glow = element.animate(
 *       [{ textShadow: "0 0 0.5em gold" }, { textShadow: "none" }],
 *       { duration },
 *     );
 *     return () => glow.finish();
 *   },
 * });
 * ```
 */
export const effects: Registry<EffectDefinition> = registry<EffectDefinition>("effects");

/** Runs a Web Animation, if the browser has them, returning how to finish it. */
function animate(
  element: HTMLElement,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
): EffectFinish | undefined {
  if (typeof element.animate !== "function") return undefined;
  const animation = element.animate(keyframes, options);
  return () => {
    animation.finish();
  };
}

/** Fades what follows in. */
const fade: EffectDefinition = {
  play: (element, { duration = 600 }) =>
    animate(element, [{ opacity: 0 }, { opacity: 1 }], { duration, easing: "ease-out" }),
};

/**
 * Types what follows out a character at a time. The text is in the document
 * from the start, only transparent, so screen readers announce it whole.
 */
const typewriter: EffectDefinition = {
  play(element, { duration }) {
    const doc = element.ownerDocument;
    const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);
    const letters: HTMLElement[] = [];
    for (const text of texts) {
      const parts = [...text.data].map((ch) => {
        if (/\s/.test(ch)) return doc.createTextNode(ch);
        const span = doc.createElement("span");
        span.className = "loominate-typewriter";
        span.textContent = ch;
        letters.push(span);
        return span;
      });
      text.replaceWith(...parts);
    }
    if (letters.length === 0) return undefined;
    const step = (duration ?? letters.length * 30) / letters.length;
    const finishes = letters.flatMap((span, i) => {
      const finish = animate(span, [{ opacity: 0 }, { opacity: 1 }], {
        duration: 1,
        delay: i * step,
        fill: "backwards",
      });
      return finish ? [finish] : [];
    });
    return () => {
      for (const finish of finishes) finish();
    };
  },
};

/** Shakes the whole page. */
const shake: EffectDefinition = {
  target: "page",
  play: (page, { duration = 400 }) =>
    animate(
      page,
      [
        { transform: "translateX(0)" },
        { transform: "translateX(-0.5rem)" },
        { transform: "translateX(0.5rem)" },
        { transform: "translateX(-0.25rem)" },
        { transform: "translateX(0)" },
      ],
      { duration },
    ),
};

const SOURCE = "@loominate-if/presentation";
effects.register("fade", fade, { source: SOURCE });
effects.register("typewriter", typewriter, { source: SOURCE });
effects.register("shake", shake, { source: SOURCE });
