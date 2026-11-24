import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import type { CompilerExtension } from "../extensions/extension.js";
import { compileProject } from "./project.js";
import { checkTemplate, type KnownParameters } from "./text-parameters.js";

const known = (fallback = false): KnownParameters => ({
  names: new Map(["the", "The", "a", "A", "subj", "its"].map((n) => [n, "@loominate-if/world"])),
  fallbacks: fallback
    ? [{ from: "@loominate-if/world", reads: "a verb", words: new Set(["is", "has"]) }]
    : [],
});

/** The problems in the template literal `code`, as "start-end severity: message". */
function problems(code: string, fallback = false): string[] {
  const file = ts.createSourceFile("story.ts", `t${code};`, ts.ScriptTarget.Latest, true);
  const statement = file.statements[0] as ts.ExpressionStatement;
  const tagged = statement.expression as ts.TaggedTemplateExpression;
  return checkTemplate(tagged.template, file, known(fallback)).map(
    (p) => `${file.text.slice(p.start, p.end)} ${p.severity}: ${p.message}`,
  );
}

describe("checking t templates' message parameters (#235)", () => {
  it("accepts registered names, escaped braces, and values", () => {
    expect(problems("`{The subj ${door}} {is} open. {{Not a parameter.}}`", true)).toEqual([]);
    expect(problems("`Its handle: {its ${door}} \\u{1F6AA}`")).toEqual([]);
  });

  it("reports braces that don't match, nest, or have no name", () => {
    expect(problems("`A { with no end`")).toEqual([
      '{ error: A "{" with no "}" after it in this text. Write "{{" to print a brace.',
    ]);
    expect(problems("`A } alone`")).toEqual([
      '} error: A "}" with no "{" before it in this text. Write "}}" to print a brace.',
    ]);
    expect(problems("`{the {a}}`")[0]).toContain('A "{" inside a message parameter');
    expect(problems("`{${door}}`")[0]).toContain("A message parameter needs a name first");
  });

  it("reports a name nothing registers, suggesting the closest", () => {
    expect(problems("`{teh ${door}}`")).toEqual([
      "teh error: `{teh}` isn't a message parameter. Did you mean `{the}`?",
    ]);
    expect(problems("`{shout}`")[0]).toContain(
      "`{shout}` isn't a message parameter. Packages such as the world model register them",
    );
  });

  it("with a fallback, warns only of near misses, and never of words it knows", () => {
    expect(problems("`{teh ${door}}`", true)).toEqual([
      "teh warning: `{teh}` isn't a message parameter, so @loominate-if/world reads it as a verb. Did you mean `{the}`?",
    ]);
    expect(problems("`{The subj ${door}} {is} here and {has} {carries} a key.`", true)).toEqual([]);
  });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "__game__");
const compilerOptions = { customConditions: ["source"] };
const world: CompilerExtension = {
  name: "@loominate-if/world",
  messageParameters: { names: ["the", "The"], fallback: { reads: "a verb", words: ["is"] } },
};

// These build real TypeScript programs, which takes seconds under load (#314).
describe("the check in a game", { timeout: 30_000 }, () => {
  const story = `import { messageParameters, t } from "@loominate-if/core";
import { t as text } from "@loominate-if/core";
messageParameters.register("shout", () => "HEY");
export const door = { id: "door" };
export const a = t\`{shout} {teh \${door}}\`;
export const b = text\`{oops\`;
export const c = String.raw\`{not checked}\`;
export { t };
`;
  const diagnostics = (extensions: CompilerExtension[]) =>
    compileProject({
      root,
      files: [
        { path: "story.ts", text: story },
        { path: "start.weft", text: ":: Start\n{t`{The ${door}}`()}\n{t`{Teh ${door}}`()}\n" },
      ],
      compilerOptions,
      extensions,
    })
      .diagnostics.filter((d) => d.source === "compiler")
      .map(
        (d) =>
          `${path.relative(root, d.file)}:${String(d.line)}:${String(d.column)} ${d.severity}: ${d.message}`,
      );

  it("reports at the author's lines, in TypeScript and in passages, knowing the game's own names", () => {
    expect(diagnostics([])).toEqual([
      "start.weft:2:5 error: `{The}` isn't a message parameter. Did you mean `{shout}`?".replace(
        " Did you mean `{shout}`?",
        ' Packages such as the world model register them; check the name, or write "{{" to print a brace.',
      ),
      'start.weft:3:5 error: `{Teh}` isn\'t a message parameter. Packages such as the world model register them; check the name, or write "{{" to print a brace.',
      'story.ts:5:29 error: `{teh}` isn\'t a message parameter. Packages such as the world model register them; check the name, or write "{{" to print a brace.',
      'story.ts:6:23 error: A "{" with no "}" after it in this text. Write "{{" to print a brace.',
    ]);
  });

  it("with the world model's names and verbs, warns of a near miss", () => {
    expect(diagnostics([world])).toEqual([
      "start.weft:3:5 warning: `{Teh}` isn't a message parameter, so @loominate-if/world reads it as a verb. Did you mean `{The}`?",
      "story.ts:5:29 warning: `{teh}` isn't a message parameter, so @loominate-if/world reads it as a verb. Did you mean `{the}`?",
      'story.ts:6:23 error: A "{" with no "}" after it in this text. Write "{{" to print a brace.',
    ]);
  });
});
