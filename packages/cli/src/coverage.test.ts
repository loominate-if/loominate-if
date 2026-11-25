/** `loominate coverage` (#133): what can't be reached, and what walkthroughs never reached. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { coverage, formatCoverage } from "./coverage.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const packages = path.resolve(here, "../..");
const temp = mkdtempSync(path.join(packages, "cli/__run-coverage-"));
afterAll(() => {
  rmSync(temp, { recursive: true, force: true });
});

/** A game with the world model, with something of each kind that can't be reached, and a walkthrough. */
function game(name = "game", more: Record<string, string> = {}): string {
  const root = path.join(temp, name);
  const files: Record<string, string> = {
    "package.json": '{"type":"module"}',
    "loominate.config.ts": `import { defineConfig } from "@loominate-if/cli";
export default defineConfig({ game: { id: "coverage-game", version: "0.1.0" }, start: "Hall", extensions: ["world-from-source"] });
`,
    // The world model's own extension module, from source, so the test needs no build first.
    "node_modules/world-from-source/package.json": JSON.stringify({
      name: "world-from-source",
      type: "module",
      loominate: { extension: "./extension.js" },
    }),
    "node_modules/world-from-source/extension.js": `export { default } from ${JSON.stringify(
      pathToFileURL(path.join(packages, "world/src/extension.ts")).href,
    )};\n`,
    "story.ts": `import { action } from "@loominate-if/core";
import { actor, convNode, defineFacts, place, startAs, thing, topic } from "@loominate-if/world";
export const hall = place("hall", { name: "hall" });
export const you = actor("you", { body: { name: "you", location: hall } });
startAs(you);
export const maid = actor("maid", { body: { name: "maid", location: hall } });
export const facts = defineFacts({ secret: "The maid has a secret.", lonely: "Nobody asks about this." });
export const offer = convNode(maid, "offer");
export const question = convNode(maid, "question");
topic(maid, { ask: facts.secret, opens: offer, says: "“I couldn't say, miss.”" });
topic(maid, { yes: true, in: offer, says: "“Very good, miss.”" });
export const fan = thing("fan", { name: "fan", location: hall });
export const ring = thing("ring", { name: "ring" });
action<{ thing: typeof fan }>("wave", { on: fan, label: "Wave the fan" });
action<{ thing: typeof ring }>("polish", { on: ring, label: "Polish the ring" });
`,
    "rooms.weft": `:: Hall
A hall.
[[Go to the kitchen -> Kitchen]]

:: Kitchen
A kitchen.

:: Attic
Dusty.

:: Cellar
Damp.
`,
    "walk.test.ts": `import { play } from "@loominate-if/testing";
import { expect, test } from "vitest";

test("to the kitchen", () => {
  const game = play();
  game.choose("Go to the kitchen");
  expect(game.text).toContain("A kitchen.");
});

test("into the attic, as code can take the player", () => {
  play().story.goTo("Attic");
});
`,
  };
  for (const [name, text] of Object.entries({ ...files, ...more })) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), text);
  }
  mkdirSync(path.join(root, "node_modules/@loominate-if"), { recursive: true });
  for (const pkg of ["core", "presentation", "testing", "world"]) {
    symlinkSync(
      path.join(packages, pkg),
      path.join(root, `node_modules/@loominate-if/${pkg}`),
      "dir",
    );
  }
  return root;
}

describe("loominate coverage (#133)", () => {
  it("reports what can't be reached, and what the walkthroughs never reached", async () => {
    const root = game();
    // The nested run's own report stays out of this run's output.
    const quiet = [
      vi.spyOn(process.stdout, "write").mockImplementation(() => true),
      vi.spyOn(process.stderr, "write").mockImplementation(() => true),
    ];
    let report;
    try {
      report = await coverage({
        root,
        conditions: ["source"],
        vite: { configFile: false, logLevel: "silent" },
        json: "coverage.json",
      });
    } finally {
      for (const spy of quiet) spy.mockRestore();
    }
    expect(report.walkthroughs).toEqual({ tests: 2, failed: 0 });
    expect(report.unreachable.map((u) => [u.title, u.label])).toEqual([
      // The attic too can't be linked to, but a walkthrough went there, so it isn't listed.
      ["Passages", "Cellar"],
      ["Facts", "“Nobody asks about this.” (lonely)"],
      ["Conversation nodes", "question (maid:mind)"],
      ["Actions", "Polish the ring"],
    ]);
    expect(report.unreachable[0]).toMatchObject({ file: "rooms.weft", line: 11 });
    expect(
      Object.fromEntries(report.notReached.map((c) => [c.check, [c.total, c.missed]])),
    ).toEqual({
      passages: [3, []],
      actions: [1, ["Wave the fan"]],
      // No one can be asked about the lonely fact, but the player might still learn it.
      facts: [2, ["“The maid has a secret.”", "“Nobody asks about this.”"]],
      topics: [2, ["Ask the maid about the fact “The maid has a secret.”", "Say yes to the maid"]],
      nodes: [1, ["offer (maid:mind)"]],
    });
    // The same report, as JSON, for CI to keep.
    expect(JSON.parse(readFileSync(path.join(root, "coverage.json"), "utf8"))).toEqual(report);
    const text = formatCoverage(report);
    expect(text).toContain(
      "Can't be reached (4):\n  Passages\n    rooms.weft:11: Nothing leads to",
    );
    expect(text).toContain("Not reached by walkthroughs (6 of 9, from 2 tests):");
    expect(text).toContain("  Passages: all 3 reached\n");
    expect(text).toContain("  Actions: 1 of 1 not reached\n    Wave the fan\n");
  }, 120_000);

  it("names the game's errors, rather than reporting on a game that doesn't compile", async () => {
    const root = game("broken", { "rooms.weft": ":: Hall\nA hall. {nope}\n" });
    await expect(
      coverage({ root, conditions: ["source"], vite: { configFile: false, logLevel: "silent" } }),
    ).rejects.toThrow(
      /the game has 1 error; fix it first:\nrooms\.weft:2:\d+ error: `nope` isn't defined/,
    );
  }, 120_000);
});
