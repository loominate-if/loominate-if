import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createCompilerSession } from "./project.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "__game__");
const compilerOptions = { customConditions: ["source"] };

const story = `export const lamp = { lit: false };\n`;
const hall = ':: Hall\nThe lamp is {lamp.lit ? "lit" : "dark"}.\n[[Cellar]]\n';
const cellar = ":: Cellar\nDamp.\n[[Hall]]\n";

function start() {
  return createCompilerSession({
    root,
    compilerOptions,
    files: [
      { path: "story.ts", text: story },
      { path: "hall.weft", text: hall },
      { path: "cellar.weft", text: cellar },
    ],
  });
}
const at = (file: string) => path.join(root, file);
const messages = (s: ReturnType<typeof start>) =>
  s.diagnostics().map((d) => `${path.relative(root, d.file)}:${String(d.line)} ${d.message}`);

// These build real TypeScript programs, which takes seconds under load, as in project.test.ts (#314, #339).
describe("a compiler session", { timeout: 30_000 }, () => {
  it("regenerates only the passage file that changed", () => {
    const session = start();
    const before = session.module("cellar.weft");
    expect(messages(session)).toEqual([]);
    const change = session.update("hall.weft", hall.replace("Damp", "Dry").replace("dark", "out"));
    expect(change).toEqual({ modules: [at("hall.weft")], passageNames: false });
    expect(session.module("cellar.weft")).toBe(before);
    expect(session.module("hall.weft")?.code).toContain('"out"');
  });

  it("reports nothing changed when the text is the same", () => {
    const session = start();
    expect(session.update("hall.weft", hall)).toEqual({ modules: [], passageNames: false });
  });

  it("updates passage names when passages are added or removed", () => {
    const session = start();
    let change = session.update("attic.weft", ":: Attic\nDust.\n");
    expect(change).toEqual({ modules: [at("attic.weft")], passageNames: true });
    expect(session.passageNames().code).toContain('"Attic" | "Cellar" | "Hall"');
    change = session.update("attic.weft", undefined);
    expect(change).toEqual({ modules: [at("attic.weft")], passageNames: true });
    expect(session.module("attic.weft")).toBeUndefined();
    expect(session.passageNames().code).not.toContain("Attic");
  });

  it("regenerates every module when the scope module's exports change", () => {
    const session = start();
    expect(session.update("story.ts", `${story}export const clock = 0;\n`)).toEqual({
      modules: [],
      passageNames: false,
    });
    // Imports list only what a passage uses, so code only changes where a new export is used.
    const change = session.update("story.ts", "export const lantern = { lit: false };\n");
    expect(change.modules).toEqual([at("hall.weft")]);
    expect(messages(session)).toEqual([
      "hall.weft:2 `lamp` isn't defined. Passages can use what `story.ts` exports, and `visits`, `firstVisit`, and `visited`.",
    ]);
  });

  it("type-checks again after an edit, and reports the new problems", () => {
    const session = start();
    expect(messages(session)).toEqual([]);
    session.update("cellar.weft", ":: Cellar\nDamp.\n[[Hal]]\n");
    expect(messages(session)).toEqual([
      "cellar.weft:3 There's no passage named `Hal`. Did you mean `Hall`?",
    ]);
    session.update("cellar.weft", cellar);
    expect(messages(session)).toEqual([]);
  });
});
