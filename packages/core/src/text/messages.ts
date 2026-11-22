/**
 * The library message table (#71, ADR 0039).
 *
 * Every message the player sees from a library, such as "The cellar door is
 * locked." or the Restart button, is looked up here by key, so a game can
 * reword it, give it a voice, or translate it, without changing the library.
 * Each package registers its own messages with their defaults, declaring
 * their keys and what each one is about on {@link Messages}; a game replaces
 * them in `story.ts`.
 */
import { registry, type Registry, type RegistryEntry } from "../rules/registry.js";
import { StateError } from "../state/value.js";
import type { TextContext } from "./text.js";

/**
 * Every library message, by key, with what it's about: the values its text
 * can name, such as `{ door }` for "The cellar door is locked.".
 *
 * @remarks
 * Packages extend this interface, using declaration merging, for the
 * messages they register:
 *
 * ```ts
 * declare module "@loominate-if/core" {
 *   interface Messages {
 *     "door.locked": { readonly door: ObjectRef };
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Messages {}

/** A message's key, such as `door.locked`. */
export type MessageKey = keyof Messages & string;

/**
 * A message's text: plain words, or a function of the context. A `t`
 * template is one, and names what it's about by the context's names, as
 * `{The subj door}` does for a context with `door`.
 */
export type MessageText<C> = string | ((context: C) => string);

/** The message table: every library message's text, by key. */
export interface MessageTable {
  /**
   * Registers a library's message with its default text. A message already
   * set, such as one a game reworded before the library loaded, is kept.
   */
  register<K extends MessageKey>(
    key: K,
    text: MessageText<Messages[K]>,
    options?: { readonly source?: string },
  ): void;
  /** Rewords a message, as a game does in `story.ts`, whether or not its library has loaded yet. */
  replace<K extends MessageKey>(
    key: K,
    text: MessageText<Messages[K]>,
    options?: { readonly source?: string },
  ): void;
  /** A message's text now, or `undefined` if nothing registered it. */
  get<K extends MessageKey>(key: K): MessageText<Messages[K]> | undefined;
  /** Every message, with the package that set its text last, for the inspector. */
  entries(): readonly RegistryEntry<MessageText<never>>[];
}

const table: Registry<MessageText<never>> = registry<MessageText<never>>("messages");

/**
 * The message table. Libraries register their messages; a game rewords them.
 *
 * @example
 * ```ts
 * messages.replace("door.locked", t`Arr, {the door} be locked tight!`);
 * messages.replace("menu.restart", "Walk the plank");
 * ```
 */
export const messages: MessageTable = {
  register: (key, text, options) => {
    // A message already set stays: a game may reword it before the library
    // that registers it loads, and a package loaded twice, such as
    // presentation in the dev server's inspector and in the game, registers once.
    if (table.has(key)) return;
    table.register(key, text as MessageText<never>, options);
  },
  replace: (key, text, options) => {
    // The key is checked by its type; the library may not have registered it yet.
    if (table.has(key)) table.replace(key, text as MessageText<never>, options);
    else table.register(key, text as MessageText<never>, options);
  },
  get: (key) => table.get(key) as MessageText<Messages[typeof key]> | undefined,
  entries: () => table.entries(),
};

/**
 * Renders a library message: its text now, with `context`. Rendering is
 * pure, as for any text.
 *
 * @example
 * ```ts
 * message("door.locked", { door: cellarDoor }); // "The cellar door is locked."
 * ```
 *
 * @throws StateError if nothing registered the message.
 */
export function message<K extends MessageKey>(
  key: K,
  ...context: Record<string, never> extends Messages[K] ? [Messages[K]?] : [Messages[K]]
): string {
  const text = table.get(key) as MessageText<Messages[K]> | undefined;
  if (text === undefined) {
    throw new StateError(
      `message("${key}"): there's no such message. The library that uses it registers it when it's imported.`,
    );
  }
  const given = (context[0] ?? {}) as Messages[K];
  if (typeof text === "string") return text;
  return (text as (c: Messages[K] & TextContext) => string)(given as Messages[K] & TextContext);
}
