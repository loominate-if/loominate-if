/**
 * Rewrites TypeScript's messages into author-facing ones (#31).
 *
 * TypeScript names an object by spelling out its whole type:
 * `Handle<{ name: string; taken: boolean; … }, "lantern">`. Objects defined
 * with `object()` carry their ID as the last type argument, so messages can
 * name them by ID instead (#212).
 */

/** A `'Handle<…>'` type quoted in a message. */
interface QuotedHandle {
  /** Where the quoted type starts and ends in the message, quotes included. */
  readonly start: number;
  readonly end: number;
  /** The definition's type, as printed. */
  readonly definition: string;
  /** The object's ID, when the type carries it as a string literal. */
  readonly id: string | undefined;
}

const OPEN = "'Handle<";

/** Splits `text` at commas outside brackets and string literals. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      i = closingQuote(text, i);
    } else if (c === "<" || c === "{" || c === "(" || c === "[") {
      depth++;
    } else if (c === ">" || c === "}" || c === ")" || c === "]") {
      depth--;
    } else if (c === "," && depth === 0) {
      parts.push(text.slice(from, i).trim());
      from = i + 1;
    }
  }
  parts.push(text.slice(from).trim());
  return parts;
}

function closingQuote(text: string, open: number): number {
  for (let i = open + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === '"') return i;
  }
  return text.length;
}

/** Finds each quoted `Handle<…>` type in `message`. */
function quotedHandles(message: string): QuotedHandle[] {
  const found: QuotedHandle[] = [];
  let at = message.indexOf(OPEN);
  while (at !== -1) {
    let depth = 1;
    let i = at + OPEN.length;
    for (; i < message.length && depth > 0; i++) {
      const c = message[i];
      if (c === '"') i = closingQuote(message, i);
      else if (c === "<" || c === "{" || c === "(" || c === "[") depth++;
      else if (c === ">" || c === "}" || c === ")" || c === "]") depth--;
    }
    // `i` is just past the closing `>`; a quoted type ends with a quote.
    if (depth === 0 && message[i] === "'") {
      const args = splitTopLevel(message.slice(at + OPEN.length, i - 1));
      const last = args.length > 1 ? args.at(-1) : undefined;
      const id =
        last !== undefined && /^"(?:[^"\\]|\\.)*"$/.test(last)
          ? (JSON.parse(last) as string)
          : undefined;
      found.push({ start: at, end: i + 1, definition: args[0] ?? "", id });
    }
    at = message.indexOf(OPEN, i);
  }
  return found;
}

/** What a rewrite needs to know about where the error is. */
export interface MessageContext {
  /** Whether the error is on a value printed in prose, as in `{lantern}`. */
  readonly printed?: boolean;
}

/**
 * Rewrites one TypeScript message for authors. Messages it has no rule for
 * come back unchanged.
 */
export function authorMessage(message: string, context: MessageContext = {}): string {
  return message
    .split("\n")
    .map((line) => rewriteLine(line, context))
    .join("\n");
}

function rewriteLine(line: string, context: MessageContext): string {
  const handles = quotedHandles(line);
  const first = handles[0];
  if (!first) return line;

  // Property 'takn' does not exist on type 'Handle<…, "lantern">'. Did you mean 'taken'?
  const missing = /^Property '([^']+)' does not exist on type $/.exec(line.slice(0, first.start));
  if (missing && first.id !== undefined && handles.length === 1) {
    const rest = line.slice(first.end);
    const suggestion = /^\. Did you mean '([^']+)'\?$/.exec(rest);
    if (suggestion || rest === ".") {
      return `\`${first.id}\` has no property \`${missing[1] ?? ""}\`.${
        suggestion ? ` Did you mean \`${suggestion[1] ?? ""}\`?` : ""
      }`;
    }
  }

  // {lantern} in prose: Argument of type 'Handle<…, "lantern">' is not assignable to parameter of type 'string | number'.
  if (
    context.printed &&
    first.id !== undefined &&
    line.slice(0, first.start) === "Argument of type " &&
    line.slice(first.end) === " is not assignable to parameter of type 'string | number'."
  ) {
    const example = /(?:^|[{;] )name: string;/.test(first.definition)
      ? `, such as \`{${first.id}.name}\``
      : "";
    return `\`${first.id}\` is an object, so it can't be printed. Print one of its properties instead${example}.`;
  }

  // Anywhere else: name the object, or drop the Handle wrapper when there's no single ID.
  let out = "";
  let from = 0;
  for (const h of handles) {
    const before = line.slice(from, h.start);
    if (h.id !== undefined) {
      out += before.endsWith("type ")
        ? `${before.slice(0, -"type ".length)}object \`${h.id}\``
        : `${before}object \`${h.id}\``;
    } else {
      out += `${before}'${h.definition}'`;
    }
    from = h.end;
  }
  return out + line.slice(from);
}

/** What the compiler knows about the names passages can use, for {@link undefinedNameMessage}. */
export interface NameHelp {
  /** The scope module, as the author would write its path, or undefined if there isn't one. */
  readonly scope: string | undefined;
  /** A name close to the missing one that passages can use, if any. */
  readonly suggestion?: string;
  /** Another module that exports the missing name, as `{ path, specifier }` relative to the scope module. */
  readonly exportedBy?: { readonly path: string; readonly specifier: string };
}

/** The name in TypeScript's "Cannot find name 'x'." messages (codes 2304 and 2552). */
export function missingName(message: string): string | undefined {
  return /^Cannot find name '([^']+)'\./.exec(message)?.[1];
}

/** Explains a name inline code uses that passages can't see (#33). */
export function undefinedNameMessage(name: string, help: NameHelp): string {
  const scope = help.scope ?? "story.ts";
  if (help.exportedBy) {
    return `\`${name}\` is exported by \`${help.exportedBy.path}\`, but passages only see what \`${scope}\` exports. Add \`export { ${name} } from "${help.exportedBy.specifier}";\` to \`${scope}\`.`;
  }
  if (help.suggestion !== undefined) {
    return `\`${name}\` isn't defined. Did you mean \`${help.suggestion}\`?`;
  }
  return help.scope === undefined
    ? `\`${name}\` isn't defined. To use it in passages, export it from \`${scope}\`.`
    : `\`${name}\` isn't defined. Passages can use what \`${scope}\` exports, and \`visits\`, \`firstVisit\`, and \`visited\`.`;
}
