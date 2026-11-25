/**
 * The editor support that isn't TypeScript (#411, ADR 0119): the Tree-sitter
 * grammar for passage files, and the Zed extension that uses it.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
