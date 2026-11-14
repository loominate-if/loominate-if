import { ESLint } from "eslint";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: resolve(dirname(fileURLToPath(import.meta.url)), "..") });

async function ruleIds(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: file });
  return (result?.messages ?? []).map((m) => m.ruleId ?? "parse-error");
}

const NONDETERMINISTIC = [
  "export const r = Math.random();",
  "export const t = Date.now();",
  "export const d = new Date();",
  "export const s = Date();",
  "export const id = crypto.randomUUID();",
];

describe("determinism lint rules", () => {
  for (const code of NONDETERMINISTIC) {
    it(`reject \`${code}\` in runtime packages`, async () => {
      for (const pkg of ["core", "presentation", "world", "kits/rpg"]) {
        expect(await ruleIds(`packages/${pkg}/src/x.ts`, code)).not.toEqual([]);
      }
    });

    it(`allow \`${code}\` in tooling`, async () => {
      expect(await ruleIds("packages/cli/src/x.ts", code)).toEqual([]);
    });
  }

  it("allow constructing a specific date in runtime packages", async () => {
    expect(await ruleIds("packages/core/src/x.ts", "export const d = new Date(0);")).toEqual([]);
  });
});
