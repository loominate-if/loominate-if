import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generatePassageModule } from "../modules/generate.js";
import { compileProject } from "../modules/project.js";
import { parsePassageFile } from "../passages/parse.js";
import { coreExtension } from "./core.js";
import type { CompilerExtension } from "./extension.js";
import { resolveExtensions } from "./resolve.js";

/** A stand-in for the world model's conversation syntax. */
const world: CompilerExtension = {
  name: "@loominate-if/world",
  tagRoles: [
    { name: "actor", entry: true },
    { name: "room", entry: true },
  ],
  directives: [
    {
      name: "ask",
      kind: "content",
      roles: ["actor"],
      example: "{ask letter}",
      args: [
        { name: "topic", kind: "words", required: true },
        { name: "again", kind: "choice", choices: ["again"] },
        { name: "when", kind: "condition", named: true },
      ],
      runtime: { module: "@loominate-if/world", export: "askEntry" },
    },
    {
      name: "show",
      kind: "content",
      roles: ["actor"],
      args: [{ name: "item", kind: "expression", required: true }],
      runtime: { module: "@loominate-if/world", export: "showEntry" },
    },
  ],
};

/** A stand-in for the VN kit's stage directive and dialogue lines. */
const vn: CompilerExtension = {
  name: "@loominate-if/vn",
  directives: [
    {
      name: "show",
      kind: "content",
      example: "{show mira smiling, dissolve}",
      args: [
        { name: "sprite", kind: "words", required: true },
        { name: "transition", kind: "choice", choices: ["dissolve", "cut"] },
        { name: "after", kind: "duration", named: true },
      ],
      runtime: { module: "@loominate-if/vn", export: "show" },
    },
  ],
  lineForms: [
    {
      name: "dialogue",
      prefix: "@",
      pattern: /(?<speaker>\w+)(?: \((?<expression>\w+)\))? "(?<text>[^"]*)"/,
      example: '@mira (nervous) "Hello."',
      runtime: { module: "@loominate-if/vn", export: "say" },
    },
  ],
};

function generate(source: string, extensions: readonly CompilerExtension[] = []) {
  const syntax = resolveExtensions(extensions);
  const parsed = parsePassageFile(source, {
    file: "scene.weft",
    directives: syntax.parserDirectives,
    lineForms: syntax.parserLineForms,
  });
  const generated = generatePassageModule(parsed, source, {
    modulePath: "/game/scene.weft.ts",
    scopeExports: new Set(["letter", "photograph"]),
    scopeSpecifier: "./story.js",
    passageNamesSpecifier: "./$passages.js",
    extensions,
  });
  const problems = [...parsed.diagnostics, ...generated.diagnostics].map(
    (d) =>
      `${String(d.line)}:${String(d.column)} ${d.severity === "warning" ? "warning: " : ""}${d.message}`,
  );
  return { code: generated.code, problems };
}

describe("package directives", () => {
  it("compile to a call of the package's runtime export, with arguments by kind", () => {
    const { code, problems } = generate(
      ":: Rooftop\n{show mira smiling, dissolve, after: 1.5s}\nThe wind picks up.",
      [vn],
    );
    expect(problems).toEqual([]);
    expect(code).toContain('import { show as $rt_show } from "@loominate-if/vn";');
    expect(code).toContain(
      '$nodes.push(...[$rt_show({ sprite: ["mira", "smiling"], transition: "dissolve", after: 1500 })].flat());',
    );
  });

  it("can share a name when they're limited to separate tag roles", () => {
    const both = [world, vn];
    const actor = generate(":: Butler [actor: butler]\n{show photograph}\nHe studies it.", both);
    expect(actor.problems).toEqual([]);
    expect(actor.code).toContain("$rt_showEntry({ item: photograph })");
    const scene = generate(":: Rooftop\n{show mira}", both);
    expect(scene.code).toContain('$rt_show({ sprite: ["mira"] })');
  });

  it("are refused outside their roles", () => {
    expect(generate(":: Hall\n{ask letter}", [world]).problems).toEqual([
      "2:1 `{ask}` from @loominate-if/world only works in passages with the `actor:` role.",
    ]);
  });

  it("check their arguments against the declaration", () => {
    const { problems } = generate(
      [
        ":: Butler [actor: butler]",
        "{ask}",
        "{ask letter, never}",
        "{ask letter, again, mood: 3}",
        "{ask letter, -> Hall}",
        "{ask {x}}",
      ].join("\n"),
      [world],
    );
    expect(problems).toEqual([
      "2:1 `{ask}` needs words (topic), like `{ask letter}`.",
      "3:14 `{ask}` takes `again` here, not `never`.",
      "4:21 `{ask}` has no `mood:` argument. It takes words (topic), then optionally `again`, then optionally `when: …`.",
      "5:14 `{ask}` doesn't take a passage. It takes words (topic), then optionally `again`, then optionally `when: …`.",
      "6:6 `{ask}` takes plain words for topic, but `{x}` isn't one.",
    ]);
    expect(generate(":: R\n{show mira, after: soon}", [vn]).problems).toEqual([
      "2:13 `{show}` needs a duration such as `1.5s` or `300ms`, not `soon`.",
    ]);
  });

  it("pass conditions with their text, for the inspector", () => {
    const { code } = generate(":: Butler [actor: butler]\n{ask letter, when: letter.found}", [
      world,
    ]);
    expect(code).toContain(
      '$rt_askEntry({ topic: ["letter"], when: { value: Boolean(letter.found), text: "letter.found" } })',
    );
  });
});

describe("unloaded packages", () => {
  it("are named when a game uses their syntax", () => {
    expect(generate(":: Butler [actor: butler]\n{ask letter}\n{reveal facts.x}").problems).toEqual([
      "1:12 The tag role `actor:` comes from @loominate-if/world, which this game doesn't load. Install it and add it to the game's extensions.",
      "2:1 `{ask}` comes from @loominate-if/world, which this game doesn't load. Install it and add it to the game's extensions.",
      "3:1 `{reveal}` comes from @loominate-if/world, which this game doesn't load. Install it and add it to the game's extensions.",
    ]);
    expect(generate(":: R\n{show mira}").problems).toEqual([
      "2:1 `{show}` comes from @loominate-if/world or @loominate-if/vn, which this game doesn't load. Install it and add it to the game's extensions.",
    ]);
  });

  it("can be suggested by other packages", () => {
    const kit: CompilerExtension = {
      name: "loominate-heists",
      suggests: { directive: { crack: "loominate-safes" } },
    };
    expect(generate(":: Vault\n{crack safe}", [kit]).problems).toEqual([
      "2:1 `{crack}` comes from loominate-safes, which this game doesn't load. Install it and add it to the game's extensions.",
    ]);
  });

  it("aren't blamed for a game's own variables, or roles only its code reads", () => {
    // `letter` is the game's own export: an expression, printed.
    expect(generate(":: A\n{letter}").problems).toEqual([]);
    expect(generate(":: A [chapter: 2]\nText.").problems).toEqual([
      "1:7 warning: No loaded package uses the tag role `chapter:`. If it's a typo, fix it; if the game's own code reads it, this is fine.",
    ]);
  });
});

describe("line forms", () => {
  it("compile each line to a call with the pattern's groups", () => {
    const { code, problems } = generate(
      ':: Rooftop\n@mira (nervous) "I didn\'t think you\'d come."\n@player "You asked me to."\n\\@ is just a character.',
      [vn],
    );
    expect(problems).toEqual([]);
    expect(code).toContain(
      `$rt_say({ "speaker": "mira", "expression": "nervous", "text": "I didn't think you'd come." })`,
    );
    expect(code).toContain(`$rt_say({ "speaker": "player", "text": "You asked me to." })`);
    expect(code).toContain('$parts.push("@ is just a character.");');
  });

  it("report a line that doesn't fit the form", () => {
    expect(generate(":: R\n@mira shrugs.", [vn]).problems).toEqual([
      "2:1 This line starts with `@`, so it's a dialogue line (from @loominate-if/vn), but the rest doesn't fit that form. Write it like `@mira (nervous) \"Hello.\"`. Write `\\@` for a literal `@`.",
    ]);
  });

  it("are plain prose without the package", () => {
    const { code, problems } = generate(":: R\n@home again.");
    expect(problems).toEqual([]);
    expect(code).toContain('$parts.push("@home again.");');
  });
});

describe("loading extensions", () => {
  const fails = (extensions: CompilerExtension[]) => () => resolveExtensions(extensions);

  it("refuses two packages giving one name the same meaning", () => {
    const other: CompilerExtension = {
      name: "other-vn",
      directives: [{ name: "show", kind: "content", unsupported: "never" }],
    };
    expect(fails([vn, other])).toThrow(
      "`{show}` is registered by both @loominate-if/vn and other-vn for the same passages, so its meaning would depend on load order. Limit one to other tag roles, or rename it.",
    );
    expect(
      fails([{ name: "x", directives: [{ name: "continue", kind: "effect", phase: "enter" }] }]),
    ).toThrow("`{continue}` is registered by @loominate-if/core and x in different forms.");
    expect(
      fails([
        { name: "x", tagRoles: [{ name: "room" }] },
        { name: "y", tagRoles: [{ name: "room" }] },
      ]),
    ).toThrow("The tag role `room:` is registered by both x and y.");
    expect(fails([vn, { name: "y", lineForms: vn.lineForms ?? [] }])).toThrow(
      "Lines starting with `@` are registered by both @loominate-if/vn and y.",
    );
    expect(fails([vn, vn])).toThrow("The compiler extension @loominate-if/vn is loaded twice.");
    expect(fails([vn, { ...vn }])).toThrow(
      "The compiler extension @loominate-if/vn is loaded twice.",
    );
  });

  it("explains malformed definitions", () => {
    const one = (d: NonNullable<CompilerExtension["directives"]>[number]) =>
      fails([{ name: "kit", directives: [d] }]);
    expect(one({ name: "Show", kind: "annotation" })).toThrow(
      'kit: directive "Show": names are lowercase words separated by single spaces.',
    );
    expect(one({ name: "else if", kind: "annotation" })).toThrow("part of the passage grammar");
    expect(one({ name: "x", kind: "content" })).toThrow(
      "give it a `runtime` export to call, or say why it's `unsupported`.",
    );
    expect(
      one({
        name: "x",
        kind: "annotation",
        args: [
          { name: "a", kind: "words" },
          { name: "b", kind: "words", required: true },
        ],
      }),
    ).toThrow("put required positional arguments first");
    expect(one({ name: "x", kind: "annotation", args: [{ name: "a", kind: "choice" }] })).toThrow(
      "needs the words it accepts, in `choices`.",
    );
    expect(one({ name: "x", kind: "annotation", roles: ["actor"] })).toThrow(
      'kit: directive "x" is limited to the tag role `actor:`, which no loaded package registers.',
    );
    expect(
      fails([
        {
          name: "kit",
          lineForms: [
            { name: "x", prefix: "{", pattern: /x/, runtime: { module: "m", export: "e" } },
          ],
        },
      ]),
    ).toThrow(
      "the prefix must be one ASCII punctuation character not already used by passage syntax",
    );
  });

  it("always loads core's first, and lists core's directives through the same API", () => {
    const syntax = resolveExtensions([coreExtension]);
    expect(syntax.parserDirectives.map((d) => d.name).sort()).toEqual([
      "beat",
      "continue",
      "effect",
      "line",
      "on enter",
      "on first visit",
      "on leave",
      "wait",
      "when",
    ]);
    expect(syntax.directives.get("continue")?.[0]?.from).toBe("@loominate-if/core");
  });
});

describe("in a project", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.join(here, "__game__");
  const compilerOptions = { customConditions: ["source"] };
  const stage = `
import type { TextNode } from "@loominate-if/core";
export function show(args: { readonly sprite: readonly string[]; readonly transition?: "dissolve" | "cut" }): TextNode {
  return { type: "text", text: \`[\${args.sprite.join(" ")}]\` };
}
export function say(args: { readonly speaker: string; readonly text: string }): TextNode {
  return { type: "text", text: \`\${args.speaker}: \${args.text}\` };
}
`;
  /** The VN stand-in, calling a module in the game instead of a package. */
  const local: CompilerExtension = {
    ...vn,
    directives: (vn.directives ?? []).map((d) => ({
      ...d,
      runtime: { module: "./stage.js", export: "show" },
    })),
    lineForms: (vn.lineForms ?? []).map((f) => ({
      ...f,
      runtime: { module: "./stage.js", export: "say" },
    })),
  };
  const compile = (scene: string, extensions: CompilerExtension[], start?: string) =>
    compileProject({
      root,
      compilerOptions,
      extensions,
      ...(start !== undefined && { start }),
      files: [
        { path: "stage.ts", text: stage },
        { path: "scene.weft", text: scene },
      ],
    }).diagnostics.map((d) => `${String(d.line)}:${String(d.column)} ${d.source}: ${d.message}`);

  it("type-checks each call against the runtime export's real signature", () => {
    expect(compile(':: R\n{show mira, dissolve}\n@mira "Hi."', [local])).toEqual([]);
    const [problem] = compile(":: R\n{show mira, cut, after: 2s}", [local]);
    expect(problem).toMatch(/^2:1 typescript: .*after/);
  });

  it("runs packages' checks, naming the check", () => {
    const strict: CompilerExtension = {
      name: "strict-kit",
      checks: [
        {
          name: "no-shouting",
          run: ({ files }) =>
            files.flatMap((f) =>
              f.passages
                .filter((p) => p.name.name === p.name.name.toUpperCase())
                .map((p) => ({
                  severity: "warning" as const,
                  file: f.file,
                  message: `Passage ${p.name.name} is shouting.`,
                  span: p.name.span,
                })),
            ),
        },
      ],
    };
    const result = compileProject({
      root,
      compilerOptions,
      extensions: [strict],
      files: [{ path: "scene.weft", text: ":: HALL\nQuiet." }],
    });
    expect(result.diagnostics).toMatchObject([
      {
        severity: "warning",
        source: "extension",
        check: "strict-kit: no-shouting",
        line: 1,
        column: 4,
        message: "Passage HALL is shouting.",
      },
    ]);
    const broken: CompilerExtension = {
      name: "broken-kit",
      checks: [
        {
          name: "boom",
          run: () => {
            throw new Error("no");
          },
        },
      ],
    };
    expect(() =>
      compileProject({ root, compilerOptions, extensions: [broken], files: [] }),
    ).toThrow('The check "boom" from broken-kit failed: no');
  });

  it("doesn't report passages a package enters itself as unreachable", () => {
    const scene = ":: Start\nHello.\n\n:: Butler [actor: butler]\nHe bows.\n\n:: Attic\nDust.";
    expect(compile(scene, [world], "Start")).toEqual([
      "7:4 compiler: Nothing leads to `Attic` from `Start`, so players can't reach it. Link to it from another passage, or remove it.",
    ]);
  });
});
