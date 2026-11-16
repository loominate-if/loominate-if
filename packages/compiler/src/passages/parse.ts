/**
 * The passage file parser (ADR 0004).
 *
 * Parsing runs in two steps per passage body. The tokenizer turns characters
 * into items (text, asterisk runs, link markers, and classified `{…}`) grouped
 * by source line. The builder then walks the lines, joining soft line breaks
 * into spaces, turning blank lines into paragraph breaks, and nesting
 * emphasis, links, and `{if}` blocks. Both keep going after an error, so one
 * mistake doesn't hide the rest.
 */
import { matchBrace, splitTopLevel } from "./code-scan.js";
import { locator } from "./positions.js";
import {
  coreDirectives,
  directiveMatchers,
  type DirectiveMatcher,
  type DirectiveSpec,
} from "./directives.js";
import type {
  ArgumentSyntax,
  CodeSyntax,
  ContentSyntax,
  Diagnostic,
  DirectiveSyntax,
  IfBranch,
  LinkSyntax,
  NameSyntax,
  PassageFileSyntax,
  PassageSyntax,
  PrintSyntax,
  Span,
  TagSyntax,
  TextSyntax,
} from "./syntax.js";

/** Options for {@link parsePassageFile}. */
export type ParseOptions = {
  /** The file's name, recorded on the result. Defaults to `"<passages>"`. */
  readonly file?: string;
  /**
   * The directives to recognize. Defaults to {@link coreDirectives}; to add a
   * package's directives, pass them along with the core ones.
   */
  readonly directives?: readonly DirectiveSpec[];
};

type Item =
  | { k: "text"; text: string; start: number; end: number }
  | { k: "stars"; n: number; left: boolean; right: boolean; start: number; end: number }
  | { k: "linkOpen" | "arrow" | "linkClose"; start: number; end: number }
  | { k: "print"; node: PrintSyntax; start: number; end: number }
  | { k: "directive"; node: DirectiveSyntax; start: number; end: number }
  | { k: "if" | "elseIf"; condition: CodeSyntax; start: number; end: number }
  | { k: "else" | "endIf"; start: number; end: number };

type Line = { items: Item[]; start: number; end: number; comment: boolean };

type Mutable<T> = { -readonly [P in keyof T]: T[P] };
type BranchDraft = Mutable<IfBranch> & { content: ContentSyntax[] };
type IfDraft = { type: "if"; branches: BranchDraft[]; span: Mutable<Span> };
type LinkDraft = Mutable<LinkSyntax>;

type Frame =
  | { t: "root"; nodes: ContentSyntax[] }
  | { t: "branch"; nodes: ContentSyntax[]; draft: IfDraft; hasElse: boolean }
  | { t: "emphasis"; nodes: ContentSyntax[]; strong: boolean; open: Span }
  | { t: "link"; nodes: ContentSyntax[]; open: Span; arrow?: Span; badTarget?: boolean };

/** ASCII punctuation, which a backslash makes literal. */
const PUNCTUATION = /^[!-/:-@[-`{-~]$/;
const NAMED_ARGUMENT = /^([A-Za-z_$][\w$]*)\s*:(?!:)/;
const SPACE = /\s/;
const BAD_NAME_CHARACTER = /[[\]{}\\]/;

/**
 * Parses a passage file into a syntax tree with source positions.
 *
 * @remarks
 * Errors don't stop the parse: they're collected in
 * {@link PassageFileSyntax.diagnostics}, and the tree is built around them.
 *
 * @throws Error if `options.directives` is malformed: a bad or reserved name,
 * or the same name twice.
 */
export function parsePassageFile(source: string, options: ParseOptions = {}): PassageFileSyntax {
  const file = options.file ?? "<passages>";
  const matchers = directiveMatchers(options.directives ?? coreDirectives);
  const diagnostics: Diagnostic[] = [];

  const lines = locator(source);
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") lineStarts.push(i + 1);

  function error(message: string, start: number, end = start + 1): void {
    diagnostics.push(lines.error(message, start, end));
  }

  /** End of the line containing `i`, before any `\r\n` or `\n`, but no further than `limit`. */
  function lineEnd(i: number, limit: number): number {
    const nl = source.indexOf("\n", i);
    const end = nl < 0 || nl > limit ? limit : nl;
    return end > i && source[end - 1] === "\r" ? end - 1 : end;
  }

  /** `start`…`end` with surrounding whitespace removed. */
  function trimmed(start: number, end: number): { text: string; span: Span } {
    while (start < end && SPACE.test(source[start] ?? "")) start++;
    while (end > start && SPACE.test(source[end - 1] ?? "")) end--;
    return { text: source.slice(start, end), span: { start, end } };
  }

  function code(start: number, end: number): CodeSyntax {
    const { text, span } = trimmed(start, end);
    return { code: text, span };
  }

  function checkName(name: NameSyntax, what: string): void {
    if (name.name === "") {
      error(`${what} has no passage name.`, name.span.start, name.span.end);
      return;
    }
    const bad = BAD_NAME_CHARACTER.exec(name.name)?.[0] ?? (name.name.includes("->") ? "->" : "");
    if (bad !== "") {
      error(
        `Passage names can't contain \`${bad}\`, but "${name.name}" does. Rename the passage.`,
        name.span.start,
        name.span.end,
      );
    }
  }

  // ---- Passage headers -----------------------------------------------------

  function parseHeader(start: number, end: number): { name: NameSyntax; tags: TagSyntax[] } {
    const open = source.indexOf("[", start + 2);
    const nameEnd = open < 0 || open >= end ? end : open;
    const raw = trimmed(start + 2, nameEnd);
    const name = { name: raw.text, span: raw.span };
    if (name.name === "") {
      error("This passage has no name. Write one after `::`, like `:: Cellar`.", start, end);
    } else {
      checkName(name, "This header");
    }
    const tags: TagSyntax[] = [];
    if (nameEnd === end) return { name, tags };

    const close = source.indexOf("]", open);
    if (close < 0 || close >= end) {
      error("The tag list isn't closed. End it with `]`.", open, end);
      return { name, tags };
    }
    const after = trimmed(close + 1, end);
    if (after.text !== "") {
      error(
        "Nothing can follow the tag list in a passage header. Move it to the next line.",
        after.span.start,
        after.span.end,
      );
    }
    if (trimmed(open + 1, close).text === "") return { name, tags };

    let from = open + 1;
    for (const comma of [...commas(open + 1, close), close]) {
      const tag = trimmed(from, comma);
      from = comma + 1;
      if (tag.text === "") {
        error("This tag is empty. Remove the extra comma.", Math.min(comma, close - 1), comma + 1);
        continue;
      }
      const colon = tag.text.indexOf(":");
      if (colon < 0) {
        tags.push({ name: tag.text, span: tag.span });
        continue;
      }
      const key = tag.text.slice(0, colon).trim();
      const value = tag.text.slice(colon + 1).trim();
      if (key === "" || value === "") {
        error(
          `The tag "${tag.text}" needs a role and a value, like \`room: platform\`.`,
          tag.span.start,
          tag.span.end,
        );
        continue;
      }
      tags.push({ name: key, value, span: tag.span });
    }
    return { name, tags };
  }

  function commas(start: number, end: number): number[] {
    const out: number[] = [];
    for (let i = source.indexOf(",", start); i >= 0 && i < end; i = source.indexOf(",", i + 1)) {
      out.push(i);
    }
    return out;
  }

  // ---- `{…}` -------------------------------------------------------------

  /** If `words` start at `at`, returns where they end; they must be followed by a separator. */
  function matchWords(
    words: readonly string[],
    at: number,
    end: number,
    allowParen = false,
  ): number | undefined {
    let i = at;
    for (const [n, word] of words.entries()) {
      if (n > 0) {
        const before = i;
        while (i < end && SPACE.test(source[i] ?? "")) i++;
        if (i === before) return undefined;
      }
      if (!source.startsWith(word, i)) return undefined;
      i += word.length;
    }
    if (i === end) return i;
    const next = source[i] ?? "";
    if (SPACE.test(next) || next === "," || next === ":" || (allowParen && next === "(")) return i;
    return undefined;
  }

  function parseArguments(start: number, end: number): ArgumentSyntax[] {
    if (trimmed(start, end).text === "") return [];
    const args: ArgumentSyntax[] = [];
    for (const [from, to] of splitTopLevel(source, start, end)) {
      const { text, span } = trimmed(from, to);
      if (text === "") {
        error("This argument is empty. Remove the extra comma.", Math.max(from - 1, 0), to);
        continue;
      }
      if (text.startsWith("->")) {
        const raw = trimmed(span.start + 2, span.end);
        const target = { name: raw.text, span: raw.span };
        if (target.name === "") error("`->` needs a passage name after it.", span.start, span.end);
        else checkName(target, "This target");
        args.push({ type: "target", target, span });
        continue;
      }
      const named = NAMED_ARGUMENT.exec(text);
      if (named) {
        const key = named[1] ?? "";
        const value = code(span.start + named[0].length, span.end);
        if (value.code === "") {
          error(`\`${key}:\` needs a value after it.`, span.start, span.end);
        }
        args.push({
          type: "named",
          key: { name: key, span: { start: span.start, end: span.start + key.length } },
          value,
          span,
        });
        continue;
      }
      args.push({ type: "positional", value: { code: text, span }, span });
    }
    return args;
  }

  function classify(open: number, close: number): Item | undefined {
    const span = { start: open, end: close + 1 };
    const inner = trimmed(open + 1, close);
    const at = inner.span.start;
    const end = inner.span.end;
    if (inner.text === "") {
      error("Empty braces do nothing. Write `\\{\\}` for literal braces.", open, close + 1);
      return undefined;
    }
    if (source[at] === "/") {
      if (trimmed(at + 1, end).text === "if") return { k: "endIf", ...span };
      error(`\`{${inner.text}}\` closes nothing. Only \`{/if}\` closes a block.`, open, close + 1);
      return undefined;
    }

    const afterElseIf = matchWords(["else", "if"], at, end, true);
    if (afterElseIf !== undefined) {
      const condition = code(afterElseIf, end);
      if (condition.code === "") {
        error("`{else if}` needs a condition, like `{else if door.isOpen}`.", open, close + 1);
      }
      return { k: "elseIf", condition, ...span };
    }
    const afterElse = matchWords(["else"], at, end);
    if (afterElse !== undefined) {
      if (afterElse !== end) {
        error("`{else}` doesn't take a condition. Did you mean `{else if …}`?", open, close + 1);
      }
      return { k: "else", ...span };
    }
    const afterIf = matchWords(["if"], at, end, true);
    if (afterIf !== undefined) {
      const condition = code(afterIf, end);
      if (condition.code === "") {
        error("`{if}` needs a condition, like `{if lantern.isLit}`.", open, close + 1);
      }
      return { k: "if", condition, ...span };
    }

    for (const matcher of matchers) {
      const nameEnd = matchWords(matcher.words, at, end);
      if (nameEnd !== undefined) return directive(matcher, at, nameEnd, end, span);
    }

    const node: PrintSyntax = { type: "print", expression: code(at, end), span };
    return { k: "print", node, ...span };
  }

  function directive(
    matcher: DirectiveMatcher,
    at: number,
    nameEnd: number,
    end: number,
    span: Span,
  ): Item {
    const { name } = matcher.spec;
    const nameSpan = { start: at, end: nameEnd };
    const colon = source[nameEnd] === ":";
    let node: DirectiveSyntax;
    if (matcher.spec.code === true) {
      if (!colon) {
        error(`\`${name}\` takes code after a colon, like \`{${name}: …}\`.`, span.start, span.end);
      }
      const body = code(colon ? nameEnd + 1 : nameEnd, end);
      if (colon && body.code === "") {
        error(`\`{${name}:}\` has no code after the colon.`, span.start, span.end);
      }
      node = { type: "directive", name, nameSpan, args: [], code: body, span };
    } else {
      if (colon) {
        error(
          `\`${name}\` takes arguments, not code. Remove the colon: \`{${name} …}\`.`,
          nameEnd,
          nameEnd + 1,
        );
      }
      const args = parseArguments(colon ? nameEnd + 1 : nameEnd, end);
      node = { type: "directive", name, nameSpan, args, span };
    }
    return { k: "directive", node, ...span };
  }

  // ---- Tokenizer -----------------------------------------------------------

  /** The `}` of a closing directive such as `{/if}`, on the same line. */
  function closingBrace(open: number, end: number): number | undefined {
    const close = source.indexOf("}", open);
    return close < 0 || close >= lineEnd(open, end) ? undefined : close;
  }

  function tokenize(start: number, end: number): Line[] {
    const lines: Line[] = [];
    let line: Line = { items: [], start, end, comment: false };
    let atLineStart = true;
    let inLink = false;
    let i = start;

    const text = (t: string, s: number, e: number): void => {
      const last = line.items.at(-1);
      if (last?.k === "text" && last.end === s) {
        last.text += t;
        last.end = e;
      } else {
        line.items.push({ k: "text", text: t, start: s, end: e });
      }
    };
    const mark = (k: "linkOpen" | "arrow" | "linkClose"): void => {
      line.items.push({ k, start: i, end: i + 2 });
      i += 2;
    };

    while (i < end) {
      const c = source[i] ?? "";
      if (atLineStart) {
        if (c === " " || c === "\t") {
          i++;
          continue;
        }
        atLineStart = false;
        if (source.startsWith("//", i)) {
          line.comment = true;
          i = lineEnd(i, end);
          continue;
        }
      }
      if (c === "\n" || (c === "\r" && source[i + 1] === "\n")) {
        line.end = i;
        lines.push(line);
        i += c === "\r" ? 2 : 1;
        line = { items: [], start: i, end, comment: false };
        atLineStart = true;
        inLink = false;
        continue;
      }
      if (c === "\\") {
        const next = source[i + 1];
        if (next !== undefined && i + 1 < end && PUNCTUATION.test(next)) {
          text(next, i, i + 2);
          i += 2;
        } else if (next === undefined || next === "\n" || next === "\r" || i + 1 >= end) {
          error("A backslash at the end of a line escapes nothing. Remove it.", i);
          i++;
        } else {
          error(
            `\`\\${next}\` isn't an escape. A backslash only escapes punctuation, like \`\\{\`; write \`\\\\\` for a backslash.`,
            i,
            i + 2,
          );
          i++;
        }
        continue;
      }
      if (c === "/" && source[i + 1] === "*") {
        const close = source.indexOf("*/", i + 2);
        if (close < 0 || close + 2 > end) {
          error("This comment is never closed. End it with `*/`.", i, i + 2);
          i = end;
        } else {
          line.comment = true;
          i = close + 2;
        }
        continue;
      }
      if (c === "{") {
        // `{/if}` would scan as the start of a regular expression, so find its `}` directly.
        const closing = /^\{\s*\//.test(source.slice(i, i + 64));
        const close = closing ? closingBrace(i, end) : matchBrace(source, i, end);
        if (close === undefined) {
          error(
            "This `{` is never closed. End it with `}`, or write `\\{` for a literal brace.",
            i,
          );
          i = lineEnd(i, end);
          continue;
        }
        const item = classify(i, close);
        if (item) line.items.push(item);
        i = close + 1;
        continue;
      }
      if (c === "}") {
        error("This `}` doesn't close anything. Write `\\}` for a literal brace.", i);
        i++;
        continue;
      }
      if (c === "[" && source[i + 1] === "[") {
        inLink = true;
        mark("linkOpen");
        continue;
      }
      if (inLink && c === "-" && source[i + 1] === ">") {
        mark("arrow");
        continue;
      }
      if (inLink && c === "]" && source[i + 1] === "]") {
        inLink = false;
        mark("linkClose");
        continue;
      }
      if (c === "*") {
        let j = i;
        while (j < end && source[j] === "*") j++;
        const before = i > start ? source[i - 1] : undefined;
        const after = j < end ? source[j] : undefined;
        line.items.push({
          k: "stars",
          n: j - i,
          left: after !== undefined && !SPACE.test(after),
          right: before !== undefined && !SPACE.test(before),
          start: i,
          end: j,
        });
        i = j;
        continue;
      }
      text(c, i, i + 1);
      i++;
    }
    line.end = end;
    lines.push(line);
    return lines;
  }

  // ---- Builder -------------------------------------------------------------

  function buildBody(start: number, end: number): ContentSyntax[] {
    const root: Frame = { t: "root", nodes: [] };
    const frames: Frame[] = [root];
    const top = (): Frame => frames.at(-1) ?? root;
    let lineIndex = 0;
    let lastLink: { node: LinkDraft; line: number } | undefined;

    function push(node: ContentSyntax): void {
      const frame = top();
      if (frame.t === "link") {
        if (frame.arrow) {
          if (node.type !== "text") {
            frame.badTarget = true;
            error(
              "A link's target is a passage name, so it can't contain `{…}` or formatting. To choose a target while playing, use `goTo` in code.",
              node.span.start,
              node.span.end,
            );
          }
          return;
        }
        if (node.type !== "text" && node.type !== "print" && node.type !== "emphasis") {
          error(
            "Only text, formatting, and printed values like `{name}` can go in a link label.",
            node.span.start,
            node.span.end,
          );
          return;
        }
      }
      const last = frame.nodes.at(-1);
      if (node.type === "text" && last?.type === "text") {
        frame.nodes[frame.nodes.length - 1] = {
          type: "text",
          text: last.text + node.text,
          span: { start: last.span.start, end: node.span.end },
        };
        return;
      }
      frame.nodes.push(node);
    }

    const pushText = (text: string, s: number, e: number): void => {
      push({ type: "text", text, span: { start: s, end: e } });
    };

    /** Pops the top frame, which never closed, reporting it and keeping its content. */
    function abandon(closeAt: number): void {
      const frame = frames.pop();
      if (!frame || frame.t === "root") return;
      if (frame.t === "emphasis") {
        const marks = frame.strong ? "**" : "*";
        error(
          `This \`${marks}\` starts ${frame.strong ? "strong text" : "emphasis"} that never ends. Close it with \`${marks}\`, or write \`\\*\` for a literal asterisk.`,
          frame.open.start,
          frame.open.end,
        );
        pushText(marks, frame.open.start, frame.open.end);
        for (const node of frame.nodes) push(node);
      } else if (frame.t === "link") {
        error(
          "This link isn't closed. A link ends with `]]` on the same line.",
          frame.open.start,
          frame.open.end,
        );
        pushText("[[", frame.open.start, frame.open.end);
        for (const node of frame.nodes) push(node);
      } else {
        error(
          "This `{if}` is never closed. End the block with `{/if}`.",
          frame.draft.span.start,
          frame.draft.branches[0]?.span.end ?? frame.draft.span.start + 1,
        );
        frame.draft.span.end = closeAt;
      }
    }

    /** Abandons emphasis frames above the nearest frame of another kind. */
    function unwindEmphasis(closeAt: number): void {
      while (top().t === "emphasis") abandon(closeAt);
    }

    function stars(item: Extract<Item, { k: "stars" }>): void {
      const frame = top();
      if (item.n > 3 || (frame.t === "link" && frame.arrow)) {
        pushText("*".repeat(item.n), item.start, item.end);
        return;
      }
      if (item.n === 3) {
        const a = frames.at(-1);
        const b = frames.at(-2);
        if (item.right && a?.t === "emphasis" && b?.t === "emphasis" && a.strong !== b.strong) {
          closeEmphasis(item.start + (a.strong ? 2 : 1));
          closeEmphasis(item.end);
        } else if (item.left) {
          openEmphasis(true, item.start, item.start + 2);
          openEmphasis(false, item.start + 2, item.end);
        } else {
          pushText("***", item.start, item.end);
        }
        return;
      }
      const strong = item.n === 2;
      if (item.right) {
        let index = frames.length - 1;
        for (; index >= 0; index--) {
          const f = frames[index];
          if (f?.t !== "emphasis") {
            index = -1;
            break;
          }
          if (f.strong === strong) break;
        }
        if (index >= 0) {
          if (index !== frames.length - 1) {
            error(
              `This \`${strong ? "**" : "*"}\` closes formatting, but formatting opened inside it is still open. Close the inner one first.`,
              item.start,
              item.end,
            );
            while (frames.length - 1 > index) abandon(item.start);
          }
          closeEmphasis(item.end);
          return;
        }
      }
      if (item.left) openEmphasis(strong, item.start, item.end);
      else pushText("*".repeat(item.n), item.start, item.end);
    }

    function openEmphasis(strong: boolean, s: number, e: number): void {
      frames.push({ t: "emphasis", nodes: [], strong, open: { start: s, end: e } });
    }

    function closeEmphasis(e: number): void {
      const frame = frames.pop();
      if (frame?.t !== "emphasis") return;
      push({
        type: "emphasis",
        strong: frame.strong,
        content: frame.nodes,
        span: { start: frame.open.start, end: e },
      });
    }

    function closeLink(close: { start: number; end: number }): void {
      while (top().t === "emphasis") abandon(close.start);
      const frame = frames.pop();
      if (frame?.t !== "link") return;
      const span = { start: frame.open.start, end: close.end };
      const label = trimLabel(frame.nodes);
      let target: NameSyntax;
      if (frame.arrow) {
        const raw = trimmed(frame.arrow.end, close.start);
        target = { name: raw.text, span: raw.span };
        if (label.length === 0) {
          error("This link has no label. Write one before `->`.", span.start, span.end);
        }
        if (frame.badTarget !== true) checkName(target, "This link");
      } else {
        const raw = trimmed(frame.open.end, close.start);
        if (label.some((n) => n.type !== "text")) {
          error(
            "A link without `->` uses its label as the passage name, so the label can only be text. Write `[[label -> Target]]`.",
            span.start,
            span.end,
          );
          target = { name: "", span: raw.span };
        } else {
          target = { name: label.map((n) => (n as TextSyntax).text).join(""), span: raw.span };
          checkName(target, "This link");
        }
      }
      const node: LinkDraft = { type: "link", label, target, span };
      push(node);
      lastLink = { node, line: lineIndex };
    }

    function guard(item: Extract<Item, { k: "directive" }>): void {
      const frame = top();
      const nodes = frame.nodes;
      let last = nodes.at(-1);
      const spaces = last?.type === "text" && last.text.trim() === "";
      if (spaces) last = nodes.at(-2);
      if (frame.t !== "link" && lastLink?.line === lineIndex && last === lastLink.node) {
        if (lastLink.node.guard) {
          error(
            "This link already has a guard. Combine the conditions in one `{when …}`.",
            item.start,
            item.end,
          );
          return;
        }
        lastLink.node.guard = item.node;
        if (spaces) nodes.pop();
        return;
      }
      error(
        "`{when …}` guards a link, so it goes right after one on the same line, like `[[Go down -> Cellar]]{when lantern.isLit}`.",
        item.start,
        item.end,
      );
    }

    function branchFrame(): Extract<Frame, { t: "branch" }> | undefined {
      const frame = top();
      return frame.t === "branch" ? frame : undefined;
    }

    function process(item: Item): void {
      switch (item.k) {
        case "text":
          pushText(item.text, item.start, item.end);
          return;
        case "stars":
          stars(item);
          return;
        case "linkOpen":
          if (frames.some((f) => f.t === "link")) {
            error("Links can't be nested inside other links.", item.start, item.end);
            return;
          }
          frames.push({ t: "link", nodes: [], open: { start: item.start, end: item.end } });
          return;
        case "arrow": {
          while (top().t === "emphasis") abandon(item.start);
          const frame = top();
          if (frame.t !== "link") return;
          if (frame.arrow) {
            frame.badTarget = true;
            error(
              "This link already has `->`. Write `-\\>` for a literal arrow in a label.",
              item.start,
              item.end,
            );
            return;
          }
          frame.arrow = { start: item.start, end: item.end };
          return;
        }
        case "linkClose":
          closeLink(item);
          return;
        case "print":
          push(item.node);
          return;
        case "directive":
          if (item.node.name === "when") guard(item);
          else push(item.node);
          return;
        case "if": {
          if (top().t === "link") {
            push({ type: "if", branches: [], span: { start: item.start, end: item.end } });
            return;
          }
          const branch: BranchDraft = {
            condition: item.condition,
            content: [],
            span: { start: item.start, end: item.end },
          };
          const draft: IfDraft = {
            type: "if",
            branches: [branch],
            span: { start: item.start, end: item.end },
          };
          push(draft);
          frames.push({ t: "branch", nodes: branch.content, draft, hasElse: false });
          return;
        }
        case "elseIf":
        case "else": {
          unwindEmphasis(item.start);
          const frame = branchFrame();
          const what = item.k === "else" ? "{else}" : "{else if}";
          if (!frame) {
            error(`\`${what}\` has no \`{if}\` to belong to.`, item.start, item.end);
            return;
          }
          if (frame.hasElse) {
            error(
              `\`${what}\` can't come after \`{else}\`. Move \`{else}\` to the end of the block.`,
              item.start,
              item.end,
            );
          }
          const branch: BranchDraft = {
            content: [],
            span: { start: item.start, end: item.end },
          };
          if (item.k === "elseIf") branch.condition = item.condition;
          frame.draft.branches.push(branch);
          frame.nodes = branch.content;
          frame.hasElse ||= item.k === "else";
          return;
        }
        case "endIf": {
          unwindEmphasis(item.start);
          const frame = branchFrame();
          if (!frame) {
            error("`{/if}` has no `{if}` to close.", item.start, item.end);
            return;
          }
          frame.draft.span.end = item.end;
          frames.pop();
          return;
        }
      }
    }

    const isContent = (item: Item): boolean =>
      item.k === "stars" ||
      item.k === "linkOpen" ||
      item.k === "arrow" ||
      item.k === "linkClose" ||
      item.k === "print" ||
      (item.k === "text" && item.text.trim() !== "");

    /** Whether the next content line joins the previous one with a space. */
    let joined = false;
    const joins: { start: boolean; any: boolean }[] = [];

    for (const [index, line] of tokenize(start, end).entries()) {
      lineIndex = index;
      const content = line.items.some(isContent);
      if (!content && line.items.length === 0 && !line.comment) {
        unwindEmphasis(line.start);
        const frame = top();
        const last = frame.nodes.at(-1);
        if (last?.type === "break") {
          frame.nodes[frame.nodes.length - 1] = {
            type: "break",
            span: { start: last.span.start, end: line.end },
          };
        } else if (frame.nodes.length > 0 || frame.t !== "root") {
          frame.nodes.push({ type: "break", span: { start: line.start, end: line.end } });
        }
        joined = false;
        continue;
      }

      let items = line.items;
      if (content) {
        const lastText = items.findLastIndex((it) => it.k === "text" || isContent(it));
        const it = items[lastText];
        if (it?.k === "text") {
          it.text = it.text.trimEnd();
          if (it.text === "") items = items.filter((x) => x !== it);
        }
        if (joined) pushText(" ", line.start, line.start);
      } else {
        items = items.filter((it) => it.k !== "text");
      }

      for (const item of items) {
        if (item.k === "if") joins.push({ start: joined, any: false });
        if (item.k === "elseIf" || item.k === "else" || item.k === "endIf") {
          const j = joins.at(-1);
          if (j) {
            j.any ||= joined;
            joined = j.start;
            if (item.k === "endIf") {
              joined = j.start || j.any;
              joins.pop();
            }
          }
        }
        process(item);
      }
      if (content) joined = true;

      // Links close on the line they open.
      while (frames.some((f) => f.t === "link")) abandon(line.end);
    }

    while (frames.length > 1) abandon(end);
    while (root.nodes.at(-1)?.type === "break") root.nodes.pop();
    return root.nodes;
  }

  /** Removes whitespace at the ends of a link label. */
  function trimLabel(nodes: ContentSyntax[]): ContentSyntax[] {
    const out = [...nodes];
    const first = out[0];
    if (first?.type === "text") {
      const text = first.text.trimStart();
      if (text === "") out.shift();
      else out[0] = { ...first, text };
    }
    const last = out.at(-1);
    if (last?.type === "text") {
      const text = last.text.trimEnd();
      if (text === "") out.pop();
      else out[out.length - 1] = { ...last, text };
    }
    return out;
  }

  // ---- File ----------------------------------------------------------------

  const headers: number[] = [];
  for (const start of lineStarts) if (source.startsWith("::", start)) headers.push(start);

  checkPreamble(headers[0] ?? source.length);

  const passages: PassageSyntax[] = [];
  const seen = new Map<string, number>();
  for (const [n, start] of headers.entries()) {
    const headerEnd = lineEnd(start, source.length);
    const next = headers[n + 1] ?? source.length;
    const newline = source.indexOf("\n", start);
    const bodyStart = newline < 0 || newline >= next ? next : newline + 1;
    const bodyEnd = next > bodyStart && source[next - 1] === "\n" ? next - 1 : next;
    const { name, tags } = parseHeader(start, headerEnd);
    if (name.name !== "") {
      const other = seen.get(name.name);
      if (other !== undefined) {
        error(
          `Another passage in this file is already named "${name.name}" (line ${String(other)}). Rename one of them.`,
          name.span.start,
          name.span.end,
        );
      } else {
        seen.set(name.name, lineStarts.indexOf(start) + 1);
      }
    }
    passages.push({
      name,
      tags,
      content: buildBody(bodyStart, Math.max(bodyStart, bodyEnd)),
      header: { start, end: headerEnd },
      span: { start, end: next },
    });
  }

  function checkPreamble(end: number): void {
    let i = 0;
    while (i < end) {
      const c = source[i] ?? "";
      if (SPACE.test(c)) i++;
      else if (source.startsWith("//", i)) i = lineEnd(i, end);
      else if (source.startsWith("/*", i)) {
        const close = source.indexOf("*/", i + 2);
        i = close < 0 ? end : close + 2;
      } else {
        error(
          headers.length === 0
            ? "This file has no passages. Start one with a header like `:: Start`."
            : "This text comes before the first passage header, so it belongs to no passage. Move it into a passage.",
          i,
          lineEnd(i, end),
        );
        return;
      }
    }
  }

  diagnostics.sort((a, b) => a.span.start - b.span.start);
  return { file, passages, diagnostics };
}
