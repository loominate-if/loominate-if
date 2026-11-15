import { describe, expect, it } from "vitest";
import { coreDirectives } from "./directives.js";
import { parsePassageFile, type ParseOptions } from "./parse.js";
import type { ArgumentSyntax, ContentSyntax, PassageSyntax } from "./syntax.js";

/** A compact view of content, so tests read like the source. */
function view(nodes: readonly ContentSyntax[]): unknown[] {
  return nodes.map((n) => {
    switch (n.type) {
      case "text":
        return n.text;
      case "print":
        return { print: n.expression.code };
      case "emphasis":
        return { [n.strong ? "strong" : "em"]: view(n.content) };
      case "directive":
        return n.code ? { [n.name]: n.code.code } : { [n.name]: n.args.map(viewArg) };
      case "if":
        return {
          if: n.branches.map((b) => [b.condition?.code ?? "else", ...view(b.content)]),
        };
      case "link":
        return {
          link: view(n.label),
          to: n.target.name,
          ...(n.guard && { when: n.guard.args.map(viewArg) }),
        };
      case "break":
        return "¶";
    }
  });
}

function viewArg(a: ArgumentSyntax): string {
  if (a.type === "target") return `-> ${a.target.name}`;
  if (a.type === "named") return `${a.key.name}: ${a.value.code}`;
  return a.value.code;
}

function parse(source: string, options?: ParseOptions) {
  return parsePassageFile(source, options);
}

/** Parses one passage body and expects no errors. */
function body(text: string, options?: ParseOptions): unknown[] {
  const result = parse(`:: P\n${text}`, options);
  expect(result.diagnostics).toEqual([]);
  return view((result.passages[0] as PassageSyntax).content);
}

/** Parses a file and returns its errors as `line:column message`. */
function errors(source: string): string[] {
  return parse(source).diagnostics.map((d) => `${String(d.line)}:${String(d.column)} ${d.message}`);
}

describe("passage headers", () => {
  it("reads names, tags, and roles", () => {
    const { passages, diagnostics } = parse(
      ":: Arrival [scene]\nHi.\n:: Butler [actor: butler, state: onDuty]\n:: Cellar Stairs\n",
    );
    expect(diagnostics).toEqual([]);
    expect(passages.map((p) => [p.name.name, p.tags.map((t) => [t.name, t.value])])).toEqual([
      ["Arrival", [["scene", undefined]]],
      [
        "Butler",
        [
          ["actor", "butler"],
          ["state", "onDuty"],
        ],
      ],
      ["Cellar Stairs", []],
    ]);
  });

  it("records where names and passages are", () => {
    const source = ":: A\none\n::  Second One  [x]\ntwo\n";
    const [a, b] = parse(source).passages as [PassageSyntax, PassageSyntax];
    expect(source.slice(b.name.span.start, b.name.span.end)).toBe("Second One");
    expect(source.slice(a.span.start, a.span.end)).toBe(":: A\none\n");
    expect(source.slice(b.header.start, b.header.end)).toBe("::  Second One  [x]");
  });

  it("reports malformed headers", () => {
    expect(errors(":: \n")).toEqual([
      "1:1 This passage has no name. Write one after `::`, like `:: Cellar`.",
    ]);
    expect(errors(":: A -> B\n")).toEqual([
      '1:4 Passage names can\'t contain `->`, but "A -> B" does. Rename the passage.',
    ]);
    expect(errors(":: A [scene\n")).toEqual(["1:6 The tag list isn't closed. End it with `]`."]);
    expect(errors(":: A [scene] extra\n")).toEqual([
      "1:14 Nothing can follow the tag list in a passage header. Move it to the next line.",
    ]);
    expect(errors(":: A [a,,b]\n")).toEqual(["1:9 This tag is empty. Remove the extra comma."]);
    expect(errors(":: A [room:]\n")).toEqual([
      '1:7 The tag "room:" needs a role and a value, like `room: platform`.',
    ]);
  });

  it("reports duplicate names and stray text before the first header", () => {
    expect(errors("Hello\n:: A\n:: A\n")).toEqual([
      "1:1 This text comes before the first passage header, so it belongs to no passage. Move it into a passage.",
      '3:4 Another passage in this file is already named "A" (line 2). Rename one of them.',
    ]);
    expect(errors("// just a comment\n/* and\nanother */\n:: A\n")).toEqual([]);
    expect(errors("nothing here")).toEqual([
      "1:1 This file has no passages. Start one with a header like `:: Start`.",
    ]);
  });
});

describe("prose", () => {
  it("joins wrapped lines and splits paragraphs on blank lines", () => {
    expect(body("Fog has swallowed\n   the platform.\n\n\nA lamp gutters.\n")).toEqual([
      "Fog has swallowed the platform.",
      "¶",
      "A lamp gutters.",
    ]);
  });

  it("resolves escapes", () => {
    expect(body("A \\{brace\\}, a \\\\ and \\*stars\\*.")).toEqual([
      "A {brace}, a \\ and *stars*.",
    ]);
  });

  it("drops comments without splitting paragraphs", () => {
    expect(body("One\n// a note\ntwo /* aside */ three.\n/* multi\nline */\nfour.")).toEqual([
      "One two  three. four.",
    ]);
    expect(body("See https://example.com.")).toEqual(["See https://example.com."]);
  });

  it("formats emphasis and strong text", () => {
    expect(body("It goes *further* than **that**, and ***both***.")).toEqual([
      "It goes ",
      { em: ["further"] },
      " than ",
      { strong: ["that"] },
      ", and ",
      { strong: [{ em: ["both"] }] },
      ".",
    ]);
    expect(body("*across\nlines*")).toEqual([{ em: ["across lines"] }]);
    expect(body("5 * 3 and a lone * here")).toEqual(["5 * 3 and a lone * here"]);
  });

  it("reports bad escapes, stray braces, and unclosed formatting", () => {
    expect(errors(":: A\nA \\q.")).toEqual([
      "2:3 `\\q` isn't an escape. A backslash only escapes punctuation, like `\\{`; write `\\\\` for a backslash.",
    ]);
    expect(errors(":: A\nA }")).toEqual([
      "2:3 This `}` doesn't close anything. Write `\\}` for a literal brace.",
    ]);
    expect(errors(":: A\n*open\n\nnext")).toEqual([
      "2:1 This `*` starts emphasis that never ends. Close it with `*`, or write `\\*` for a literal asterisk.",
    ]);
    expect(errors(":: A\n/* open")).toEqual([
      "2:1 This comment is never closed. End it with `*/`.",
    ]);
  });
});

describe("braces", () => {
  it("prints expressions", () => {
    expect(body("The window of {station.theName}.")).toEqual([
      "The window of ",
      { print: "station.theName" },
      ".",
    ]);
  });

  it("recognizes directives by their registered names", () => {
    expect(body("{beat 1.5s}\n{wait}\n{continue -> Platform}")).toEqual([
      { beat: ["1.5s"] },
      { wait: [] },
      { continue: ["-> Platform"] },
    ]);
  });

  it("treats a name followed by anything but a separator as an expression", () => {
    expect(body("{wait.length} {(wait)} {beat()}")).toEqual([
      { print: "wait.length" },
      " ",
      { print: "(wait)" },
      " ",
      { print: "beat()" },
    ]);
  });

  it("takes code after a colon for effect phases", () => {
    expect(body("{on enter: if (!player.has(lantern)) { player.fear += 1 }}")).toEqual([
      { "on enter": "if (!player.has(lantern)) { player.fear += 1 }" },
    ]);
    expect(body("{on   first   visit: x()}")).toEqual([{ "on first visit": "x()" }]);
  });

  it("ignores braces and commas inside strings, templates, comments, and regexes", () => {
    expect(body("{on enter: say(`a ${ {b: '}'}.b } }`, \"}\", /}/.test(x)) // }\n}")).toEqual([
      { "on enter": "say(`a ${ {b: '}'}.b } }`, \"}\", /}/.test(x)) // }" },
    ]);
    expect(body('[[Go -> B]]{when a, reason: "It\'s too dark, really.", hidden}')).toEqual([
      { link: ["Go"], to: "B", when: ["a", 'reason: "It\'s too dark, really."', "hidden"] },
    ]);
  });

  it("splits arguments at top-level commas into positional, named, and target", () => {
    const options = { directives: [...coreDirectives, { name: "show" }, { name: "ask" }] };
    expect(body("{show mira smiling, dissolve}", options)).toEqual([
      { show: ["mira smiling", "dissolve"] },
    ]);
    expect(body("{ask letter, when: f(a, b), again}", options)).toEqual([
      { ask: ["letter", "when: f(a, b)", "again"] },
    ]);
    expect(body("{continue x ? 1 : 2, -> Next}")).toEqual([{ continue: ["x ? 1 : 2", "-> Next"] }]);
  });

  it("reports empty braces, unclosed braces, and the wrong directive form", () => {
    expect(errors(":: A\n{}\n{ beat: 2s }\n{on enter x}\n{continue a,,b}\n{wait")).toEqual([
      "2:1 Empty braces do nothing. Write `\\{\\}` for literal braces.",
      "3:7 `beat` takes arguments, not code. Remove the colon: `{beat …}`.",
      "4:1 `on enter` takes code after a colon, like `{on enter: …}`.",
      "5:12 This argument is empty. Remove the extra comma.",
      "6:1 This `{` is never closed. End it with `}`, or write `\\{` for a literal brace.",
    ]);
    expect(errors(":: A\n{/when}")).toEqual([
      "2:1 `{/when}` closes nothing. Only `{/if}` closes a block.",
    ]);
  });

  it("validates directive registrations", () => {
    expect(() => parse("", { directives: [{ name: "if" }] })).toThrow(
      /part of the passage grammar/,
    );
    expect(() => parse("", { directives: [{ name: "Beat" }] })).toThrow(/lowercase words/);
    expect(() => parse("", { directives: [{ name: "x" }, { name: "x" }] })).toThrow(
      /registered twice/,
    );
  });
});

describe("conditional blocks", () => {
  it("parses if, else if, and else across lines", () => {
    expect(
      body(
        "The steps go down.\n{if lantern.isLit}\n  Shadows.\n{else if dawn}\n  Grey light.\n{else}\n  Dark.\n{/if}\nYou stop.",
      ),
    ).toEqual([
      "The steps go down.",
      {
        if: [
          ["lantern.isLit", " Shadows."],
          ["dawn", " Grey light."],
          ["else", " Dark."],
        ],
      },
      " You stop.",
    ]);
  });

  it("parses inline blocks, and nests them", () => {
    expect(body("You see {if lit}a lamp{else}nothing{/if}.")).toEqual([
      "You see ",
      {
        if: [
          ["lit", "a lamp"],
          ["else", "nothing"],
        ],
      },
      ".",
    ]);
    expect(body("{if a}{if b}both{/if}{/if}")).toEqual([{ if: [["a", { if: [["b", "both"]] }]] }]);
  });

  it("keeps paragraphs inside a block", () => {
    expect(body("{if a}\nOne.\n\nTwo.\n{/if}")).toEqual([{ if: [["a", "One.", "¶", "Two."]] }]);
  });

  it("reports unbalanced blocks", () => {
    expect(errors(":: A\n{if a}\nx")).toEqual([
      "2:1 This `{if}` is never closed. End the block with `{/if}`.",
    ]);
    expect(errors(":: A\n{else}\n{/if}\n{if}{/if}")).toEqual([
      "2:1 `{else}` has no `{if}` to belong to.",
      "3:1 `{/if}` has no `{if}` to close.",
      "4:1 `{if}` needs a condition, like `{if lantern.isLit}`.",
    ]);
    expect(errors(":: A\n{if a}{else}{else if b}{/if}")).toEqual([
      "2:13 `{else if}` can't come after `{else}`. Move `{else}` to the end of the block.",
    ]);
    expect(errors(":: A\n{if a}{else b}{/if}")).toEqual([
      "2:7 `{else}` doesn't take a condition. Did you mean `{else if …}`?",
    ]);
    expect(errors(":: A\n{if a}*x{/if}*")).toEqual([
      "2:7 This `*` starts emphasis that never ends. Close it with `*`, or write `\\*` for a literal asterisk.",
    ]);
  });
});

describe("links", () => {
  it("parses labelled and bare links", () => {
    expect(body("[[Go down -> Cellar]]\n[[Kitchen]]")).toEqual([
      { link: ["Go down"], to: "Cellar" },
      " ",
      { link: ["Kitchen"], to: "Kitchen" },
    ]);
  });

  it("allows printed values and formatting in labels, and links inside prose", () => {
    expect(body("You could [[ask about {topic.name} *now* -> Hall]].")).toEqual([
      "You could ",
      { link: ["ask about ", { print: "topic.name" }, " ", { em: ["now"] }], to: "Hall" },
      ".",
    ]);
    expect(body("[[a -\\> b -> C]]")).toEqual([{ link: ["a -> b"], to: "C" }]);
  });

  it("attaches guards that follow a link on the same line", () => {
    expect(
      body(
        '[[Go down -> Cellar]] {when lantern.isLit, reason: "Too dark."}\n[[Up -> Kitchen]]{when a, disabled}',
      ),
    ).toEqual([
      { link: ["Go down"], to: "Cellar", when: ["lantern.isLit", 'reason: "Too dark."'] },
      " ",
      { link: ["Up"], to: "Kitchen", when: ["a", "disabled"] },
    ]);
  });

  it("records the target's position", () => {
    const source = ":: A\n[[Go ->  Cellar Stairs ]]";
    const link = (parse(source).passages[0] as PassageSyntax).content[0];
    expect(
      link?.type === "link" && source.slice(link.target.span.start, link.target.span.end),
    ).toBe("Cellar Stairs");
  });

  it("reports malformed links and misplaced guards", () => {
    expect(errors(":: A\n[[Go -> Cellar\n]]")).toEqual([
      "2:1 This link isn't closed. A link ends with `]]` on the same line.",
    ]);
    expect(errors(":: A\n[[ -> Cellar]]")).toEqual([
      "2:1 This link has no label. Write one before `->`.",
    ]);
    expect(errors(":: A\n[[Go -> ]]")).toEqual(["2:9 This link has no passage name."]);
    expect(errors(":: A\n[[{x}]]")).toEqual([
      "2:1 A link without `->` uses its label as the passage name, so the label can only be text. Write `[[label -> Target]]`.",
    ]);
    expect(errors(":: A\n[[Go -> {x}]]")).toEqual([
      "2:9 A link's target is a passage name, so it can't contain `{…}` or formatting. To choose a target while playing, use `goTo` in code.",
    ]);
    expect(errors(":: A\n[[Go {wait} -> B]]")).toEqual([
      "2:6 Only text, formatting, and printed values like `{name}` can go in a link label.",
    ]);
    expect(errors(":: A\n[[a [[b -> C]]")).toEqual([
      "2:5 Links can't be nested inside other links.",
    ]);
    expect(errors(":: A\n[[a -> b -> C]]")).toEqual([
      "2:10 This link already has `->`. Write `-\\>` for a literal arrow in a label.",
    ]);
    const misplaced =
      "`{when …}` guards a link, so it goes right after one on the same line, like `[[Go down -> Cellar]]{when lantern.isLit}`.";
    expect(errors(":: A\n{when x}\n[[a -> B]]\n{when x}\n[[a -> B]] text {when x}")).toEqual([
      `2:1 ${misplaced}`,
      `4:1 ${misplaced}`,
      `5:17 ${misplaced}`,
    ]);
    expect(errors(":: A\n[[a -> B]]{when x}{when y}")).toEqual([
      "2:19 This link already has a guard. Combine the conditions in one `{when …}`.",
    ]);
  });

  it("leaves arrows and brackets alone outside links", () => {
    expect(body("a -> b ]] [c]")).toEqual(["a -> b ]] [c]"]);
  });
});

describe("design examples", () => {
  it("parses the Arrival scene", () => {
    const source = `:: Arrival [scene]
The train is gone before you've finished stepping down.
{beat 1.5s}
Fog has swallowed the platform. Somewhere ahead, a lamp
gutters in the window of {station.theName}.
{wait}
You are not, it seems, expected.
{continue -> Platform}
`;
    const result = parse(source);
    expect(result.diagnostics).toEqual([]);
    expect(view((result.passages[0] as PassageSyntax).content)).toEqual([
      "The train is gone before you've finished stepping down.",
      { beat: ["1.5s"] },
      " Fog has swallowed the platform. Somewhere ahead, a lamp gutters in the window of ",
      { print: "station.theName" },
      ".",
      { wait: [] },
      " You are not, it seems, expected.",
      { continue: ["-> Platform"] },
    ]);
  });

  it("parses the ADR 0004 example", () => {
    const source = `:: Cellar Stairs [room: stairs]
/* The lantern matters here. */
{on enter: if (!player.has(lantern)) player.fear += 1}

The steps go down *further* than they should.
{if lantern.isLit}
  Your lantern throws long shadows against the stone.
{else}
  You can't see the bottom. Somewhere below, {rat.theName} \\{scratches\\}.
{/if}

[[Go down -> Cellar]]{when lantern.isLit, reason: "It's too dark to go down."}
[[Back up -> Kitchen]]
`;
    const result = parse(source);
    expect(result.diagnostics).toEqual([]);
    expect(view((result.passages[0] as PassageSyntax).content)).toEqual([
      { "on enter": "if (!player.has(lantern)) player.fear += 1" },
      "¶",
      "The steps go down ",
      { em: ["further"] },
      " than they should.",
      {
        if: [
          ["lantern.isLit", " Your lantern throws long shadows against the stone."],
          [
            "else",
            " You can't see the bottom. Somewhere below, ",
            { print: "rat.theName" },
            " {scratches}.",
          ],
        ],
      },
      "¶",
      {
        link: ["Go down"],
        to: "Cellar",
        when: ["lantern.isLit", `reason: "It's too dark to go down."`],
      },
      " ",
      { link: ["Back up"], to: "Kitchen" },
    ]);
  });

  it("maps every code span back to the source", () => {
    const source = ":: A\n{if  door.isOpen }x{/if} {on enter:  go() } {beat  2s }";
    const content = (parse(source).passages[0] as PassageSyntax).content;
    const spans: [number, number][] = [];
    for (const n of content) {
      if (n.type === "if")
        for (const b of n.branches)
          if (b.condition) spans.push([b.condition.span.start, b.condition.span.end]);
      if (n.type === "directive") {
        if (n.code) spans.push([n.code.span.start, n.code.span.end]);
        for (const a of n.args)
          if (a.type === "positional") spans.push([a.value.span.start, a.value.span.end]);
      }
    }
    expect(spans.map(([s, e]) => source.slice(s, e))).toEqual(["door.isOpen", "go()", "2s"]);
  });

  it("handles Windows line endings", () => {
    expect(
      view((parse(":: A [x]\r\nOne\r\ntwo\r\n\r\nthree").passages[0] as PassageSyntax).content),
    ).toEqual(["One two", "¶", "three"]);
  });
});
