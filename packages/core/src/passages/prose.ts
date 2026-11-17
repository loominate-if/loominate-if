/**
 * Formatted prose: building text nodes with emphasis and strong ranges, and
 * checking ranges that were built by hand.
 */
import type { LineId, TextStyle } from "../events/record.js";
import { StateError } from "../state/value.js";
import type { InlineLink, LinkNode, PassageId, TextNode } from "./story.js";

/**
 * Part of a piece of prose: text, a printed number, a styled group of parts, or
 * a link whose label reads as part of the sentence.
 */
export type ProsePart = string | number | StyledProse | LinkNode;

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
 * {@link TextStyle} ranges and links into {@link InlineLink}s.
 *
 * @remarks
 * A styled part that turns out empty, such as emphasis around a printed value
 * that is `""`, gets no range. A link's label is added to the text.
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
  const links: InlineLink[] = [];
  const add = (part: ProsePart): void => {
    if (typeof part === "string") text += part;
    else if (typeof part === "number") text += String(part);
    else if ("type" in part) {
      const start = text.length;
      text += part.label;
      links.push({ ...part, start, end: text.length });
    } else {
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
    ...(links.length > 0 && { links }),
  };
}

/**
 * Checks a text node's inline links are in bounds, non-empty, in order, match
 * their labels, and don't cross its styles.
 * @throws {@link StateError} naming the passage and the bad link.
 */
export function checkInlineLinks(passage: PassageId, node: TextNode): void {
  const where = `passage ${JSON.stringify(passage)}`;
  let after = 0;
  for (const l of node.links ?? []) {
    const name = `link ${JSON.stringify(l.label)} at ${String(l.start)}–${String(l.end)}`;
    if (
      !Number.isInteger(l.start) ||
      !Number.isInteger(l.end) ||
      l.start < after ||
      l.end > node.text.length ||
      l.start >= l.end
    ) {
      throw new StateError(
        `${where}: the ${name} doesn't fit the text ${JSON.stringify(node.text)}. Inline links need 0 ≤ start < end ≤ text length, in order, without overlapping.`,
      );
    }
    if (node.text.slice(l.start, l.end) !== l.label) {
      throw new StateError(
        `${where}: the ${name} covers ${JSON.stringify(node.text.slice(l.start, l.end))}, not its label. An inline link's label is the text it covers.`,
      );
    }
    for (const s of node.styles ?? []) {
      const disjoint = s.end <= l.start || l.end <= s.start;
      const nested =
        (s.start <= l.start && l.end <= s.end) || (l.start <= s.start && s.end <= l.end);
      if (!disjoint && !nested) {
        throw new StateError(
          `${where}: the ${name} and the ${s.style} ${String(s.start)}–${String(s.end)} style partly overlap. A style may contain a link or sit inside its label, but not cross it.`,
        );
      }
    }
    after = l.end;
  }
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
