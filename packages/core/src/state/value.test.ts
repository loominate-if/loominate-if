import { describe, expect, it } from "vitest";
import { freezeValue, StateError, valuesEqual } from "./value.js";

const where = `state "lantern".fuel`;

describe("freezeValue", () => {
  it("accepts JSON-compatible data and returns a deep frozen copy", () => {
    const input = { lit: true, fuel: 3, name: "brass", tags: ["light", { worn: null }] };
    const out = freezeValue(input, where);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
    expect(Object.isFrozen(out)).toBe(true);
    const tags = (out as { tags: readonly unknown[] }).tags;
    expect(Object.isFrozen(tags)).toBe(true);
    expect(Object.isFrozen(tags[1])).toBe(true);
    input.tags.push("changed");
    expect(out).toEqual({ lit: true, fuel: 3, name: "brass", tags: ["light", { worn: null }] });
  });

  it("stores -0 as 0, since JSON can't round-trip it", () => {
    expect(Object.is(freezeValue(-0, where), 0)).toBe(true);
  });

  it("keeps a __proto__ key as data", () => {
    const out = freezeValue(JSON.parse(`{"__proto__": 1}`), where) as Record<string, unknown>;
    expect(Object.hasOwn(out, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });

  it.each([
    ["undefined", undefined, /undefined can't be stored/],
    ["NaN", Number.NaN, /NaN can't be stored/],
    ["Infinity", Number.POSITIVE_INFINITY, /Infinity can't be stored/],
    ["a function", () => 1, /a function can't be stored/],
    ["a bigint", 1n, /a bigint can't be stored/],
    ["a Date", new Date(0), /a Date can't be stored/],
    ["a Map", new Map(), /a Map can't be stored/],
    [
      "a class instance",
      new (class Lantern {
        lit = false;
      })(),
      /a Lantern can't be stored/,
    ],
    ["a sparse array", new Array<number>(2), /hole at index 0/],
    ["symbol keys", { [Symbol("s")]: 1 }, /symbol keys/],
  ])("rejects %s", (_, value, message) => {
    expect(() => freezeValue(value, where)).toThrow(StateError);
    expect(() => freezeValue(value, where)).toThrow(message);
  });

  it("names the path to a bad nested value", () => {
    expect(() => freezeValue({ a: [{ b: undefined }] }, where)).toThrow(
      `state "lantern".fuel.a[0].b: undefined can't be stored.`,
    );
  });

  it("rejects cycles but allows shared references", () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => freezeValue(loop, where)).toThrow(/contains itself/);
    const shared = { x: 1 };
    expect(freezeValue({ a: shared, b: shared }, where)).toEqual({ a: { x: 1 }, b: { x: 1 } });
  });
});

describe("valuesEqual", () => {
  it("compares structurally, ignoring object key order", () => {
    expect(valuesEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(valuesEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(valuesEqual([1, 2], [2, 1])).toBe(false);
    expect(valuesEqual([], {})).toBe(false);
    expect(valuesEqual(null, undefined)).toBe(false);
    expect(valuesEqual(undefined, undefined)).toBe(true);
  });
});
