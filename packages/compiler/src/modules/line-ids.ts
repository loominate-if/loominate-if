/**
 * Stable line IDs for prose and link labels (#34, ADR 0007).
 *
 * A line is a source paragraph: the content between blank lines, links, and
 * `{continue}`. Its ID is `<passage>:<hash>`, where the hash covers the
 * paragraph's own text and code, so editing other paragraphs never changes it.
 * Text that repeats within a passage gets `-2`, `-3`, … in source order.
 * `{line name}` above a paragraph or link pins its ID to `<passage>:<name>`,
 * so a typo fix doesn't orphan voice or translation files.
 */
import type {
  ContentSyntax,
  DirectiveSyntax,
  LinkSyntax,
  PassageSyntax,
  Span,
} from "../passages/syntax.js";

/** The directive that pins a line's ID. */
export const LINE_DIRECTIVE = "line";

const PIN = /^[A-Za-z0-9_-]+$/;

/** A problem with a `{line}` pin. */
export type LineIdProblem = { readonly message: string; readonly span: Span };

/** The line IDs in one passage. */
export type PassageLines = {
  /**
   * The ID of the source paragraph at `offset`, or undefined where there's no
   * prose. The generator asks at each point where the paragraph can change.
   */
  lineAt(offset: number): string | undefined;
  /** Each link's ID. */
  readonly links: ReadonlyMap<LinkSyntax, string>;
  /** Every ID in the passage, in source order. */
  readonly ids: readonly string[];
  readonly problems: readonly LineIdProblem[];
};

type Segment = {
  /** Where the segment starts; it runs to the next segment's start. */
  readonly start: number;
  /** The paragraph's canonical text, for the hash. */
  text: string;
  /** Offsets of prose in the segment, to see what a pin is above. */
  readonly prose: number[];
  readonly pins: DirectiveSyntax[];
  /** The link that ends the segment, if one does. */
  link?: LinkSyntax;
  id?: string;
};

/** A 6-character base-36 hash of `text`: 64-bit FNV-1a over its UTF-8 bytes. Part of ADR 0007; never change it. */
export function lineHash(text: string): string {
  let h = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) {
    h ^= BigInt(byte);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return (h % 36n ** 6n).toString(36).padStart(6, "0");
}

const squash = (text: string): string => text.replace(/\s+/g, " ").trim();

/** Assigns line IDs to a passage's paragraphs and links. */
export function passageLines(passage: PassageSyntax, source: string): PassageLines {
  const problems: LineIdProblem[] = [];
  const segments: Segment[] = [];
  const open = (start: number): Segment => {
    const s: Segment = { start, text: "", prose: [], pins: [] };
    segments.push(s);
    return s;
  };
  let current = open(passage.header.end);

  const walk = (nodes: readonly ContentSyntax[]): void => {
    for (const n of nodes) {
      switch (n.type) {
        case "text":
          current.text += n.text;
          if (n.text.trim() !== "") current.prose.push(n.span.start);
          break;
        case "print":
          current.text += `{${n.expression.code}}`;
          current.prose.push(n.span.start);
          break;
        case "emphasis": {
          const mark = n.strong ? "**" : "*";
          current.text += mark;
          walk(n.content);
          current.text += mark;
          break;
        }
        case "if":
          for (const [i, b] of n.branches.entries()) {
            current.text += b.condition
              ? `{${i === 0 ? "if" : "else if"} ${b.condition.code}}`
              : "{else}";
            walk(b.content);
          }
          current.text += "{/if}";
          break;
        case "break":
          current = open(n.span.end);
          break;
        case "link":
          current.link = n;
          current = open(n.guard?.span.end ?? n.span.end);
          break;
        case "directive":
          if (n.name === LINE_DIRECTIVE) current.pins.push(n);
          else if (n.name === "continue") current = open(n.span.end);
          // Effect code isn't part of the prose, so editing it keeps the paragraph's ID.
          else if (!n.code) current.text += squash(source.slice(n.span.start, n.span.end));
          break;
      }
    }
  };
  walk(passage.content);

  const name = passage.name.name;
  const links = new Map<LinkSyntax, string>();
  const ids: string[] = [];
  const pinned = new Map<string, DirectiveSyntax>();
  const taken = new Set<string>();
  const counts = new Map<string, number>();
  const unique = (base: string): string => {
    let n = counts.get(base) ?? 0;
    let id: string;
    do {
      n++;
      id = n === 1 ? base : `${base}-${String(n)}`;
    } while (taken.has(id));
    counts.set(base, n);
    taken.add(id);
    return id;
  };

  // Pins first, so hashed IDs can step around them.
  const pinOf = new Map<Segment | LinkSyntax, string>();
  for (const s of segments) {
    for (const d of s.pins) {
      const arg = d.args[0];
      const pin = arg?.type === "positional" && d.args.length === 1 ? arg.value.code : undefined;
      if (pin === undefined || !PIN.test(pin)) {
        problems.push({
          span: d.span,
          message:
            "`{line}` takes one name made of letters, digits, `-`, and `_`, like `{line cellar-drip}`.",
        });
        continue;
      }
      const target: Segment | LinkSyntax | undefined = s.prose.some((p) => p > d.span.start)
        ? s
        : s.link;
      if (target === undefined) {
        problems.push({
          span: d.span,
          message: `\`{line ${pin}}\` names the paragraph or link below it, but there isn't one. Put it on the line above the text it names.`,
        });
        continue;
      }
      if (pinOf.has(target)) {
        problems.push({
          span: d.span,
          message: `This ${target === s ? "paragraph" : "link"} already has \`{line ${pinOf.get(target) ?? ""}}\`. Give it one \`{line}\`.`,
        });
        continue;
      }
      if (pinned.has(pin)) {
        problems.push({
          span: d.span,
          message: `\`{line ${pin}}\` is already used in \`${name}\`. Line names must be unique within a passage.`,
        });
        continue;
      }
      pinned.set(pin, d);
      pinOf.set(target, pin);
      taken.add(`${name}:${pin}`);
    }
  }

  for (const s of segments) {
    if (s.prose.length > 0) {
      const pin = pinOf.get(s);
      s.id = pin !== undefined ? `${name}:${pin}` : unique(`${name}:${lineHash(squash(s.text))}`);
      ids.push(s.id);
    }
    if (s.link) {
      const pin = pinOf.get(s.link);
      const id =
        pin !== undefined
          ? `${name}:${pin}`
          : unique(`${name}:${lineHash(`[[${squash(labelText(s.link.label))}]]`)}`);
      links.set(s.link, id);
      ids.push(id);
    }
  }

  return {
    lineAt(offset) {
      let found: Segment | undefined;
      for (const s of segments) {
        if (s.start > offset) break;
        found = s;
      }
      return found?.id;
    },
    links,
    ids,
    problems,
  };
}

function labelText(nodes: readonly ContentSyntax[]): string {
  return nodes
    .map((n) =>
      n.type === "text"
        ? n.text
        : n.type === "print"
          ? `{${n.expression.code}}`
          : n.type === "emphasis"
            ? `${n.strong ? "**" : "*"}${labelText(n.content)}${n.strong ? "**" : "*"}`
            : "",
    )
    .join("");
}
