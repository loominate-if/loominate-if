import { describe, expect, it } from "vitest";
import { authorMessage, missingName, undefinedNameMessage } from "./messages.js";

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

describe("undefinedNameMessage", () => {
  it("reads the name from TypeScript's message", () => {
    expect(missingName("Cannot find name 'lamp'.")).toBe("lamp");
    expect(missingName("Cannot find name 'lamp'. Did you mean 'Map'?")).toBe("lamp");
    expect(missingName("Type 'string' is not assignable to type 'number'.")).toBeUndefined();
  });

  it("re-exports, suggests, or explains, in that order", () => {
    const exportedBy = { path: "items.ts", specifier: "./items.js" };
    expect(
      undefinedNameMessage("rope", { scope: "story.ts", exportedBy, suggestion: "robe" }),
    ).toBe(
      '`rope` is exported by `items.ts`, but passages only see what `story.ts` exports. Add `export { rope } from "./items.js";` to `story.ts`.',
    );
    expect(undefinedNameMessage("lamp", { scope: "game/story.ts", suggestion: "lantern" })).toBe(
      "`lamp` isn't defined. Did you mean `lantern`?",
    );
    expect(undefinedNameMessage("lamp", { scope: "game/story.ts" })).toBe(
      "`lamp` isn't defined. Passages can use what `game/story.ts` exports, and `visits`, `firstVisit`, and `visited`.",
    );
    expect(undefinedNameMessage("lamp", { scope: undefined })).toBe(
      "`lamp` isn't defined. To use it in passages, export it from `story.ts`.",
    );
  });
});
