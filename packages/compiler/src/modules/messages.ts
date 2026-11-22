/**
 * Rewrites TypeScript's messages into author-facing ones (#31).
 *
 * TypeScript names an object by spelling out its whole type:
 * `Handle<{ name: string; taken: boolean; … }, "lantern">`. Objects defined
 * with `object()` carry their ID as the last type argument, so messages can
 * name them by ID instead (#212).
 */
import { closestName } from "./links.js";

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
  /** The code the error is on, as the author wrote it, when it's in a passage. */
  readonly code?: string;
  /** Whether that code is being assigned to, as in `player.mood = "happy"`. */
  readonly assigned?: boolean;
  /** Every passage name, to suggest one for a misspelled name. */
  readonly passages?: Iterable<string>;
  /** The scope module, as the author would write its path. */
  readonly scope?: string;
}

/**
 * Rewrites one TypeScript message for authors. Messages it has no rule for
 * come back unchanged.
 */
export function authorMessage(message: string, context: MessageContext = {}): string {
  const whole = rewriteMessage(message, context);
  if (whole !== undefined) return whole;
  return message
    .split("\n")
    .map((line) => rewriteLine(line, context))
    .join("\n");
}

/** Splits a printed type at top-level `|`. */
function unionMembers(type: string): string[] {
  const members: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < type.length; i++) {
    const c = type[i];
    if (c === '"') i = closingQuote(type, i);
    else if (c === "<" || c === "{" || c === "(" || c === "[") depth++;
    else if (c === ">" || c === "}" || c === ")" || c === "]") depth--;
    else if (c === "|" && depth === 0) {
      members.push(type.slice(from, i).trim());
      from = i + 1;
    }
  }
  members.push(type.slice(from).trim());
  return members;
}

/**
 * Rules that replace a whole message, including TypeScript's elaboration
 * lines, since the rewrite explains the problem on its own.
 */
function rewriteMessage(message: string, context: MessageContext): string | undefined {
  const first = message.split("\n")[0] ?? "";
  const code = context.code;

  // visited("Cellr"): the passage name isn't one of the game's.
  const passage =
    /^Argument of type '("(?:[^"\\]|\\.)*")' is not assignable to parameter of type 'PassageName'\.$/.exec(
      first,
    );
  if (passage?.[1] !== undefined && context.passages) {
    const name = JSON.parse(passage[1]) as string;
    const guess = closestName(name, context.passages);
    return `There's no passage named \`${name}\`.${
      guess === undefined
        ? " Check the spelling, or add the passage."
        : ` Did you mean \`${guess}\`?`
    }`;
  }

  // {player.nick}, {player.inventory}, …: a value prose can't show.
  const printed =
    /^Argument of type '(.+)' is not assignable to parameter of type 'string \| number'\.$/.exec(
      first,
    );
  if (context.printed && code !== undefined && printed?.[1] !== undefined) {
    const type = printed[1];
    const members = unionMembers(type);
    if (type === "boolean" || members.every((m) => m === "true" || m === "false")) {
      return `\`${code}\` is true or false, so it can't be printed. To show text that depends on it, use \`{if ${code}}…{else}…{/if}\`.`;
    }
    const empty = ["null", "undefined"].filter((m) => members.includes(m));
    if (empty.length > 0 && empty.length < members.length) {
      const what = empty.map((m) => `\`${m}\``).join(" or ");
      const check = empty.length === 2 ? "!= null" : `!== ${empty[0] ?? "null"}`;
      return `\`${code}\` might be ${what}, so it can't be printed. Give it a fallback, like \`{${code} ?? "…"}\`, or check it first with \`{if ${code} ${check}}…{/if}\`.`;
    }
    if (members.length === 1 && type.endsWith("[]")) {
      return type.includes("Handle<")
        ? `\`${code}\` is a list of objects, so it can't be printed. Print a property of each one, like \`{${code}.map((item) => item.name).join(", ")}\`.`
        : `\`${code}\` is a list, so it can't be printed. Join it into text, like \`{${code}.join(", ")}\`.`;
    }
    if (members.length === 1 && /^\(.*\) => /.test(type)) {
      return `\`${code}\` is a function, so it can't be printed. Call it to print what it returns: \`{${code}()}\`.`;
    }
  }

  // player.mood = "happy": a value the property can't hold.
  const assign = /^Type '(.+)' is not assignable to type '(.+)'\.$/.exec(first);
  if (
    context.assigned &&
    code !== undefined &&
    assign?.[1] !== undefined &&
    assign[2] !== undefined
  ) {
    return `\`${code}\` holds \`${assign[2]}\`, so it can't be set to \`${assign[1]}\`.`;
  }

  // player.fear == "high": the two sides can never be equal.
  const overlap =
    /^This comparison appears to be unintentional because the types '(.+)' and '(.+)' have no overlap\.$/.exec(
      first,
    );
  if (overlap?.[1] !== undefined && overlap[2] !== undefined) {
    return `This comparison can never match: one side is \`${overlap[1]}\` and the other is \`${overlap[2]}\`. Check the value you're comparing with.`;
  }

  // {on enter: lantern = 3}: replacing a scope export.
  const imported = /^Cannot assign to '([^']+)' because it is an import\.$/.exec(first);
  if (imported?.[1] !== undefined && context.scope !== undefined) {
    return `\`${imported[1]}\` comes from \`${context.scope}\`, and passages can't replace it. Change one of its properties instead.`;
  }

  // {greet()}: the wrong number of arguments.
  const count = /^Expected (\d+(?:-\d+)?) arguments?, but got (\d+)( or more)?\.$/.exec(first);
  if (count?.[1] !== undefined && count[2] !== undefined) {
    const call = code !== undefined && /^[\w$.]+\(/.test(code) ? `\`${code}\`` : "This call";
    const wanted = `${count[1]} ${count[1] === "1" ? "argument" : "arguments"}`;
    const got = count[2] === "0" ? "none" : `${count[2]}${count[3] ?? ""}`;
    return `${call} needs ${wanted}, but has ${got}.`;
  }

  // {visits("Cellar")}: visits is this passage's count, not a function.
  if (first === "This expression is not callable." && code === "visits") {
    return '`visits` is how many times this passage has been visited, not a function. To ask about another passage, use `visited("…")`.';
  }

  return undefined;
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
  /** True if the scope module imports the name but doesn't export it. */
  readonly importedByScope?: boolean;
  /** A library package that exports the name, such as `@loominate-if/world`. */
  readonly library?: string;
}

/** The name in TypeScript's "Cannot find name 'x'." messages (codes 2304 and 2552). */
export function missingName(message: string): string | undefined {
  return /^Cannot find name '([^']+)'\./.exec(message)?.[1];
}

/** Explains a name inline code uses that passages can't see (#33). */
export function undefinedNameMessage(name: string, help: NameHelp): string {
  const scope = help.scope ?? "story.ts";
  if (help.importedByScope === true) {
    return `\`${name}\` is imported in \`${scope}\` but not exported, and passages only see what it exports. Add it to an export there, as in \`export { ${name} };\`.`;
  }
  if (help.exportedBy) {
    return `\`${name}\` is exported by \`${help.exportedBy.path}\`, but passages only see what \`${scope}\` exports. Add \`export { ${name} } from "${help.exportedBy.specifier}";\` to \`${scope}\`.`;
  }
  if (help.library !== undefined) {
    return `\`${name}\` comes from ${help.library}, but passages only see what \`${scope}\` exports. Add \`export { ${name} } from "${help.library}";\` to \`${scope}\`.`;
  }
  if (help.suggestion !== undefined) {
    return `\`${name}\` isn't defined. Did you mean \`${help.suggestion}\`?`;
  }
  return help.scope === undefined
    ? `\`${name}\` isn't defined. To use it in passages, export it from \`${scope}\`.`
    : `\`${name}\` isn't defined. Passages can use what \`${scope}\` exports, and \`visits\`, \`firstVisit\`, and \`visited\`.`;
}
