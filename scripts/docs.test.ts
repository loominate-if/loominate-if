// Keeps the author guides in step with the code they document.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { themeTokens } from "../packages/presentation/src/page/tokens.ts";
import { extract, guides, snippets, updated } from "./snippets.ts";

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

describe("code taken from tested files", () => {
  it("matches its source in every guide", () => {
    const marked = guides(repo).flatMap((guide) =>
      snippets(read(guide)).map((s) => ({ guide, source: s.source, code: s.code })),
    );
    expect(marked.length).toBeGreaterThan(0);
    for (const { guide, source, code } of marked) {
      // Run `pnpm docs:update` after changing an example.
      expect({ guide, source, code }).toEqual({ guide, source, code: extract(repo, source) });
    }
  });

  it("finds marked blocks, empty or not, and fills them from their source", () => {
    const guide = [
      "Intro.",
      "<!-- example: examples/branching-story/intro.weft#Shed -->",
      "```weft",
      "```",
      "",
      "<!-- example: examples/branching-story/loominate.config.ts -->",
      "```ts",
      "old",
      "```",
      "",
    ].join("\n");
    expect(snippets(guide).map((s) => [s.source, s.code])).toEqual([
      ["examples/branching-story/intro.weft#Shed", ""],
      ["examples/branching-story/loominate.config.ts", "old"],
    ]);
    const filled = updated(repo, guide);
    expect(snippets(filled).map((s) => s.code)).toEqual([
      extract(repo, "examples/branching-story/intro.weft#Shed"),
      extract(repo, "examples/branching-story/loominate.config.ts"),
    ]);
    expect(filled).toMatch(/^:: Shed\n[\s\S]*\n```\n\n<!--/m);
    expect(updated(repo, filled)).toBe(filled);
  });

  it("takes a passage up to the next one, and a region without its indent", () => {
    expect(extract(repo, "examples/branching-story/intro.weft#Shed")).toMatch(
      /^:: Shed\n[\s\S]*\[\[Back to the cottage -> Cottage\]\]$/,
    );
    expect(extract(repo, "examples/branching-story/walkthroughs.test.ts#dawn")).toMatch(
      /^it\("ends at dawn[\s\S]*\n}\);$/,
    );
    expect(() => extract(repo, "examples/branching-story/intro.weft#Attic")).toThrow(
      "examples/branching-story/intro.weft has no passage named Attic.",
    );
    expect(() => extract(repo, "examples/branching-story/story.ts#nothing")).toThrow(
      "examples/branching-story/story.ts has no region named nothing.",
    );
  });
});

describe("the tutorial", () => {
  const tutorial = read("docs/guide/tutorial.md");
  const example = "examples/branching-story";

  it("takes all its code from the example game", () => {
    const blocks = [...tutorial.matchAll(/^```(\w*)$/gm)].filter((_, i) => i % 2 === 0);
    const code = blocks.filter((m) => m[1] === "ts" || m[1] === "weft");
    expect(code).toHaveLength(snippets(tutorial).length);
    for (const s of snippets(tutorial)) expect(s.source.startsWith(`${example}/`)).toBe(true);
  });

  it("builds every passage of the game, so readers end with the whole story", () => {
    const passages = readdirSync(join(repo, example))
      .filter((f) => f.endsWith(".weft"))
      .flatMap((f) =>
        [...read(`${example}/${f}`).matchAll(/^::\s*(.+?)\s*(?:\[.*\])?$/gm)].map(
          (m) => `${example}/${f}#${m[1] ?? ""}`,
        ),
      );
    expect(snippets(tutorial).map((s) => s.source)).toEqual(expect.arrayContaining(passages));
    expect(tutorial).toContain(`<!-- example: ${example}/story.ts -->`);
  });
});
