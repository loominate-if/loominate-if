/**
 * The syntax tree for passage files (ADR 0004).
 *
 * The tree records what the author wrote, with source positions, and nothing
 * more: directive arguments and code stay as raw text for later stages
 * (argument checking in #187, virtual TypeScript modules in #30).
 */

/** A range of a source file, as UTF-16 offsets: `start` inclusive, `end` exclusive. */
export type Span = {
  /** Offset of the first character. */
  readonly start: number;
  /** Offset just past the last character. */
  readonly end: number;
};

/** A problem found in a passage file, positioned for the author. */
export type Diagnostic = {
  /** How serious the problem is. The parser reports only errors. */
  readonly severity: "error" | "warning";
  /** What went wrong and how to fix it, written for the author. */
  readonly message: string;
  /** Where the problem is. */
  readonly span: Span;
  /** Line of `span.start`, from 1. */
  readonly line: number;
  /** Column of `span.start`, from 1, in UTF-16 code units. */
  readonly column: number;
};

/** TypeScript code from the source, kept as written for the virtual module. */
export type CodeSyntax = {
  /** The code, with surrounding whitespace removed. */
  readonly code: string;
  /** Where the code is. */
  readonly span: Span;
};

/** A passage name, as used in a header or a link target. */
export type NameSyntax = {
  /** The name, with surrounding whitespace removed. */
  readonly name: string;
  /** Where the name is. */
  readonly span: Span;
};

/** Literal prose, with escapes resolved and line breaks joined. */
export type TextSyntax = {
  readonly type: "text";
  /** The text as it will be shown. */
  readonly text: string;
  /** The source the text came from. */
  readonly span: Span;
};

/** `{expression}`: a value printed into the prose. */
export type PrintSyntax = {
  readonly type: "print";
  /** The expression. */
  readonly expression: CodeSyntax;
  /** The whole `{…}`. */
  readonly span: Span;
};

/** `*emphasis*` or `**strong**`. */
export type EmphasisSyntax = {
  readonly type: "emphasis";
  /** True for `**strong**`. */
  readonly strong: boolean;
  /** What's emphasized. */
  readonly content: readonly ContentSyntax[];
  /** From the opening to the closing asterisks. */
  readonly span: Span;
};

/** A positional directive argument. */
export type PositionalArgument = {
  readonly type: "positional";
  /** The argument as written. Its kind (expression, duration, words) is up to the directive. */
  readonly value: CodeSyntax;
  /** The whole argument. */
  readonly span: Span;
};

/** A `key: value` directive argument. */
export type NamedArgument = {
  readonly type: "named";
  /** The argument's name. */
  readonly key: NameSyntax;
  /** The value as written. */
  readonly value: CodeSyntax;
  /** The whole argument. */
  readonly span: Span;
};

/** A `-> Target` directive argument. */
export type TargetArgument = {
  readonly type: "target";
  /** The passage named. */
  readonly target: NameSyntax;
  /** The whole argument, including `->`. */
  readonly span: Span;
};

/** A directive argument. */
export type ArgumentSyntax = PositionalArgument | NamedArgument | TargetArgument;

/** `{name args}` or `{name: code}`: a registered directive. */
export type DirectiveSyntax = {
  readonly type: "directive";
  /** The directive's name, with words separated by single spaces (`on enter`). */
  readonly name: string;
  /** Where the name is. */
  readonly nameSpan: Span;
  /** Arguments, for the `{name args}` form. Empty for the code form. */
  readonly args: readonly ArgumentSyntax[];
  /** The statements, for the `{name: code}` form. */
  readonly code?: CodeSyntax;
  /** The whole `{…}`. */
  readonly span: Span;
};

/** One branch of an `{if}` block. */
export type IfBranch = {
  /** The condition, or undefined for `{else}`. */
  readonly condition?: CodeSyntax;
  /** What the branch shows. */
  readonly content: readonly ContentSyntax[];
  /** The branch's opening directive, `{if …}`, `{else if …}`, or `{else}`. */
  readonly span: Span;
};

/** `{if …} … {else if …} … {else} … {/if}`. */
export type IfSyntax = {
  readonly type: "if";
  /** The branches in order. Only the last may be an `{else}`. */
  readonly branches: readonly IfBranch[];
  /** From `{if` to the end of `{/if}`. */
  readonly span: Span;
};

/** `[[label -> Target]]` or `[[Target]]`, with an optional guard. */
export type LinkSyntax = {
  readonly type: "link";
  /** The label. For `[[Target]]`, the target's name as text. */
  readonly label: readonly ContentSyntax[];
  /** The passage the link goes to. */
  readonly target: NameSyntax;
  /** The `{when …}` directive right after the link, if any. */
  readonly guard?: DirectiveSyntax;
  /** From `[[` to `]]`, not including the guard. */
  readonly span: Span;
};

/** A blank line: the end of a paragraph. */
export type BreakSyntax = {
  readonly type: "break";
  /** The blank lines. */
  readonly span: Span;
};

/** A line in a package's line form, such as `@mira (nervous) "Hello."`. */
export type LineFormSyntax = {
  readonly type: "lineForm";
  /** The form's name. */
  readonly name: string;
  /** The character the line starts with. */
  readonly prefix: string;
  /** The rest of the line, after the prefix, trimmed. Its package's pattern reads it. */
  readonly text: string;
  /** Where `text` is. */
  readonly textSpan: Span;
  /** The whole line, from the prefix. */
  readonly span: Span;
};

/** Anything that can appear in a passage body. */
export type ContentSyntax =
  | TextSyntax
  | PrintSyntax
  | EmphasisSyntax
  | DirectiveSyntax
  | IfSyntax
  | LinkSyntax
  | BreakSyntax
  | LineFormSyntax;

/** A tag in a passage header: `scene`, or a role such as `room: platform`. */
export type TagSyntax = {
  /** The tag, or the role's name. */
  readonly name: string;
  /** The role's value, for `role: value` tags. */
  readonly value?: string;
  /** Where the role's value is, for `role: value` tags. */
  readonly valueSpan?: Span;
  /** The whole tag. */
  readonly span: Span;
};

/** A passage: its header and body. */
export type PassageSyntax = {
  /** The passage's name. */
  readonly name: NameSyntax;
  /** Tags from the header, in order. */
  readonly tags: readonly TagSyntax[];
  /** The body. Paragraphs are separated by {@link BreakSyntax} nodes. */
  readonly content: readonly ContentSyntax[];
  /** The header line. */
  readonly header: Span;
  /** From the header to the end of the body. */
  readonly span: Span;
};

/** A parsed passage file. */
export type PassageFileSyntax = {
  /** The file's name, as given to the parser. */
  readonly file: string;
  /** Passages in source order. */
  readonly passages: readonly PassageSyntax[];
  /** Errors found, in source order. The tree is still built around them. */
  readonly diagnostics: readonly Diagnostic[];
};
