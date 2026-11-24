/**
 * Prose as components: a paragraph's text with its emphasis, strong ranges,
 * and inline links turned into nested elements. Ranges nest properly (core
 * checks them), so they can be built as a tree.
 */
import type { RenderedInlineLink, TextStyle } from "@loominate-if/core";
import type { ComponentChildren } from "preact";

type Range =
  | { readonly start: number; readonly end: number; readonly style: TextStyle["style"] }
  | { readonly start: number; readonly end: number; readonly link: RenderedInlineLink };

/**
 * `text`, with styled ranges in `<em>` and `<strong>`, and inline links as
 * whatever `link` makes of each.
 */
export function prose(
  text: string,
  styles: readonly TextStyle[],
  links: readonly RenderedInlineLink[],
  link: (link: RenderedInlineLink, label: ComponentChildren, key: number) => ComponentChildren,
): ComponentChildren[] {
  const ranges: Range[] = [
    ...styles.map((s) => ({ start: s.start, end: s.end, style: s.style })),
    ...links.map((l) => ({ start: l.start, end: l.end, link: l })),
  ].sort((a, b) => a.start - b.start || b.end - a.end || ("link" in a ? -1 : 1));

  let next = 0;
  /** Builds `from`…`to`, consuming the ranges that start inside it. */
  const build = (from: number, to: number): ComponentChildren[] => {
    const out: ComponentChildren[] = [];
    let at = from;
    while (next < ranges.length) {
      const r = ranges[next];
      if (!r || r.start >= to) break;
      const key = next++;
      if (r.start > at) out.push(text.slice(at, r.start));
      const inner = build(r.start, Math.min(r.end, to));
      if ("link" in r) out.push(link(r.link, inner, key));
      else if (r.style === "strong") out.push(<strong key={key}>{inner}</strong>);
      else out.push(<em key={key}>{inner}</em>);
      at = Math.min(r.end, to);
    }
    if (at < to) out.push(text.slice(at, to));
    return out;
  };
  return build(0, text.length);
}
