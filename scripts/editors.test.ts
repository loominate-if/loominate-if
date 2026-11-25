/**
 * The editor support that isn't TypeScript (#411, ADR 0119): the Tree-sitter
 * grammar for passage files, and the Zed extension that uses it.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { coreExtension } from "../packages/compiler/src/extensions/core.ts";
import worldExtension from "../packages/world/src/extension.ts";

const REPO = resolve(import.meta.dirname, "..");
const GRAMMAR = join(REPO, "packages/tree-sitter-weft");
const ZED = join(REPO, "packages/zed");
const treeSitter = join(GRAMMAR, "node_modules/.bin/tree-sitter");
const read = (path: string) => readFileSync(path, "utf8");

// Generating and compiling the parser takes a few seconds.
describe("the Tree-sitter grammar", { timeout: 120_000 }, () => {
  it("is generated from grammar.js, as committed", () => {
    const out = mkdtempSync(join(tmpdir(), "tree-sitter-weft-"));
    try {
      execFileSync(treeSitter, ["generate", "--output", out], { cwd: GRAMMAR, stdio: "pipe" });
      for (const file of ["grammar.json", "node-types.json", "parser.c"]) {
        expect(
          read(join(out, file)) === read(join(GRAMMAR, "src", file)),
          `packages/tree-sitter-weft/src/${file} is out of date: run \`pnpm --filter @loominate-if/tree-sitter-weft generate\` and commit it.`,
        ).toBe(true);
      }
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("passes its corpus and highlighting tests", () => {
    expect(() => execFileSync(treeSitter, ["test"], { cwd: GRAMMAR, stdio: "pipe" })).not.toThrow();
  });

  it("knows every directive core and the world model register, and only those", () => {
    const grammar = JSON.parse(read(join(GRAMMAR, "src/grammar.json"))) as {
      rules: { directive_name: { members: { value: string }[] } };
    };
    const known = grammar.rules.directive_name.members.map((m) => m.value);
    const registered = [
      "if",
      "else if",
      "else",
      ...(coreExtension.directives ?? []).map((d) => d.name),
      ...(worldExtension.directives ?? []).map((d) => d.name),
    ];
    expect([...known].sort(), "Update DIRECTIVES in packages/tree-sitter-weft/grammar.js").toEqual(
      [...new Set(registered)].sort(),
    );
  });
});

describe("the Zed extension", () => {
  it("explains what to install when the folder has no language server", () => {
    let error: unknown;
    try {
      execFileSync(
        "node",
        [join(ZED, "src/launcher.mjs"), join(tmpdir(), "no-game"), "", "--stdio"],
        {
          stdio: "pipe",
          encoding: "utf8",
        },
      );
    } catch (e) {
      error = e;
    }
    expect((error as { stderr?: string } | undefined)?.stderr).toContain(
      "npm install --save-dev @loominate-if/language-server",
    );
  });

  it("highlights with the grammar's own queries", () => {
    for (const query of ["highlights.scm", "injections.scm"]) {
      expect(
        read(join(ZED, "languages/weft", query)) === read(join(GRAMMAR, "queries", query)),
        `packages/zed/languages/weft/${query} must match packages/tree-sitter-weft/queries/${query}; copy it.`,
      ).toBe(true);
    }
  });

  it("builds the grammar from a commit that has it as it is now", () => {
    const rev = /^rev = "([0-9a-f]{40})"$/m.exec(read(join(ZED, "extension.toml")))?.[1];
    expect(rev, "packages/zed/extension.toml needs a grammar rev: a full commit SHA").toBeDefined();
    const committed = execFileSync(
      "git",
      ["show", `${String(rev)}:packages/tree-sitter-weft/src/parser.c`],
      { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    expect(
      committed === read(join(GRAMMAR, "src/parser.c")),
      `The grammar changed since ${String(rev)}: commit it, then set rev in packages/zed/extension.toml to that commit.`,
    ).toBe(true);
  });
});

const BBEDIT = join(REPO, "packages/bbedit");

describe("the BBEdit language module", () => {
  const module = JSON.parse(read(join(BBEDIT, "Loominate IF.bbdlm"))) as {
    "com.barebones.DocumentType": string;
    BBLMFilenameExtensions: string[];
    BBLMSyntaxRules: { PatternRuns: { RunKind: string; RunPattern: string }[] };
    BBLMSymbolRules: { FunctionPatterns: { FunctionPattern: string }[] };
    BBLMLanguageServerInfo: { ServerCommand: string; ServerArguments: string[] };
  };
  const run = (kind: string) => {
    const found = module.BBLMSyntaxRules.PatternRuns.find((r) => r.RunKind === kind);
    if (!found) throw new Error(`no ${kind} run`);
    // `(?m)` is PCRE's multiline flag; JavaScript takes it as a flag instead.
    return new RegExp(
      found.RunPattern.replace(/^\(\?m\)/, ""),
      found.RunPattern.startsWith("(?m)") ? "gm" : "g",
    );
  };
  const matches = (re: RegExp, text: string) => [...text.matchAll(re)].map((m) => m[0]);

  it("is a declarative module for .weft files that starts the language server", () => {
    expect(module["com.barebones.DocumentType"]).toBe("DeclarativeLanguageModule");
    expect(module.BBLMFilenameExtensions).toEqual(["weft"]);
    expect(module.BBLMLanguageServerInfo).toMatchObject({
      ServerCommand: "loominate-language-server",
      ServerArguments: ["--stdio"],
    });
  });

  it("colors the directives the grammar knows, longest first, and nothing in prose", () => {
    const grammar = JSON.parse(read(join(GRAMMAR, "src/grammar.json"))) as {
      rules: { directive_name: { members: { value: string }[] } };
    };
    const known = grammar.rules.directive_name.members.map((m) => m.value);
    const keyword = run("com.barebones.bblm.keyword");
    const raw =
      module.BBLMSyntaxRules.PatternRuns.find((r) => r.RunKind === "com.barebones.bblm.keyword")
        ?.RunPattern ?? "";
    const listed = /\(\?:\/if\|\(\?:(.*)\)\(\?=/.exec(raw)?.[1]?.split("|") ?? [];
    expect(
      [...listed].sort(),
      "Update the keyword run in packages/bbedit/Loominate IF.bbdlm",
    ).toEqual([...known].sort());
    expect(listed).toEqual([...listed].sort((a, b) => b.length - a.length));
    expect(
      matches(
        keyword,
        "{on first visit: x}\n{if lit}{/if}\n{lamp.lit} in no time, if ever. \\{if}\n",
      ),
    ).toEqual(["{on first visit", "{if", "{/if"]);
  });

  it("colors headers, links, line-start comments, and escapes", () => {
    const text =
      ":: Hall [room: hall]\nSee http://example.com.\n  // A note.\n[[Go -> Cellar]] \\{x\\}\n";
    expect(matches(run("com.barebones.bblm.preprocessor"), text)).toEqual([":: Hall [room: hall]"]);
    expect(matches(run("com.barebones.bblm.line-comment"), text)).toEqual(["  // A note."]);
    expect(matches(run("com.barebones.bblm.html.anchor"), text)).toEqual(["[[Go -> Cellar]]"]);
    expect(matches(run("com.barebones.bblm.predefined-symbol"), text)).toEqual(["\\{", "\\}"]);
  });

  it("lists passages in the function menu", () => {
    const pattern = module.BBLMSymbolRules.FunctionPatterns[0]?.FunctionPattern ?? "";
    const re = new RegExp(pattern.replace(/^\(\?m\)/, ""), "gm");
    expect(
      [...":: Hall [room: hall]\nText.\n::Cellar Stairs \n".matchAll(re)].map(
        (m) => m.groups?.function_name,
      ),
    ).toEqual(["Hall", "Cellar Stairs"]);
  });
});

describe("BBEdit's language server proxy", () => {
  it("finds the nearest server at or above the project folder", async () => {
    const { serverFor, folderOf } = (await import(
      join(BBEDIT, "Language Servers/loominate-proxy.mjs")
    )) as {
      serverFor: (folder: string) => string | undefined;
      folderOf: (params: unknown) => string | undefined;
    };
    const game = mkdtempSync(join(tmpdir(), "bbedit-game-"));
    try {
      const entry = join(game, "node_modules/@loominate-if/language-server/dist/bin.js");
      mkdirSync(dirname(entry), { recursive: true });
      writeFileSync(entry, "");
      expect(serverFor(game)).toBe(entry);
      expect(serverFor(join(game, "chapters/one"))).toBe(entry);
      expect(serverFor(tmpdir())).toBeUndefined();
      expect(folderOf({ rootUri: pathToFileURL(game).href })).toBe(game);
      expect(
        folderOf({
          rootUri: null,
          workspaceFolders: [{ uri: pathToFileURL(game).href, name: "g" }],
        }),
      ).toBe(game);
      expect(folderOf({ rootPath: game })).toBe(game);
    } finally {
      rmSync(game, { recursive: true, force: true });
    }
  });
});

const SUBLIME = join(REPO, "packages/sublime");

describe("the Sublime Text package", () => {
  it("knows the grammar's directives, longest first", () => {
    const grammar = JSON.parse(read(join(GRAMMAR, "src/grammar.json"))) as {
      rules: { directive_name: { members: { value: string }[] } };
    };
    const known = grammar.rules.directive_name.members.map((m) => m.value);
    const syntax = read(join(SUBLIME, "Loominate IF.sublime-syntax"));
    const listed = /^ {2}directive: '\(\?:(.*)\)'$/m.exec(syntax)?.[1]?.split("|") ?? [];
    expect(
      [...listed].sort(),
      "Update `directive` in packages/sublime/Loominate IF.sublime-syntax",
    ).toEqual([...known].sort());
    expect(listed).toEqual([...listed].sort((a, b) => b.length - a.length));
  });

  it("starts the same proxy as BBEdit", () => {
    expect(
      read(join(SUBLIME, "loominate-proxy.mjs")) ===
        read(join(BBEDIT, "Language Servers/loominate-proxy.mjs")),
      "packages/sublime/loominate-proxy.mjs must match packages/bbedit/Language Servers/loominate-proxy.mjs; copy it.",
    ).toBe(true);
  });
});
