/**
 * Listing what's in or on something (#290, ADR 0042): "three gold coins, a
 * brass key, and a map". Alike things are listed once, with a count.
 */
import { message, messages, t, type ObjectRef } from "@loominate-if/core";
import { currentPlayerBody } from "./actors.js";
import { canSee } from "./scope.js";
import { contents, isWithin, templateOf, type Thing } from "./things.js";

declare module "@loominate-if/core" {
  interface Messages {
    /** A list with nothing in it: "nothing". */
    "list.empty": Record<never, never>;
    /** Items joined into a list: "a, b, and c". */
    "list.join": { readonly items: readonly string[] };
    /** A count of alike things: "three gold coins". `plural` is their plural name. */
    "list.group": { readonly count: number; readonly plural: string };
    /** A number in words, for counts: "three", or "24". */
    "number.words": { readonly count: number };
  }
}

/** What a thing may say about listing it. */
export type ListingFields = {
  /** Its name for more than one, when adding "s" or "es" is wrong: "mice", "pairs of boots". */
  readonly pluralName?: string;
  /**
   * Whether it's interchangeable with other things of the same name, so
   * they're listed together. Things made from the same template always are.
   */
  readonly isEquivalent?: boolean;
};

const SOURCE = "@loominate-if/world";
const WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];

messages.register("list.empty", "nothing", { source: SOURCE });
messages.register(
  "list.join",
  ({ items }) =>
    items.length <= 2
      ? items.join(" and ")
      : `${items.slice(0, -1).join(", ")}, and ${items.at(-1) ?? ""}`,
  { source: SOURCE },
);
messages.register(
  "list.group",
  ({ count, plural }) => `${message("number.words", { count })} ${plural}`,
  { source: SOURCE },
);
messages.register("number.words", ({ count }) => WORDS[count] ?? String(count), {
  source: SOURCE,
});

/** "coins" from "coin", "boxes" from "box", "berries" from "berry", for a name's last word. */
export function pluralize(name: string): string {
  const match = /^(.*?)(\S+)$/s.exec(name);
  const [, before = "", word = name] = match ?? [];
  let plural: string;
  if (/[^aeiou]y$/i.test(word)) plural = `${word.slice(0, -1)}ies`;
  else if (/(s|x|z|ch|sh)$/i.test(word)) plural = `${word}es`;
  else plural = `${word}s`;
  return before + plural;
}

/** A thing's name for more than one. */
export function pluralOf(thing: ObjectRef): string {
  const t = thing as Thing & ListingFields;
  return t.pluralName ?? pluralize(t.name);
}

/** What makes things alike enough to list together, or `undefined` if `t` stands alone. */
function equivalence(t: Thing): string | undefined {
  // A stack is listed with its own count, as "99 turnips"; one that doesn't merge stands alone.
  if (typeof (t as Thing & { stackOf?: unknown }).stackOf === "string") return undefined;
  const made = templateOf(t);
  if (made !== undefined) return `template:${made}:${t.name}`;
  return (t as Thing & ListingFields).isEquivalent === true ? `name:${t.name}` : undefined;
}

/**
 * The things directly in or on `holder` that the player would list: what
 * they can see, and anything they carry, but not the player.
 */
function listed(holder: ObjectRef): Thing[] {
  const all = contents(holder);
  const body = currentPlayerBody();
  if (!body) return all;
  // Never the player's own body, as when listing the room they're in.
  return all.filter((t) => t.id !== body.id && (canSee(body, t) || isWithin(t, body)));
}

/**
 * Lists what's directly in or on `holder`, as the player would see it:
 * "three gold coins, a brass key, and a map", or "nothing". Alike things,
 * those made from the same template or marked `isEquivalent`, with the same
 * name, are listed once with a count. Things the player can't see, such as
 * in the dark, aren't listed, but what the player carries always is.
 *
 * @example
 * ```ts
 * // story.ts
 * export { listContents } from "@loominate-if/world";
 * // a passage
 * The chest holds {listContents(chest)}.
 * ```
 */
export function listContents(holder: ObjectRef): string {
  const groups = new Map<string, Thing[]>();
  const order: Thing[][] = [];
  for (const thing of listed(holder)) {
    const key = equivalence(thing);
    const known = key === undefined ? undefined : groups.get(key);
    if (known) {
      known.push(thing);
    } else {
      const group = [thing];
      if (key !== undefined) groups.set(key, group);
      order.push(group);
    }
  }
  if (order.length === 0) return message("list.empty");
  const items = order.map(([first, ...rest]) =>
    rest.length === 0
      ? t`{a ${first as Thing}}`()
      : message("list.group", { count: rest.length + 1, plural: pluralOf(first as Thing) }),
  );
  return message("list.join", { items });
}
