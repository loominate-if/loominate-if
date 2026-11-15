/**
 * State values: the JSON-compatible data the state store accepts.
 *
 * Restricting state to plain data is what makes save, undo, replay, and the
 * inspector possible (design principle "State is data, behavior is code").
 */

/**
 * A value the state store can hold: JSON-compatible plain data.
 *
 * @remarks
 * Numbers must be finite; `-0` is stored as `0`. Objects must be plain objects
 * (no class instances, `Map`, `Set`, or `Date`), and arrays must not have holes.
 * Values are frozen once stored, so reading one never gives you a way to change
 * state behind the store's back.
 *
 * Describe object-shaped state with a `type` alias rather than an `interface`:
 * TypeScript only treats type aliases as matching the object branch's index signature.
 */
export type StateValue =
  null | boolean | number | string | readonly StateValue[] | { readonly [key: string]: StateValue };

/** Thrown when the state store is given something it can't hold or a diff that doesn't fit. */
export class StateError extends Error {
  /** Always `"StateError"`. */
  override readonly name = "StateError";
}

/** Describes `value` for error messages without dumping large structures. */
function describe(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "number") return String(value);
  if (typeof value === "function") return "a function";
  if (typeof value === "symbol") return "a symbol";
  if (typeof value === "bigint") return "a bigint";
  if (typeof value === "object" && value !== null) {
    const name = (Object.getPrototypeOf(value) as { constructor?: { name?: string } } | null)
      ?.constructor?.name;
    return name ? `a ${name}` : "an object";
  }
  return JSON.stringify(value);
}

function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Validates `value` and returns a deep, frozen copy of it.
 *
 * @param where - where the value is going, for error messages, e.g. `state "lantern".fuel`.
 * @throws {@link StateError} if `value` isn't a {@link StateValue}.
 */
export function freezeValue(value: unknown, where: string): StateValue {
  return freeze(value, where, new Set());
}

function freeze(value: unknown, where: string, ancestors: Set<object>): StateValue {
  const fail = (why: string): never => {
    throw new StateError(
      `${where}: ${why} State values must be JSON-compatible: null, booleans, finite numbers, strings, arrays, and plain objects.`,
    );
  };
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${describe(value)} can't be stored.`);
    return value === 0 ? 0 : value;
  }
  if (typeof value !== "object") return fail(`${describe(value)} can't be stored.`);
  if (ancestors.has(value)) fail("the value contains itself.");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const out: StateValue[] = [];
      for (let i = 0; i < value.length; i++) {
        if (!(i in value)) fail(`the array has a hole at index ${i}.`);
        out.push(freeze(value[i], `${where}[${i}]`, ancestors));
      }
      return Object.freeze(out);
    }
    if (!isPlainObject(value)) fail(`${describe(value)} can't be stored.`);
    if (Object.getOwnPropertySymbols(value).length > 0) fail("the object has symbol keys.");
    const entries = Object.keys(value).map((k): [string, StateValue] => [
      k,
      freeze((value as Record<string, unknown>)[k], `${where}.${k}`, ancestors),
    ]);
    // fromEntries defines own properties, so a "__proto__" key stays data.
    return Object.freeze(Object.fromEntries(entries));
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Structural equality for state values. Object key order doesn't matter.
 */
export function valuesEqual(a: StateValue | undefined, b: StateValue | undefined): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => valuesEqual(v, b[i]));
  }
  const ao = a as { readonly [key: string]: StateValue };
  const bo = b as { readonly [key: string]: StateValue };
  const keys = Object.keys(ao);
  if (keys.length !== Object.keys(bo).length) return false;
  return keys.every((k) => Object.hasOwn(bo, k) && valuesEqual(ao[k], bo[k]));
}
