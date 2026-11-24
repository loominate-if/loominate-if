/**
 * Stackable quantities (#98, ADR 0071): ninety-nine turnips are one thing
 * with a count, not ninety-nine things. A kind of stackable thing is a
 * template; a stack is one thing of that kind. Splitting makes a new stack
 * with an ID from where it came from, and stacks of a kind merge whenever
 * they meet, unless the kind says not to.
 */
import {
  message,
  spawn,
  StateError,
  type Handle,
  type ObjectDefinition,
  type ObjectRef,
  type ObjectTemplate,
  type StateId,
} from "@loominate-if/core";
import { pluralize } from "./listing.js";
import {
  contents,
  onMove,
  thing,
  thingFor,
  thingTemplate,
  type Thing,
  type ThingOf,
} from "./things.js";

/** What a stack keeps: its count, and the kind it's of. */
export type StackFields = {
  /** How many it holds. Change it with {@link setCount}, or {@link split} and {@link move}. */
  count: number;
  /** The kind's name. */
  readonly stackOf: string;
};

/** A kind of stackable thing, made with {@link stackable}. */
export type StackKind<D = object> = {
  /** The kind's name, as `"turnip"`. */
  readonly name: string;
  /** The template a split's new stack is made from. */
  readonly template: ObjectTemplate<ThingOf<D> & StackFields>;
};

type KindInfo = {
  readonly single: string;
  readonly plural: string;
  readonly merges: boolean;
  readonly template: ObjectTemplate<object>;
  readonly definition: object;
};
const kinds = new Map<string, KindInfo>();

/** "a turnip", "an apple": the article for one, by how the word is usually said. */
const indefinite = (word: string): string => (/^[aeiou]/i.test(word) ? "an" : "a");

/**
 * Defines a kind of stackable thing, in `story.ts`. Its name and plural are
 * for one and for more: a stack of 99 is "the turnips", "99 turnips", and
 * takes plural verbs; a stack of one is "the turnip", "a turnip".
 *
 * @example
 * ```ts
 * export const turnip = stackable("turnip", { name: "turnip" });
 * export const ticket = stackable("ticket", { name: "raffle ticket", merges: false });
 * ```
 *
 * @param kind - unique among kinds and templates, as `"turnip"`.
 * @throws StateError if the kind is taken, or a property isn't valid state.
 */
export function stackable<D extends ObjectDefinition<D> & { name: string }>(
  kind: string,
  definition: D & {
    /** Its name for more than one, when adding "s" or "es" is wrong: "mice". */
    readonly plural?: string;
    /** Whether stacks of this kind merge when they meet. Defaults to `true`; `false` for numbered tickets. */
    readonly merges?: boolean;
  },
): StackKind<D> {
  const { name: single, plural = pluralize(definition.name), merges = true, ...rest } = definition;
  const counted = Object.defineProperties(
    { ...rest, count: 1, stackOf: kind },
    {
      name: {
        get(this: StackFields) {
          return this.count === 1 ? single : plural;
        },
        enumerable: true,
        configurable: true,
      },
      isPlural: {
        get(this: StackFields) {
          return this.count !== 1;
        },
        enumerable: true,
        configurable: true,
      },
      article: {
        get(this: StackFields) {
          return this.count === 1
            ? indefinite(single)
            : message("number.words", { count: this.count });
        },
        enumerable: true,
        configurable: true,
      },
      pluralName: { value: plural, enumerable: true, configurable: true },
    },
  ) as unknown as D;
  const template = thingTemplate(kind, counted);
  kinds.set(kind, {
    single,
    plural,
    merges,
    template: template as unknown as ObjectTemplate<object>,
    definition: counted,
  });
  return { name: kind, template: template as unknown as StackKind<D>["template"] };
}

/**
 * Defines a stack of a kind, in `story.ts`: one thing holding `count`.
 *
 * @example
 * ```ts
 * export const crate = stack("crate", turnip, { count: 99, location: barn });
 * ```
 *
 * @throws StateError if the ID is taken, or the count isn't a whole number, 1 or more.
 */
export function stack<Id extends StateId, D>(
  id: Id,
  kind: StackKind<D>,
  options: { readonly count: number; readonly location?: ObjectRef | null },
): Handle<ThingOf<D> & StackFields, Id> {
  const info = kindInfo(`stack ${JSON.stringify(id)}`, kind.name);
  whole(`stack ${JSON.stringify(id)}`, options.count);
  const definition = Object.defineProperties(
    Object.create(null) as object,
    Object.getOwnPropertyDescriptors(info.definition),
  );
  Object.assign(definition, { count: options.count, location: options.location ?? null });
  return thing(id, definition as { name: string }) as unknown as Handle<
    ThingOf<D> & StackFields,
    Id
  >;
}

const kindInfo = (where: string, kind: string): KindInfo => {
  const info = kinds.get(kind);
  if (!info) throw new StateError(`${where}: there's no stackable kind ${JSON.stringify(kind)}.`);
  return info;
};

const whole = (where: string, n: number): number => {
  if (!Number.isInteger(n) || n < 1) {
    throw new StateError(`${where}: ${String(n)} isn't a whole number, 1 or more.`);
  }
  return n;
};

/** The stack `t` is, or `undefined` if it isn't one. */
const asStack = (t: ObjectRef): (Thing & StackFields) | undefined => {
  const found = thingFor(t) as (Thing & Partial<StackFields>) | undefined;
  return found && typeof found.stackOf === "string" && typeof found.count === "number"
    ? (found as Thing & StackFields)
    : undefined;
};

/** One of a stack's kind, as words: "a turnip". @internal */
export function oneOf(s: ObjectRef): string {
  const info = kinds.get(stackFor("oneOf", s).stackOf);
  return info ? `${indefinite(info.single)} ${info.single}` : "";
}

/** Whether `t` is a stack. */
export function isStack(t: ObjectRef): boolean {
  return asStack(t) !== undefined;
}

const stackFor = (where: string, t: ObjectRef): Thing & StackFields => {
  const s = asStack(t);
  if (!s)
    throw new StateError(
      `${where}: ${JSON.stringify(t.id)} isn't a stack. Make it with stack() or split().`,
    );
  return s;
};

/** How many a stack holds. */
export function countOf(s: ObjectRef): number {
  return stackFor("countOf", s).count;
}

/** Sets how many a stack holds. At 0, it's taken out of the world. */
export function setCount(s: ObjectRef, count: number): void {
  const st = stackFor("setCount", s);
  if (!Number.isInteger(count) || count < 0) {
    throw new StateError(
      `setCount ${JSON.stringify(s.id)}: ${String(count)} isn't a whole number, 0 or more.`,
    );
  }
  st.count = count;
  if (count === 0) st.location = null;
}

/**
 * Splits `n` off a stack, as a new stack of the same kind in the same
 * place, and returns it; all of it, if `n` is its whole count, returns the
 * stack itself. The new stack's ID comes from the one it was split from,
 * as `gen:crate:turnip-1`. It doesn't merge back until it's moved.
 *
 * @throws StateError if `n` isn't a whole number from 1 to the stack's count.
 */
export function split(s: ObjectRef, n: number): Thing & StackFields {
  const st = stackFor("split", s);
  const where = `split ${JSON.stringify(s.id)}`;
  whole(where, n);
  if (n > st.count) {
    throw new StateError(
      `${where}: it holds ${String(st.count)}, so ${String(n)} can't be split off.`,
    );
  }
  if (n === st.count) return st;
  const info = kindInfo(where, st.stackOf);
  const made = asStack(spawn(info.template, st));
  if (!made) throw new StateError(`${where}: the new stack couldn't be made.`);
  made.count = n;
  made.location = st.location;
  st.count -= n;
  return made;
}

/** The stack of `kind` directly in or on `holder`, if there is one. */
export function stackIn(
  holder: ObjectRef,
  kind: StackKind | string,
): (Thing & StackFields) | undefined {
  const name = typeof kind === "string" ? kind : kind.name;
  for (const t of contents(holder)) {
    const s = asStack(t);
    if (s?.stackOf === name && s.count > 0) return s;
  }
  return undefined;
}

// Stacks of a kind merge whenever they meet: the one already there takes the count.
onMove((moved) => {
  const s = asStack(moved);
  const holder = s?.location;
  if (!s || !holder || s.count === 0 || kinds.get(s.stackOf)?.merges === false) return;
  const there = contents(holder).find((t) => {
    const other = asStack(t);
    return (
      other !== undefined && other.id !== s.id && other.stackOf === s.stackOf && other.count > 0
    );
  });
  const into = there && asStack(there);
  if (!into) return;
  into.count += s.count;
  s.count = 0;
  s.location = null;
});
