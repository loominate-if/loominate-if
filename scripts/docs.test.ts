// Keeps the author guides in step with the code they document.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { themeTokens } from "../packages/presentation/src/page/tokens.ts";

const repo = join(import.meta.dirname, "..");
const read = (file: string): string => readFileSync(join(repo, file), "utf8");

describe("the theming guide", () => {
  const guide = read("docs/guide/theming.md");

  it("documents every token with its default", () => {
    for (const token of themeTokens) {
      expect(guide).toContain(`| \`${token.name}\` | \`${token.value}\` | ${token.description} |`);
    }
    const documented = [...guide.matchAll(/^\| `(--loominate-[\w-]+)`/gm)].map((m) => m[1]);
    expect(documented).toEqual(themeTokens.map((t) => t.name));
  });

  it("shows the replaced-template example exactly as a test runs it", () => {
    const test = read("packages/presentation/src/page/theme.test.ts");
    const region = /\/\/ #region ship-status.*\n([\s\S]*?)\n\s*\/\/ #endregion/.exec(test)?.[1];
    expect(region).toBeDefined();
    expect(guide).toContain((region ?? "").replace(/^ {6}/gm, ""));
  });
});
