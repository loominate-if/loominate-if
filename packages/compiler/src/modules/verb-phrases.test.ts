import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileProject } from "./project.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "__game__");
const compilerOptions = { customConditions: ["source"] };

// These build real TypeScript programs, which takes seconds under load (#314).
describe("checking verb phrases (#79)", { timeout: 30_000 }, () => {
  it("reports a slot that isn't one of the action's roles, at the phrase", () => {
    const story = `import { action as act, object } from "@loominate-if/core";
export const door = object("door", { name: "door" });
export const key = object("key", { name: "key" });
export const unlock = act<{ thing: typeof door; tool: typeof key }>("unlock", {
  verbs: ["unlock {thing} with {tool}", "unlock {thing} with {key}"],
});
`;
    const found = compileProject({
      root,
      files: [
        { path: "story.ts", text: story },
        { path: "start.weft", text: ":: Start\nA door.\n" },
      ],
      compilerOptions,
    })
      .diagnostics.filter((d) => d.source === "compiler")
      .map(
        (d) =>
          `${path.relative(root, d.file)}:${String(d.line)}:${String(d.column)} ${d.severity}: ${d.message}`,
      );
    expect(found).toEqual([
      "story.ts:5:62 error: `{key}` isn't one of unlock's roles: thing, tool. A slot names one of the action's things by role, as `{thing}`.",
    ]);
  });
});
