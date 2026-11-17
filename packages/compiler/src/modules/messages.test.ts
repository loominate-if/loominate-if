import { describe, expect, it } from "vitest";
import { authorMessage } from "./messages.js";

const lantern = `'Handle<{ name: string; taken: boolean; light(): void; }, "lantern">'`;

describe("authorMessage", () => {
  it("names an object by ID when a property doesn't exist", () => {
    expect(
      authorMessage(`Property 'takn' does not exist on type ${lantern}. Did you mean 'taken'?`),
    ).toBe("`lantern` has no property `takn`. Did you mean `taken`?");
    expect(authorMessage(`Property 'zz' does not exist on type ${lantern}.`)).toBe(
      "`lantern` has no property `zz`.",
    );
  });

  it("explains that objects can't be printed", () => {
    const message = `Argument of type ${lantern} is not assignable to parameter of type 'string | number'.`;
    expect(authorMessage(message, { printed: true })).toBe(
      "`lantern` is an object, so it can't be printed. Print one of its properties instead, such as `{lantern.name}`.",
    );
    expect(
      authorMessage(
        `Argument of type 'Handle<{ isLit: boolean; }, "lamp">' is not assignable to parameter of type 'string | number'.`,
        { printed: true },
      ),
    ).toBe("`lamp` is an object, so it can't be printed. Print one of its properties instead.");
    // The same message outside prose is an ordinary argument error.
    expect(authorMessage(message)).toBe(
      "Argument of object `lantern` is not assignable to parameter of type 'string | number'.",
    );
  });

  it("names objects anywhere else in a message, including chained lines", () => {
    expect(
      authorMessage(
        `Type ${lantern} is not assignable to type 'string'.\n  Type 'Handle<{ a: number; }, "a">' is not assignable to type 'string'.`,
      ),
    ).toBe(
      "Type object `lantern` is not assignable to type 'string'.\n  Type object `a` is not assignable to type 'string'.",
    );
  });

  it("drops the Handle wrapper when the type has no single ID", () => {
    expect(
      authorMessage(
        `Property 'isLot' does not exist on type 'Handle<{ isLit: boolean; }, string>'. Did you mean 'isLit'?`,
      ),
    ).toBe("Property 'isLot' does not exist on type '{ isLit: boolean; }'. Did you mean 'isLit'?");
    expect(
      authorMessage(`Property 'nam' does not exist on type 'Handle<{ name: string; }>'.`),
    ).toBe("Property 'nam' does not exist on type '{ name: string; }'.");
  });

  it("copes with nested types, long types, and string literals with commas", () => {
    expect(
      authorMessage(
        `Property 'x' does not exist on type 'Handle<{ tags: Map<string, number>; mood: "calm, mostly" | "angry"; ... 5 more ...; z: number; }, "the \\"cat\\"">'.`,
      ),
    ).toBe('`the "cat"` has no property `x`.');
  });

  it("leaves other messages alone", () => {
    for (const message of [
      "Cannot find name 'lamp'.",
      "Type 'string' is not assignable to type 'number'.",
      "Property 'x' does not exist on type 'Handle'.",
    ]) {
      expect(authorMessage(message)).toBe(message);
    }
  });
});
