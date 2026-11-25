/** The TextMate grammar (#414), tokenized as VS Code does, with Oniguruma. */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as onig from "vscode-oniguruma";
import * as tm from "vscode-textmate";

const here = path.dirname(fileURLToPath(import.meta.url));
const grammarFile = path.join(here, "../syntaxes/weft.tmLanguage.json");
const wasm = readFileSync(
  path.join(path.dirname(createRequire(import.meta.url).resolve("vscode-oniguruma")), "onig.wasm"),
);

/** A stand-in for VS Code's TypeScript grammar: identifiers, strings, and nested braces. */
const typescript = {
  scopeName: "source.ts",
  patterns: [
    { match: "[A-Za-z_$][\\w$]*", name: "variable.ts" },
    { match: '"[^"]*"', name: "string.ts" },
    { begin: "\\{", end: "\\}", patterns: [{ include: "$self" }] },
  ],
};

const registry = new tm.Registry({
  onigLib: onig
    .loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength))
    .then(() => ({
      createOnigScanner: (sources: string[]) => new onig.OnigScanner(sources),
      createOnigString: (text: string) => new onig.OnigString(text),
    })),
  loadGrammar: (scope) =>
    Promise.resolve(
      scope === "source.weft"
        ? tm.parseRawGrammar(readFileSync(grammarFile, "utf8"), grammarFile)
        : (typescript as unknown as tm.IRawGrammar),
    ),
});

/** Each token's text and its innermost weft scope (or TypeScript's), line by line. */
async function tokens(text: string): Promise<[string, string][]> {
  const grammar = await registry.loadGrammar("source.weft");
  if (!grammar) throw new Error("no grammar");
  let state = tm.INITIAL;
  const out: [string, string][] = [];
  for (const line of text.split("\n")) {
    const result = grammar.tokenizeLine(line, state);
    state = result.ruleStack;
    for (const t of result.tokens) {
      const scope = t.scopes.filter((s) => s !== "source.weft" && !s.startsWith("meta.")).at(-1);
      const piece = line.slice(t.startIndex, t.endIndex);
      if (scope && piece.trim()) out.push([piece, scope]);
    }
  }
  return out;
}

const scopeOf = (all: [string, string][], text: string) => all.find(([t]) => t === text)?.[1];

describe("the TextMate grammar", () => {
  it("colors headers and their tags", async () => {
    const all = await tokens(":: Cellar Stairs [room: stairs, scene]");
    expect(scopeOf(all, "Cellar Stairs")).toBe("entity.name.section.weft");
    expect(scopeOf(all, "room")).toBe("entity.other.attribute-name.weft");
    expect(scopeOf(all, "stairs")).toBe("string.unquoted.weft");
    expect(scopeOf(all, "scene")).toBe("entity.other.attribute-name.weft");
  });

  it("colors directives, and inline code as TypeScript, but no words in prose", async () => {
    const all = await tokens(
      '{on first visit: night.ship = "x"}\nIt is {lamp.lit}, in no time, if ever.\n{if a}A{else}B{/if}\n{stage left}',
    );
    expect(scopeOf(all, "on first visit")).toBe("keyword.control.directive.weft");
    expect(scopeOf(all, "night")).toBe("variable.ts");
    expect(scopeOf(all, "lamp")).toBe("variable.ts");
    expect(all.filter(([, s]) => s === "keyword.control.directive.weft").map(([t]) => t)).toEqual([
      "on first visit",
      "if",
      "else",
      "/if",
    ]);
    expect(scopeOf(all, "stage")).toBe("variable.ts");
  });

  it("keeps nested braces inside inline code", async () => {
    const all = await tokens("{on enter: if (x) { y() }} after");
    expect(scopeOf(all, "y")).toBe("variable.ts");
    expect(all.at(-1)).toEqual(["}", "punctuation.section.braces.end.weft"]);
  });

  it("colors links' labels and targets apart", async () => {
    const all = await tokens(
      "[[supply shed -> Shed]] and [[Hall]]{when lit, hidden}\n{continue -> Cottage}",
    );
    expect(scopeOf(all, "supply shed ")).toBe("string.other.link.title.weft");
    expect(scopeOf(all, "Shed")).toBe("markup.underline.link.weft");
    expect(scopeOf(all, "Hall")).toBe("markup.underline.link.weft");
    expect(scopeOf(all, "Cottage")).toBe("entity.name.label.passage.weft");
  });

  it("colors comments, escapes, and formatting", async () => {
    const all = await tokens("/* a */ See http://x.com. \\{ *some* **no**\n  // line");
    expect(scopeOf(all, "/*")).toBe("comment.block.weft");
    expect(scopeOf(all, "\\{")).toBe("constant.character.escape.weft");
    expect(scopeOf(all, "*some*")).toBe("markup.italic.weft");
    expect(scopeOf(all, "**no**")).toBe("markup.bold.weft");
    expect(scopeOf(all, " line")).toBe("comment.line.double-slash.weft");
    expect(all.some(([t, s]) => t.includes("http") && s.startsWith("comment"))).toBe(false);
  });
});
