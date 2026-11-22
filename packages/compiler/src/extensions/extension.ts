/**
 * The compiler extension API (#187, ADR 0015).
 *
 * The compiler doesn't know the world model or any kit. Packages describe
 * their passage syntax as data: directives with declared arguments, tag
 * roles, line forms, and checks. Core's own directives are registered the
 * same way ({@link coreExtension}). A directive or line form compiles to a call
 * of a function its package exports at runtime, so runtime packages never
 * depend on the compiler, and TypeScript checks each call against the real
 * function.
 */
import type { PassageFileSyntax, Span } from "../passages/syntax.js";

/** A function a package exports at runtime, which generated code imports and calls. */
export type RuntimeExport = {
  /** The module to import from, such as `@loominate-if/vn`. */
  readonly module: string;
  /** The export's name. */
  readonly export: string;
};

/**
 * What an argument takes, and what the generated call receives:
 * - `expression`: TypeScript, passed as its value.
 * - `condition`: TypeScript, passed as core's `ConditionArgument`: its
 *   `value`, its source as `text`, and `parts()`, which evaluates each part
 *   of it on its own, so the inspector can show why something is hidden.
 * - `duration`: `1.5s` or `300ms`, passed as milliseconds.
 * - `passage`: `-> Name`, checked like a link and passed as the name.
 * - `words`: plain words such as `mira smiling`, passed as an array of strings.
 * - `choice`: one word from {@link ArgumentSpec.choices}, passed as a string.
 */
export type ArgumentKind = "expression" | "condition" | "duration" | "passage" | "words" | "choice";

/** One argument a directive takes. */
export type ArgumentSpec = {
  /** The key it's passed under, and the key it's written with when it's named. */
  readonly name: string;
  /** What it takes. */
  readonly kind: ArgumentKind;
  /**
   * True if it's written `name: value`. Otherwise it's positional, matched in
   * order. A `passage` argument is always written `-> Name`, wherever it falls.
   */
  readonly named?: boolean;
  /** True if it must be given. Required positional arguments come before optional ones. */
  readonly required?: boolean;
  /** For `choice`: the words it accepts. */
  readonly choices?: readonly string[];
  /** Arguments that can't be given with this one. */
  readonly excludes?: readonly string[];
};

/**
 * A directive. Its kind says where it goes and what it compiles to:
 * - `effect`: `{name: code}`, statements run in an effect phase.
 * - `content`: `{name args}` in a passage body. It ends the paragraph, and
 *   compiles to a call of `runtime` with its arguments as one object,
 *   returning a passage node or an array of them.
 * - `guard`: `{name args}` right after a link, like core's `{when}`. It
 *   compiles to a call of `runtime` returning the link's guard.
 * - `arrival`: `{name args}` at the top level of a passage that runs when the
 *   player reaches it, like core's `{emit}`: when they arrive, or, after a
 *   beat, when they reach that part. It compiles to a call of `runtime` with
 *   its arguments as one object and the effect context, run with the
 *   `{on enter: …}` code of its part, in the order they're written. It never
 *   runs when the passage is only shown, so it may change state.
 * - `annotation`: `{name args}` that generates no code, read by the compiler
 *   or by checks, like core's `{line}`.
 *
 * A `content` or `guard` directive without `runtime` is recognized and
 * checked, and reports `unsupported` where it's used.
 */
export type DirectiveDefinition = {
  /** The name, lowercase words separated by single spaces, such as `beat` or `on enter`. */
  readonly name: string;
  /**
   * Tag roles the directive is limited to, such as `["actor"]`: it may only
   * appear in passages with one of them. Omit it to allow it everywhere.
   * Two packages may share a name only if they apply to different passages:
   * in roles that don't overlap, or one limited to roles and one not, in
   * which case the limited one applies in its roles.
   */
  readonly roles?: readonly string[];
  /** How it's written, for error messages, such as `{continue -> Platform}`. */
  readonly example?: string;
} & (
  | {
      readonly kind: "effect";
      /** The phase the code runs in. */
      readonly phase: "firstVisit" | "enter" | "leave";
    }
  | {
      readonly kind: "content" | "guard";
      /** The arguments it takes. */
      readonly args?: readonly ArgumentSpec[];
      /** The function it calls. */
      readonly runtime?: RuntimeExport;
      /** Why it can't be used yet, when it has no `runtime`. */
      readonly unsupported?: string;
      /**
       * True for a content directive whose node is a beat, like core's
       * `{beat}`, `{wait}`, and `{page}`: it divides the passage into parts, so
       * it must be at the top level, and effect phases after it run when the
       * player reaches its part.
       */
      readonly beat?: boolean;
    }
  | {
      readonly kind: "arrival";
      /** The arguments it takes. */
      readonly args?: readonly ArgumentSpec[];
      /** The function it calls, with its arguments and the effect context. */
      readonly runtime: RuntimeExport;
    }
  | {
      readonly kind: "annotation";
      /** The arguments it takes. */
      readonly args?: readonly ArgumentSpec[];
    }
);

/** A tag role, written `role: value` in a passage header, such as `room: platform`. */
export type TagRoleDefinition = {
  /** The role's name, such as `room`. */
  readonly name: string;
  /**
   * True if passages with this role are entered by the package rather than by
   * links (rooms, actors), so they're never reported as unreachable.
   */
  readonly entry?: boolean;
  /**
   * A function called when the player arrives at a passage with this role,
   * before the passage's own `{on enter: …}` code, as
   * `runtime(value, context)`. The role's value is code in the game's scope,
   * such as an export of `story.ts`, so TypeScript checks it and its errors
   * point at the tag. The world model's `room: cellar` moves the player into
   * `cellar` this way.
   */
  readonly arrival?: RuntimeExport;
};

/**
 * A line form: a line starting with `prefix`, such as the VN kit's
 * `@mira (nervous) "I didn't think you'd come."`. The rest of the line must
 * match `pattern`; its named groups are passed to `runtime` as strings (or
 * `undefined` for a group that didn't match), and the call returns a passage
 * node or an array of them. A line form ends the paragraph.
 */
export type LineFormDefinition = {
  /** The form's name, for messages. */
  readonly name: string;
  /** What the line starts with, after any indentation. One ASCII punctuation character, such as `@`. */
  readonly prefix: string;
  /** What must follow the prefix, matched against the rest of the line. */
  readonly pattern: RegExp;
  /** How it's written, for error messages. */
  readonly example?: string;
  /** The function it calls. */
  readonly runtime: RuntimeExport;
};

/** A problem an extension's check found, positioned in a passage file. */
export type ExtensionDiagnostic = {
  /** Errors stop the game from building; warnings point at likely mistakes. */
  readonly severity: "error" | "warning";
  /** The passage file. */
  readonly file: string;
  /** What's wrong and how to fix it. */
  readonly message: string;
  /** Where, in `file`. */
  readonly span: Span;
};

/** What an extension's check can see. */
export type CheckContext = {
  /** Every passage file, parsed, in path order. */
  readonly files: readonly PassageFileSyntax[];
};

/** A check over the whole game, run after parsing, such as "every locked node has a way out". */
export type ExtensionCheck = {
  /** The check's name, for messages and the inspector. */
  readonly name: string;
  /** Runs the check. */
  readonly run: (context: CheckContext) => readonly ExtensionDiagnostic[];
};

/** What a package adds to the compiler. Pass extensions to `compileProject` in load order. */
export type CompilerExtension = {
  /** The package's name, such as `@loominate-if/world`, used in messages. */
  readonly name: string;
  /** Directives it adds. */
  readonly directives?: readonly DirectiveDefinition[];
  /** Tag roles it adds. */
  readonly tagRoles?: readonly TagRoleDefinition[];
  /** Line forms it adds. */
  readonly lineForms?: readonly LineFormDefinition[];
  /** Checks it runs over the game. */
  readonly checks?: readonly ExtensionCheck[];
  /**
   * Syntax from other packages this one works with, by package: when a game
   * uses it without loading that package, the error says which to install.
   */
  readonly suggests?: {
    readonly directive?: Readonly<Record<string, string>>;
    readonly tagRole?: Readonly<Record<string, string>>;
    readonly lineForm?: Readonly<Record<string, string>>;
  };
};
