/**
 * Tagged-template text, `t` (#27, ADR 0013).
 *
 * `t` returns a {@link Text}: a pure function that renders the template each
 * time it's called, so `description: t`…`` stays current as state changes,
 * and an object definition treats it as behavior, not state. Functions in
 * `${}` run at render time.
 *
 * adv3Lite-style message parameters, such as `{the ${door}}`, are written in
 * braces and looked up by name in {@link messageParameters} when the text
 * renders. Core registers none: the world model and kits register articles,
 * pronouns, and verb agreement.
 */
import { renderingObjects } from "../objects/objects.js";
import type { ObjectRef } from "../objects/objects.js";
import { registry, type Registry } from "../rules/registry.js";
import { StateError } from "../state/value.js";

/**
 * Named values a text renders with, such as the actor and the objects of the
 * current action. Message parameters read them; `t` itself only passes them on.
 */
export type TextContext = { readonly [name: string]: unknown };

/** What a text can print directly: strings, numbers, and other texts. */
export type TextPrintable = string | number | Text;

/**
 * A value in a `t` template's `${}`. A function runs each time the text
 * renders, given the text's context. Outside braces the value is printed; an
 * object can only appear as a message parameter's argument, as in `{the ${door}}`.
 */
export type TextValue =
  | string
  | number
  | ObjectRef
  // A Text is one of these too. Listing it apart would give the union two call
  // signatures, and `${(c) => …}` would lose its parameter type.
  | ((context: TextContext) => TextPrintable | ObjectRef);

/**
 * Text written with {@link t}. Call it to render it.
 *
 * @remarks
 * Rendering is pure: an object or random stream changed while a text renders
 * is an error. Change state in an effect, then print.
 */
export interface Text {
  /**
   * Renders the text.
   * @throws {@link StateError} if a value can't be printed, a message
   * parameter isn't registered, or rendering tried to change state.
   */
  (context?: TextContext): string;
  /** The template as written, with `${…}` in place of each value. For error messages and the inspector. */
  readonly source: string;
}

/**
 * One argument of a message parameter: a word written in the braces, or a
 * value from `${}` (after running it, if it's a function).
 */
export type MessageArg =
  | { readonly kind: "word"; readonly word: string }
  | { readonly kind: "value"; readonly value: unknown };

/** What a {@link MessageParameter} is called with. */
export interface MessageCall {
  /** The parameter's name as written, such as `The` in `{The ${door}}`. */
  readonly name: string;
  /** The words and values after the name, in order. */
  readonly args: readonly MessageArg[];
  /** The context the text is rendering with. */
  readonly context: TextContext;
  /** The text being rendered, for error messages. */
  readonly text: Text;
  /**
   * Values the parameters of one rendering share, in order, such as the
   * subject that later verbs agree with in `{The subj ${cat}} {sleeps}`.
   * Each rendering starts with it empty.
   */
  readonly shared: Map<string, unknown>;
}

/**
 * Renders a message parameter such as `{the ${door}}` to a string. It must be
 * pure: read state, never change it.
 */
export type MessageParameter = (call: MessageCall) => string;

/**
 * Message parameters by name. The world model and kits register articles,
 * pronouns, and verb agreement here; names are case-sensitive, so `the` and
 * `The` are registered separately.
 *
 * @example
 * ```ts
 * messageParameters.register("shout", ({ args }) =>
 *   args.map((a) => (a.kind === "word" ? a.word : String(a.value))).join(" ").toUpperCase(),
 * );
 * t`{shout hello there}`(); // "HELLO THERE"
 * ```
 */
export const messageParameters: Registry<MessageParameter> =
  registry<MessageParameter>("message-parameters");

/**
 * Renders a message parameter no name in {@link messageParameters} matched,
 * or returns `undefined` to leave it to the next.
 */
export type MessageFallback = (call: MessageCall) => string | undefined;

/**
 * Parameters for names nobody registered, tried in the order they're
 * registered, such as the world model's verbs: `{opens}` agrees with its
 * subject whatever the verb. A name none of them renders is an error.
 */
export const messageFallbacks: Registry<MessageFallback> =
  registry<MessageFallback>("message-fallbacks");

type Segment =
  | { readonly kind: "literal"; readonly text: string }
  | { readonly kind: "value"; readonly index: number }
  | {
      readonly kind: "parameter";
      readonly name: string;
      readonly args: readonly ({ readonly word: string } | { readonly index: number })[];
    };

const texts = new WeakSet<object>();

/** Whether a value is a {@link Text} made by {@link t}. */
export function isText(value: unknown): value is Text {
  return typeof value === "function" && texts.has(value);
}

/**
 * Writes printed text.
 *
 * @remarks
 * - `${value}` prints a string, number, or other text. A function runs each
 *   time the text renders.
 * - `{name args…}` is a message parameter, looked up by name in
 *   {@link messageParameters}. Its arguments are words and `${}` values.
 * - `{{` and `}}` print a literal brace.
 *
 * @example
 * ```ts
 * const status = t`The lamp is ${() => (lamp.isLit ? "lit" : "dark")}.`;
 * status(); // "The lamp is dark."
 * ```
 * @throws {@link StateError} if the braces don't match.
 */
export function t(strings: TemplateStringsArray, ...values: TextValue[]): Text {
  const source = strings.raw.reduce((all, s, i) => `${all}${i === 0 ? "" : "${…}"}${s}`, "");
  const where = `text ${JSON.stringify(source)}`;
  const segments = parse(strings, where);
  const text = ((context: TextContext = {}): string =>
    renderingObjects(where, () => render(segments, values, context, text, where))) as Text;
  Object.defineProperty(text, "source", { value: source, enumerable: true });
  Object.defineProperty(text, "name", { value: "t" });
  texts.add(text);
  return Object.freeze(text);
}

function parse(strings: TemplateStringsArray, where: string): Segment[] {
  const segments: Segment[] = [];
  let literal = "";
  /** The parameter being read, from `{` to `}`. */
  let open: { words: string; args: ({ word: string } | { index: number })[] } | undefined;
  const flushWords = () => {
    if (!open) return;
    for (const word of open.words.split(/\s+/)) if (word !== "") open.args.push({ word });
    open.words = "";
  };
  for (const [i, raw] of strings.entries()) {
    // An invalid escape such as \u leaves the cooked string undefined.
    const s = (strings[i] as string | undefined) ?? raw;
    for (let j = 0; j < s.length; j++) {
      const c = s[j];
      if (!open) {
        if ((c === "{" || c === "}") && s[j + 1] === c) {
          literal += c;
          j++;
        } else if (c === "{") {
          if (literal !== "") segments.push({ kind: "literal", text: literal });
          literal = "";
          open = { words: "", args: [] };
        } else if (c === "}") {
          throw new StateError(
            `${where}: a "}" with no "{" before it. Write "}}" to print a brace.`,
          );
        } else {
          literal += c;
        }
      } else if (c === "{") {
        throw new StateError(
          `${where}: a "{" inside a message parameter. Parameters can't nest; write "{{" outside one to print a brace.`,
        );
      } else if (c === "}") {
        flushWords();
        const [first, ...args] = open.args;
        if (!first || !("word" in first)) {
          throw new StateError(
            `${where}: a message parameter needs a name first, as in {the \${door}}. Write "{{" to print a brace.`,
          );
        }
        segments.push({ kind: "parameter", name: first.word, args });
        open = undefined;
      } else {
        open.words += c;
      }
    }
    if (i < strings.length - 1) {
      if (open) {
        flushWords();
        open.args.push({ index: i });
      } else {
        if (literal !== "") segments.push({ kind: "literal", text: literal });
        literal = "";
        segments.push({ kind: "value", index: i });
      }
    }
  }
  if (open) {
    throw new StateError(`${where}: a "{" with no "}" after it. Write "{{" to print a brace.`);
  }
  if (literal !== "") segments.push({ kind: "literal", text: literal });
  return segments;
}

function render(
  segments: readonly Segment[],
  values: readonly TextValue[],
  context: TextContext,
  text: Text,
  where: string,
): string {
  const resolve = (index: number): unknown => {
    const value = values[index];
    return typeof value === "function" && !isText(value) ? value(context) : value;
  };
  let out = "";
  const shared = new Map<string, unknown>();
  for (const segment of segments) {
    if (segment.kind === "literal") {
      out += segment.text;
    } else if (segment.kind === "value") {
      out += print(resolve(segment.index), segment.index, context, where);
    } else {
      const call: MessageCall = {
        name: segment.name,
        args: segment.args.map((a) =>
          "word" in a ? { kind: "word", word: a.word } : { kind: "value", value: resolve(a.index) },
        ),
        context,
        text,
        shared,
      };
      const parameter = messageParameters.get(segment.name);
      let result: unknown = parameter?.(call);
      if (!parameter) {
        for (const fallback of messageFallbacks.entries()) {
          result = fallback.value(call);
          if (result !== undefined) break;
        }
        if (result === undefined) {
          throw new StateError(
            `${where}: there's no message parameter {${segment.name}}. The world model and kits register them; check the name, or write "{{" to print a brace.`,
          );
        }
      }
      if (typeof result !== "string") {
        throw new StateError(
          `${where}: the message parameter {${segment.name}} returned ${describe(result)}, not a string.`,
        );
      }
      out += result;
    }
  }
  return out;
}

function print(value: unknown, index: number, context: TextContext, where: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (isText(value)) return value(context);
  const which = `value ${String(index + 1)}`;
  if (typeof value === "object" && value !== null && "id" in value) {
    throw new StateError(
      `${where}: ${which} is an object, which text can't print by itself. Use a message parameter such as {the \${…}} to name it.`,
    );
  }
  throw new StateError(
    `${where}: ${which} is ${describe(value)}; text can print strings, numbers, and other texts.`,
  );
}

const describe = (value: unknown): string =>
  value === null
    ? "null"
    : value === undefined
      ? "undefined"
      : typeof value === "object" || typeof value === "function"
        ? `a${typeof value === "object" ? "n" : ""} ${typeof value}`
        : `${typeof value === "boolean" ? "the boolean" : `a ${typeof value}`} ${String(value)}`;
