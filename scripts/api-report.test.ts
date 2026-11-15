import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExtractorLogLevel, type ExtractorMessage } from "@microsoft/api-extractor";
import { describe, expect, it } from "vitest";
import { checkEntryPoint, runExtractor } from "./api-report.ts";

const entry = { ".": { source: "./src/index.ts", types: "./dist/index.d.ts", default: "./x.js" } };

describe("checkEntryPoint", () => {
  it("accepts a single source/types/default entry", () => {
    expect(checkEntryPoint({ exports: entry })).toBeUndefined();
  });

  it("rejects missing exports, subpath exports, and missing conditions", () => {
    expect(checkEntryPoint({})).toMatch(/no "exports"/);
    expect(checkEntryPoint({ exports: { ...entry, "./internal": "./i.js" } })).toMatch(
      /exactly one public entry/,
    );
    expect(checkEntryPoint({ exports: { ".": { default: "./x.js" } } })).toMatch(/conditions/);
  });
});

describe("runExtractor", () => {
  /** A built package with the given `dist/index.d.ts`. */
  function fixture(dts: string, extra: Record<string, string> = {}): string {
    const dir = mkdtempSync(join(tmpdir(), "api-report-"));
    mkdirSync(join(dir, "dist"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "@loominate-if/fixture", version: "0.0.0", exports: entry }),
    );
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true } }),
    );
    writeFileSync(join(dir, "dist", "index.d.ts"), dts);
    for (const [file, text] of Object.entries(extra)) writeFileSync(join(dir, "dist", file), text);
    return dir;
  }

  function run(dir: string, update: boolean): { ok: boolean; ids: string[] } {
    const ids: string[] = [];
    const ok = runExtractor(dir, update, (m: ExtractorMessage) => {
      ids.push(m.messageId);
      // Keep test output quiet, but let warnings and errors through so they still count.
      if (m.logLevel === ExtractorLogLevel.Info || m.logLevel === ExtractorLogLevel.Verbose)
        m.handled = true;
    });
    return { ok, ids };
  }

  it("writes a report on update, then passes until the public API changes", () => {
    const dir = fixture(`/** Starts. */\nexport declare function start(): void;\n`);
    expect(run(dir, true).ok).toBe(true);
    const report = readFileSync(join(dir, "api", "fixture.api.md"), "utf8");
    expect(report).toContain("export function start(): void;");
    expect(run(dir, false).ok).toBe(true);

    writeFileSync(
      join(dir, "dist", "index.d.ts"),
      `/** Starts. */\nexport declare function start(): void;\n/** Stops. */\nexport declare function stop(): void;\n`,
    );
    const changed = run(dir, false);
    expect(changed.ok).toBe(false);
    expect(changed.ids).toContain("console-api-report-not-copied");
  });

  it("shows @internal exports in the report as internal", () => {
    const dir = fixture(`/** Dumps state. @internal */\nexport declare function _debug(): void;\n`);
    expect(run(dir, true).ok).toBe(true);
    expect(readFileSync(join(dir, "api", "fixture.api.md"), "utf8")).toMatch(
      /\/\/ @internal\nexport function _debug\(\): void;/,
    );
  });

  it("fails when public API uses a type the entry point doesn't export", () => {
    const dir = fixture(
      `import type { Hidden } from "./hidden.js";\n/** Makes one. */\nexport declare function f(): Hidden;\n`,
      {
        "hidden.d.ts": `/** Not exported. */\nexport interface Hidden {\n  /** A field. */\n  x: number;\n}\n`,
      },
    );
    expect(run(dir, true).ok).toBe(true);
    const check = run(dir, false);
    expect(check.ok).toBe(false);
    expect(check.ids).toContain("ae-forgotten-export");
  });

  it("fails when a public export has no doc comment", () => {
    const dir = fixture(`export declare function bare(): void;\n`);
    expect(run(dir, true).ok).toBe(true);
    const check = run(dir, false);
    expect(check.ok).toBe(false);
    expect(check.ids).toContain("ae-undocumented");
  });
});
