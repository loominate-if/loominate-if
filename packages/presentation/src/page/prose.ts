/**
 * Prose as DOM: a paragraph's text with its emphasis, strong ranges, and
 * inline links turned into nested elements. Ranges nest properly (core checks
 * them), so they can be built as a tree.
 */
import type { RenderedInlineLink, TextStyle } from "@loominate-if/core";

type Range =
  | { readonly start: number; readonly end: number; readonly style: TextStyle["style"] }
  | { readonly start: number; readonly end: number; readonly link: RenderedInlineLink };

/**
 * Appends `text` to `parent`, wrapping styled ranges in `<em>`/`<strong>` and
 * inline links in whatever `link` makes for each.
 */
export function appendProse(
  parent: HTMLElement,
  text: string,
  styles: readonly TextStyle[],
  links: readonly RenderedInlineLink[],
  link: (link: RenderedInlineLink, label: Node[]) => HTMLElement,
): void {
  const doc = parent.ownerDocument;
  const ranges: Range[] = [
    ...styles.map((s) => ({ start: s.start, end: s.end, style: s.style })),
    ...links.map((l) => ({ start: l.start, end: l.end, link: l })),
  ].sort((a, b) => a.start - b.start || b.end - a.end || ("link" in a ? -1 : 1));

  let next = 0;
  /** Builds `from`…`to`, consuming the ranges that start inside it. */
  const build = (from: number, to: number): Node[] => {
    const out: Node[] = [];
    let at = from;
    while (next < ranges.length) {
      const r = ranges[next];
      if (!r || r.start >= to) break;
      next++;
      if (r.start > at) out.push(doc.createTextNode(text.slice(at, r.start)));
      const inner = build(r.start, Math.min(r.end, to));
      if ("link" in r) {
        out.push(link(r.link, inner));
      } else {
        const el = doc.createElement(r.style === "strong" ? "strong" : "em");
        el.append(...inner);
        out.push(el);
      }
      at = Math.min(r.end, to);
    }
    if (at < to) out.push(doc.createTextNode(text.slice(at, to)));
    return out;
  };
  parent.append(...build(0, text.length));
}
