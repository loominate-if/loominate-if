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

describe("authorMessage in passages", () => {
  const printed = (type: string, code: string): string =>
    authorMessage(
      `Argument of type '${type}' is not assignable to parameter of type 'string | number'.\n  Type 'null' is not assignable to type 'string | number'.`,
      { printed: true, code },
    );

  it("explains values prose can't show, and how to show them", () => {
    expect(printed("boolean", "lantern.isLit")).toBe(
      "`lantern.isLit` is true or false, so it can't be printed. To show text that depends on it, use `{if lantern.isLit}…{else}…{/if}`.",
    );
    expect(printed("string | null", "player.nick")).toBe(
      '`player.nick` might be `null`, so it can\'t be printed. Give it a fallback, like `{player.nick ?? "…"}`, or check it first with `{if player.nick !== null}…{/if}`.',
    );
    expect(printed("number | null | undefined", "n")).toBe(
      '`n` might be `null` or `undefined`, so it can\'t be printed. Give it a fallback, like `{n ?? "…"}`, or check it first with `{if n != null}…{/if}`.',
    );
    expect(printed("string[]", "bag")).toBe(
      '`bag` is a list, so it can\'t be printed. Join it into text, like `{bag.join(", ")}`.',
    );
    expect(printed("Handle<object>[]", "bag")).toBe(
      '`bag` is a list of objects, so it can\'t be printed. Print a property of each one, like `{bag.map((item) => item.name).join(", ")}`.',
    );
    expect(printed("(fractionDigits?: number | undefined) => string", "oil.toFixed")).toBe(
      "`oil.toFixed` is a function, so it can't be printed. Call it to print what it returns: `{oil.toFixed()}`.",
    );
  });

  it("leaves printed types it has no advice for, and unprinted values, to the other rules", () => {
    expect(printed("{ a: number; }", "x")).toContain("Argument of type '{ a: number; }'");
    expect(
      authorMessage(
        "Argument of type 'boolean' is not assignable to parameter of type 'string | number'.",
        { code: "x" },
      ),
    ).toBe("Argument of type 'boolean' is not assignable to parameter of type 'string | number'.");
  });

  it("treats a misspelled passage name like a broken link", () => {
    const passages = ["Cellar", "Kitchen"];
    const message = (name: string) =>
      authorMessage(
        `Argument of type '${JSON.stringify(name)}' is not assignable to parameter of type 'PassageName'.`,
        { passages },
      );
    expect(message("Cellr")).toBe("There's no passage named `Cellr`. Did you mean `Cellar`?");
    expect(message("Attic")).toBe(
      "There's no passage named `Attic`. Check the spelling, or add the passage.",
    );
  });

  it("explains assignments the property can't hold, but not other type mismatches", () => {
    const message = `Type '"happy"' is not assignable to type '"calm" | "scared"'.`;
    expect(authorMessage(message, { code: "player.mood", assigned: true })).toBe(
      '`player.mood` holds `"calm" | "scared"`, so it can\'t be set to `"happy"`.',
    );
    expect(authorMessage(message, { code: "player.mood" })).toBe(message);
  });

  it("explains comparisons that can never match", () => {
    expect(
      authorMessage(
        "This comparison appears to be unintentional because the types 'number' and 'string' have no overlap.",
      ),
    ).toBe(
      "This comparison can never match: one side is `number` and the other is `string`. Check the value you're comparing with.",
    );
  });

  it("explains replacing a scope export, and calling visits", () => {
    expect(
      authorMessage("Cannot assign to 'lantern' because it is an import.", { scope: "story.ts" }),
    ).toBe(
      "`lantern` comes from `story.ts`, and passages can't replace it. Change one of its properties instead.",
    );
    expect(
      authorMessage("This expression is not callable.\n  Type 'Number' has no call signatures.", {
        code: "visits",
      }),
    ).toBe(
      '`visits` is how many times this passage has been visited, not a function. To ask about another passage, use `visited("…")`.',
    );
  });

  it("counts arguments in plain words", () => {
    expect(authorMessage("Expected 1 arguments, but got 0.", { code: "greet()" })).toBe(
      "`greet()` needs 1 argument, but has none.",
    );
    expect(authorMessage("Expected 1-2 arguments, but got 3.", { code: "x" })).toBe(
      "This call needs 1-2 arguments, but has 3.",
    );
    expect(authorMessage("Expected 2 arguments, but got 3 or more.")).toBe(
      "This call needs 2 arguments, but has 3 or more.",
    );
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
