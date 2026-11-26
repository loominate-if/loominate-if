/**
 * The story map (#149, ADR 0123): a game's passages and the ways between
 * them, from the parsed passage files, for the dev server's map page and
 * `loominate map` to lay out and draw. Views are generic, so a package can
 * add its own, as the world model's rooms (#426).
 */
import { locator } from "../passages/positions.js";
import type { ContentSyntax, PassageFileSyntax } from "../passages/syntax.js";

/** A game's map: one or more views, the passages' first. */
export type StoryMap = {
  /** The views, in the order they're offered. */
  readonly views: readonly StoryMapView[];
};

/** One view of the map: places and the ways between them. */
export type StoryMapView = {
  /** A stable name for the view, as `passages`. */
  readonly id: string;
  /** What the view is called where it's offered, as `Passages`. */
  readonly title: string;
  /** The places, in source order. */
  readonly nodes: readonly StoryMapNode[];
  /** The ways between them, in source order. */
  readonly edges: readonly StoryMapEdge[];
};

/** Where something is written: its file, and its line and column there, counting from 1. */
export type StoryMapSource = {
  readonly file: string;
  readonly line: number;
  readonly column: number;
};

/** A place on the map, such as a passage. */
export type StoryMapNode = {
  /** Its id within the view: a passage's name. */
  readonly id: string;
  /** What it's called on the map. */
  readonly label: string;
  /** Where it's defined. Missing for a passage that's linked to but doesn't exist. */
  readonly source?: StoryMapSource;
  /** Its tags, as written: `scene`, `room: hall`. */
  readonly tags: readonly string[];
  /** True for the passage the game starts at. */
  readonly start?: true;
  /** True if nothing leads to it, as the compiler reports. */
  readonly unreachable?: true;
  /** True for a passage that's linked to but doesn't exist. */
  readonly missing?: true;
};

/** A way from one place to another, such as a link. */
export type StoryMapEdge = {
  /** The node it leaves. */
  readonly from: string;
  /** The node it leads to. */
  readonly to: string;
  /** `link`, or the directive that names the target, as `continue`. */
  readonly kind: string;
  /** A link's label, as plain text, when it isn't just the target's name. */
  readonly label?: string;
  /** True if a guard, as `{when …}`, can hide or disable it. */
  readonly guarded?: true;
  /** True if it's inside an `{if}` branch, so it's there only sometimes. */
  readonly conditional?: true;
  /** Where it's written. */
  readonly source: StoryMapSource;
};

/** What {@link passageView} reads about the game, besides its passage files. */
export type PassageViewOptions = {
  /** The passage the game starts at. */
  readonly start?: string;
  /** Guard directives whose links take an action and stay on the passage, as `act`. */
  readonly stays?: ReadonlySet<string>;
  /** Passages the compiler reports as unreachable, by name. */
  readonly unreachable?: ReadonlySet<string>;
};

/** A passage file's parse, with its text, for line numbers. */
export type MappedFile = { readonly parsed: PassageFileSyntax; readonly text: string };

/** The text of a link's label, with printed values as `…`. */
function plainText(content: readonly ContentSyntax[]): string {
  return content
    .map((n) => {
      if (n.type === "text") return n.text;
      if (n.type === "print") return "…";
      if (n.type === "emphasis") return plainText(n.content);
      return "";
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Places in the order a reader meets them: the start, then breadth first
 * along the ways out of each, then any nothing leads to, in source order.
 */
function inReadingOrder(
  nodes: readonly StoryMapNode[],
  edges: readonly StoryMapEdge[],
  start: string | undefined,
): StoryMapNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, readonly string[]>();
  for (const e of edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  const order: StoryMapNode[] = [];
  const placed = new Set<string>();
  const queue = start !== undefined && byId.has(start) ? [start] : [];
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    if (placed.has(id)) continue;
    const node = byId.get(id);
    if (!node) continue;
    placed.add(id);
    order.push(node);
    queue.push(...(out.get(id) ?? []));
  }
  return [...order, ...nodes.filter((n) => !placed.has(n.id))];
}

/** The Passages view: every passage, and every link and passage target between them. */
export function passageView(
  files: readonly MappedFile[],
  options: PassageViewOptions = {},
): StoryMapView {
  const stays = options.stays ?? new Set<string>();
  const nodes: StoryMapNode[] = [];
  const edges: StoryMapEdge[] = [];
  const seen = new Set<string>();
  for (const { parsed, text } of files) {
    const { locate } = locator(text);
    const at = (offset: number): StoryMapSource => ({ file: parsed.file, ...locate(offset) });
    for (const passage of parsed.passages) {
      const name = passage.name.name;
      if (name === "" || seen.has(name)) continue;
      seen.add(name);
      nodes.push({
        id: name,
        label: name,
        source: at(passage.name.span.start),
        tags: passage.tags.map((t) => (t.value === undefined ? t.name : `${t.name}: ${t.value}`)),
        ...(name === options.start && { start: true as const }),
        ...(options.unreachable?.has(name) === true && { unreachable: true as const }),
      });
      const visit = (content: readonly ContentSyntax[], conditional: boolean): void => {
        for (const n of content) {
          if (n.type === "link") {
            // A link that takes an action stays on its passage: it leads nowhere.
            if (!(n.guard && stays.has(n.guard.name))) {
              const label = plainText(n.label);
              edges.push({
                from: name,
                to: n.target.name,
                kind: "link",
                ...(label !== "" && label !== n.target.name && { label }),
                ...(n.guard !== undefined && { guarded: true as const }),
                ...(conditional && { conditional: true as const }),
                source: at(n.span.start),
              });
            }
            visit(n.label, conditional);
          } else if (n.type === "directive") {
            for (const a of n.args) {
              if (a.type !== "target") continue;
              edges.push({
                from: name,
                to: a.target.name,
                kind: n.name,
                ...(conditional && { conditional: true as const }),
                source: at(n.span.start),
              });
            }
          } else if (n.type === "if") {
            for (const b of n.branches) visit(b.content, true);
          } else if (n.type === "emphasis") {
            visit(n.content, conditional);
          }
        }
      };
      visit(passage.content, false);
    }
  }
  // A link to a passage that doesn't exist still shows, to a node marked missing.
  for (const e of edges) {
    if (seen.has(e.to)) continue;
    seen.add(e.to);
    nodes.push({ id: e.to, label: e.to, tags: [], missing: true });
  }
  return {
    id: "passages",
    title: "Passages",
    nodes: inReadingOrder(nodes, edges, options.start),
    edges,
  };
}
