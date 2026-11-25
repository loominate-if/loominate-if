/**
 * @file Tree-sitter grammar for Loominate IF passage files (.weft), after ADR 0004.
 * @license MIT
 *
 * It's for editors' highlighting, brackets, and outlines (#411); the compiler's
 * own parser is the one that decides what a file means. Inline code is left as
 * `code` for editors to highlight as TypeScript.
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

/**
 * The directives the grammar knows by name: the parser's `if` blocks, and
 * those core and the world model register. Others, from kits, read as code.
 * `directives.test.ts` keeps this in step with the packages.
 */
const DIRECTIVES = [
  // The parser's own.
  "if",
  "else if",
  "else",
  // @loominate-if/core
  "on first visit",
  "on enter",
  "on leave",
  "log only",
  "page only",
  "in",
  "continue",
  "effect",
  "when",
  "line",
  "beat",
  "wait",
  "page",
  "act",
  "menu",
  "notices",
  "storylets",
  "storylet",
  "music",
  "music stop",
  "ambience",
  "ambience stop",
  "sound",
  "chapter",
  "emit",
  // @loominate-if/world
  "exits",
  "topics",
  "ask",
  "tell",
  "ask or tell",
  "show",
  "give",
  "show or give",
  "yes",
  "no",
  "hello",
  "bye",
  "reacts ask",
  "reacts tell",
  "reacts ask or tell",
  "reacts show",
  "reacts give",
  "reacts yes",
  "reacts no",
  "reveal",
];

export default grammar({
  name: "weft",

  // Whitespace is prose, so nothing is skipped.
  extras: () => [],

  word: ($) => $.identifier,

  rules: {
    source_file: ($) => repeat(choice($.header, $.line, $._newline)),

    _newline: () => /\r?\n/,

    // :: Name [tag, role: value]
    header: ($) =>
      seq(
        token(prec(2, "::")),
        optional($._spaces),
        field("name", $.passage_name),
        optional($._spaces),
        optional(field("tags", $.tag_list)),
        $._newline,
      ),
    passage_name: () => /[^\[\]{}\\\s]([^\[\]{}\\\r\n]*[^\[\]{}\\\s])?/,
    tag_list: ($) =>
      seq("[", optional(seq($.tag, repeat(seq(",", $.tag)))), "]", optional($._spaces)),
    tag: ($) =>
      seq(
        optional($._spaces),
        field("name", $.tag_name),
        optional(seq(":", optional($._spaces), field("value", $.tag_value))),
        optional($._spaces),
      ),
    tag_name: () => /[A-Za-z_][\w-]*/,
    tag_value: () => /[^,\]\s][^,\]\r\n]*/,
    _spaces: () => /[ \t]+/,

    line: ($) =>
      seq(
        optional(alias(token(prec(1, /[ \t]+/)), $.indent)),
        choice($.line_comment, repeat1($._item)),
        $._newline,
      ),

    line_comment: () => token(seq("//", /[^\r\n]*/)),
    block_comment: () => token(seq("/*", /[^*]*\*+([^/*][^*]*\*+)*/, "/")),

    _item: ($) => choice($.text, $.escape, $.link, $.inline, $.strong, $.emphasis, $.block_comment),

    // Prose. It can't start with `:` (a header) and stops before anything
    // that starts markup; those characters alone are prose too.
    text: () => choice(/[^\\{}\[\]*\/:\r\n][^\\{}\[\]*\/\r\n]*/, ":", "/", "[", "]", "*"),

    escape: () => /\\[!-\/:-@\[-`{-~]/,

    strong: () => token(seq("**", /[^\s*]([^*\r\n]*[^\s*])?/, "**")),
    emphasis: () => token(seq("*", /[^\s*]([^*\r\n]*[^\s*])?/, "*")),

    // [[label -> Target]] or [[Target]]
    link: ($) =>
      seq(
        "[[",
        choice(
          seq(field("label", $.link_label), "->", field("target", $.passage_target)),
          field("target", $.passage_target),
        ),
        "]]",
      ),
    link_label: ($) => repeat1(choice($._link_text, $.inline, $.escape, $.strong, $.emphasis)),
    passage_target: ($) => $._link_text,
    _link_text: () => /([^\]{}\\\r\n\-]|-[^>\]{}\\\r\n])+/,

    // {directive …}, {/if}, or {expression}
    inline: ($) =>
      seq("{", optional(choice($.directive, alias("/if", $.directive_end), $.code)), "}"),

    directive: ($) =>
      seq(
        field("name", $.directive_name),
        optional(
          choice(
            seq(":", optional(field("code", $.code))),
            seq(/[ ,]/, optional(field("arguments", $.arguments))),
          ),
        ),
      ),
    // A multi-word name, as `on first visit`, is one token, so `{show mira}` isn't
    // read as the start of `show or give`.
    directive_name: () => choice(...DIRECTIVES),

    // A directive's arguments: code, with `-> Name` passage targets.
    arguments: ($) => repeat1(choice($._code_part, $.target)),
    target: ($) =>
      seq("->", optional($._spaces), field("name", alias(/[^,}\r\n]+/, $.passage_name))),

    // TypeScript, for editors to inject. Braces nest; strings may hold them.
    code: ($) => repeat1($._code_part),
    _code_part: ($) =>
      choice(
        $.identifier,
        /[^{}\sA-Za-z_$"'`\-]+/,
        "-",
        /\s+/,
        /"([^"\\\r\n]|\\.)*"/,
        /'([^'\\\r\n]|\\.)*'/,
        /`([^`\\]|\\.)*`/,
        seq("{", optional($.code), "}"),
      ),
    identifier: () => /[A-Za-z_$][\w$]*/,
  },
});
