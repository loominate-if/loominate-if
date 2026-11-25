/**
 * The command line's commands (#131, ADR 0107): what the player can type,
 * and how what they typed matches. It only ever offers what the page does,
 * the passage's choices, things' menus, and a layout's action lists, so it
 * never answers "I don't understand": it lists what's possible instead.
 */
import { registry, type ActionCall, type Registry } from "@loominate-if/core";
import type { PageGame } from "./page.js";

/** Something the player can type: its label, other ways to say it, and what it does. */
export type Command = {
  /** What it's called, as the page shows it: "Signal the ship". */
  readonly label: string;
  /** Other ways to say it, as an action's verb phrases with its things named: "take coin". */
  readonly phrases?: readonly string[];
  /** Why it can't be done now, if it can't: it's listed, but not done. */
  readonly disabled?: string;
  /** Does it, as choosing it on the page would. */
  readonly run: () => void;
};

/** Gives commands the page doesn't show as choices, menus, or action lists. */
export type CommandSource = (game: PageGame) => readonly Command[];

/**
 * Sources of commands beyond what's on the page, by name, for a game or kit
 * to add its own.
 *
 * @example
 * ```ts
 * commandSources.register("hint", () => [{ label: "Hint", run: () => showHint() }]);
 * ```
 */
export const commandSources: Registry<CommandSource> = registry<CommandSource>("commandSources");

/** Words that make no difference to what's meant. */
const ARTICLES = new Set(["a", "an", "the"]);

/** What's typed or offered, as words: lowercase, without punctuation or articles. @internal */
export function _words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[“”"‘’'.,!?;:()[\]{}…—–-]+/g, " ")
    .split(/\s+/)
    .filter((w) => w !== "" && !ARTICLES.has(w));
}

/**
 * An action's verb phrases with its things named, as a player would type
 * them: "unlock {thing} with {tool}" becomes "unlock door with key", once
 * with each optional word and once without.
 */
// A call of any action: an action's type is invariant in its arguments, so no narrower type takes them all.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function _phrasesOf(call: ActionCall<any>): string[] {
  const args = call.args as Readonly<Record<string, unknown>>;
  const out: string[] = [];
  for (const verb of call.action.verbs) {
    let ways: string[][] = [[]];
    let fits = true;
    for (const part of verb.parts) {
      if (part.kind === "word") ways = ways.map((w) => [...w, part.word]);
      else if (part.kind === "optional") ways = ways.flatMap((w) => [w, [...w, ...part.words]]);
      else {
        const thing = args[part.role];
        // A slot for something that isn't a thing, as a count: the phrase can't be typed as it stands.
        if (thing === null || typeof thing !== "object" || !("id" in thing)) fits = false;
        else ways = ways.map((w) => [...w, nameOf(thing as { readonly id: string })]);
      }
    }
    if (fits) out.push(...ways.map((w) => w.join(" ")));
  }
  return out;
}

/** A thing's name, as a player would type it: its `name`, or else its ID's words. */
function nameOf(thing: { readonly id: string }): string {
  const name = (thing as { readonly name?: unknown }).name;
  return typeof name === "string" && name !== "" ? name : thing.id.replace(/[-_:]+/g, " ");
}

/** How well what's typed matches a way of saying a command: 3 exactly, 2 from its start, 1 in order, 0 not. */
function score(typed: readonly string[], said: readonly string[]): number {
  if (typed.length === 0) return 0;
  if (typed.length === said.length && typed.every((w, i) => w === said[i])) return 3;
  // Each typed word starts a word said, in order: "sig ship" is "signal the ship".
  let at = 0;
  let fromStart = true;
  for (const [i, word] of typed.entries()) {
    const found = said.findIndex((s, j) => j >= at && s.startsWith(word));
    if (found < 0) return 0;
    if (found !== i) fromStart = false;
    at = found + 1;
  }
  return fromStart ? 2 : 1;
}

/** What's typed, matched against commands: the ones it could mean, best first, and the one it surely means. */
export type CommandMatch = {
  /** The commands it could mean, best first, then in the order offered. */
  readonly matches: readonly Command[];
  /** The one it means: said exactly, or the only one it could mean. */
  readonly sure?: Command;
};

/**
 * Matches what the player typed against the commands: by label or phrase,
 * articles and punctuation aside, each typed word the start of a word, in
 * order.
 *
 * @example
 * ```ts
 * matchCommands("sig", commands).matches; // [Signal the ship]
 * ```
 */
export function matchCommands(typed: string, commands: readonly Command[]): CommandMatch {
  const words = _words(typed);
  const scored = commands
    .map((command, i) => ({
      command,
      i,
      best: Math.max(
        0,
        ...[command.label, ...(command.phrases ?? [])].map((s) => score(words, _words(s))),
      ),
    }))
    .filter((s) => s.best > 0)
    .sort((a, b) => b.best - a.best || a.i - b.i);
  const matches = scored.map((s) => s.command);
  const exact = scored.filter((s) => s.best === 3);
  const sure =
    exact.length === 1 ? exact[0]?.command : matches.length === 1 ? matches[0] : undefined;
  return { matches, ...(sure && { sure }) };
}
