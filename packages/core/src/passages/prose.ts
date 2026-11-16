/**
 * Formatted prose: building text nodes with emphasis and strong ranges, and
 * checking ranges that were built by hand.
 */
import type { LineId, TextStyle } from "../events/record.js";
import { StateError } from "../state/value.js";
import type { PassageId, TextNode } from "./story.js";

/** Part of a piece of prose: text, a printed number, or a styled group of parts. */
export type ProsePart = string | number | StyledProse;

/** Parts shown with one style. Made by {@link emphasis} and {@link strong}. */
export type StyledProse = {
  /** The style. */
  readonly style: TextStyle["style"];
  /** What's styled. */
  readonly parts: readonly ProsePart[];
};

/** Options for {@link prose}. */
export type ProseOptions = {
  /** The authored line the prose came from. */
  readonly line?: LineId;
};

/** Shows `parts` with emphasis, from `*emphasis*`. */
export function emphasis(...parts: ProsePart[]): StyledProse {
  return { style: "emphasis", parts };
}

/** Shows `parts` as strong text, from `**strong**`. */
export function strong(...parts: ProsePart[]): StyledProse {
  return { style: "strong", parts };
}

/**
 * Builds a paragraph of prose from parts, turning styled parts into
 * {@link TextStyle} ranges.
 *
 * @remarks
 * A styled part that turns out empty, such as emphasis around a printed value
 * that is `""`, gets no range.
 *
 * @example
 * ```ts
 * prose(["It goes ", emphasis("further"), " than ", strong(depth), " feet."]);
 * // { type: "text", text: "It goes further than 40 feet.", styles: [...] }
 * ```
 */
export function prose(parts: readonly ProsePart[], options: ProseOptions = {}): TextNode {
  let text = "";
  const styles: TextStyle[] = [];
  const add = (part: ProsePart): void => {
    if (typeof part === "string") text += part;
    else if (typeof part === "number") text += String(part);
    else {
      const start = text.length;
      const at = styles.length;
      for (const p of part.parts) add(p);
      // Outer ranges come before the ranges nested inside them.
      if (text.length > start) styles.splice(at, 0, { start, end: text.length, style: part.style });
    }
  };
  for (const part of parts) add(part);
  return {
    type: "text",
    text,
    ...(styles.length > 0 && { styles }),
    ...(options.line !== undefined && { line: options.line }),
  };
}

/**
 * Checks a text node's styles are in bounds, non-empty, and nested properly.
 * @throws {@link StateError} naming the passage and the bad range.
 */
export function checkStyles(passage: PassageId, node: TextNode): void {
  const styles = node.styles ?? [];
  const where = `passage ${JSON.stringify(passage)}`;
  const show = (s: TextStyle): string => `${s.style} ${String(s.start)}–${String(s.end)}`;
  for (const s of styles) {
    if (
      !Number.isInteger(s.start) ||
      !Number.isInteger(s.end) ||
      s.start < 0 ||
      s.end > node.text.length ||
      s.start >= s.end
    ) {
      throw new StateError(
        `${where}: the ${show(s)} style doesn't fit the text ${JSON.stringify(node.text)}. Styles need 0 ≤ start < end ≤ text length.`,
      );
    }
  }
  for (const [i, a] of styles.entries()) {
    for (const b of styles.slice(i + 1)) {
      const disjoint = a.end <= b.start || b.end <= a.start;
      const nested =
        (a.start <= b.start && b.end <= a.end) || (b.start <= a.start && a.end <= b.end);
      if (!disjoint && !nested) {
        throw new StateError(
          `${where}: the ${show(a)} and ${show(b)} styles partly overlap. Styles may nest but not cross.`,
        );
      }
    }
  }
}
