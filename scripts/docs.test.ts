// Keeps the author guides in step with the code they document.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { themeTokens } from "../packages/presentation/src/page/tokens.ts";

const repo = join(import.meta.dirname, "..");
const read = (file: string): string => readFileSync(join(repo, file), "utf8");

/** The code between `// #region name` and `// #endregion` in a test, unindented. */
function region(file: string, name: string): string | undefined {
  const text = read(file);
  const found = new RegExp(`// #region ${name}.*\\n([\\s\\S]*?)\\n\\s*// #endregion`).exec(
    text,
  )?.[1];
  const indent = /^ */.exec(found ?? "")?.[0].length ?? 0;
  return found?.replace(new RegExp(`^ {${String(indent)}}`, "gm"), "");
}

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
    const code = region("packages/presentation/src/page/theme.test.ts", "ship-status");
    expect(code).toBeDefined();
    expect(guide).toContain(code);
  });
});

describe("the effects guide", () => {
  it("shows the registration example exactly as a test runs it", () => {
    const code = region("packages/presentation/src/page/effects.test.ts", "glow-effect");
    expect(code).toBeDefined();
    expect(read("docs/guide/effects.md")).toContain(code);
  });
});
