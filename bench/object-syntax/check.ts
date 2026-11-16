/**
 * Checks each style: type-checks its story.ts with the shared scene through
 * the real compiler, then plays the scene, testing undo, save and load,
 * runtime-created objects, and replay. Prints a comparison table.
 *
 * Run `pnpm build` at the repo root first; this uses the built packages.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { compileProject } from "@loominate-if/compiler";
import {
  createEventRecord,
  createHistory,
  createStore,
  createStory,
  type Passage,
  type StateSnapshot,
} from "@loominate-if/core";

const here = import.meta.dirname;
const STYLES = ["a-factory", "b-builder", "c-class"];
const scene = readFileSync(path.join(here, "scene/cellar.weft"), "utf8");
const runtime = readFileSync(path.join(here, "runtime/objects.ts"), "utf8");

type Story = {
  bindStore(store: ReturnType<typeof createStore>): void;
  instancesOf(t: unknown): { id: string; isLit: boolean }[];
  match: unknown;
  lantern: { isLit: boolean; taken: boolean };
  player: { fear: number };
  matchbox: { count: number; struck: number };
};

/** Lines of story.ts that aren't blank or comments. */
function codeLines(text: string): number {
  return text.split("\n").filter((l) => l.trim() !== "" && !/^\s*(\/\/|\/\*\*?|\*)/.test(l)).length;
}

async function check(style: string) {
  const dir = path.join(here, style);
  const story = readFileSync(path.join(dir, "story.ts"), "utf8");
  const syntax = readFileSync(path.join(dir, "syntax.ts"), "utf8");
  const result = compileProject({
    root: dir,
    files: [
      { path: "story.ts", text: story },
      { path: "syntax.ts", text: syntax },
      { path: path.join(here, "runtime/objects.ts"), text: runtime },
      { path: "cellar.weft", text: scene },
    ],
  });
  const errors = result.diagnostics.map(
    (d) => `  ${path.relative(here, d.file)}:${String(d.line)}:${String(d.column)} ${d.message}`,
  );

  // Emit everything to out/<style> and play it.
  // The same layout as the sources, so `../runtime/objects.js` resolves; one runtime per style.
  const base = path.join(here, "out", style);
  const out = path.join(base, "s");
  rmSync(base, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  mkdirSync(path.join(base, "runtime"));
  const emit = (file: string, code: string) => {
    const js = ts.transpileModule(code, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 },
    }).outputText;
    writeFileSync(file, js);
  };
  emit(path.join(out, "story.js"), story);
  emit(path.join(out, "syntax.js"), syntax);
  emit(path.join(base, "runtime/objects.js"), runtime);
  const modules = [...result.modules.values()];
  for (const m of modules)
    emit(path.join(out, path.basename(m.path).replace(/\.ts$/, ".js")), m.code);

  const mod = (await import(pathToFileURL(path.join(out, "story.js")).href)) as Story;
  const runtimeMod = (await import(
    pathToFileURL(path.join(base, "runtime/objects.js")).href
  )) as Story;
  const passages: Passage[] = [];
  for (const m of modules) {
    const file = path.join(out, path.basename(m.path).replace(/\.ts$/, ".js"));
    passages.push(
      ...((await import(pathToFileURL(file).href)) as { passages: Passage[] }).passages,
    );
  }

  const failures: string[] = [];
  const expect = (what: string, actual: unknown, wanted: unknown) => {
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
      failures.push(`${what}: got ${JSON.stringify(actual)}, wanted ${JSON.stringify(wanted)}`);
    }
  };

  const play = (snapshot?: StateSnapshot) => {
    const store = createStore(snapshot);
    const record = createEventRecord(store);
    runtimeMod.bindStore(store);
    const history = createHistory(store);
    const game = createStory(store, record, passages, { start: "Kitchen" });
    game.begin();
    history.checkpoint();
    const choose = (label: string) => {
      const choice = game.render().choices.find((c) => (c.label ?? "Continue") === label);
      if (!choice) throw new Error(`no choice "${label}" in ${String(game.current)}`);
      game.follow(choice);
      history.checkpoint();
    };
    return { store, game, history, choose };
  };

  try {
    const run = play();
    run.choose("Go to the cellar stairs");
    expect("fear after the dark stairs", mod.player.fear, 1);
    run.choose("Back up");
    run.choose("Take the lantern");
    run.choose("Continue");
    run.choose("Strike a match");
    expect("lantern lit by the match", mod.lantern.isLit, true);
    expect(
      "one match spawned",
      runtimeMod.instancesOf(mod.match).map((m) => [m.id, m.isLit]),
      [["gen:matchbox:match-1", false]],
    );
    run.choose("Continue");

    // Undo the strike: the lantern goes out, the match disappears.
    run.history.undo();
    run.history.undo();
    expect("undo unlights the lantern", mod.lantern.isLit, false);
    expect("undo removes the match", runtimeMod.instancesOf(mod.match).length, 0);
    run.history.redo();
    run.history.redo();
    expect(
      "redo respawns the same match",
      runtimeMod.instancesOf(mod.match).map((m) => m.id),
      ["gen:matchbox:match-1"],
    );

    // Strike again: the next ID in sequence.
    run.choose("Strike a match");
    run.choose("Continue");
    expect(
      "second match ID",
      runtimeMod.instancesOf(mod.match).map((m) => m.id),
      ["gen:matchbox:match-1", "gen:matchbox:match-2"],
    );

    // Save, then load into a fresh store.
    const saved = JSON.parse(JSON.stringify(run.store.snapshot())) as StateSnapshot;
    const loaded = play(saved);
    expect("load keeps the lantern lit", mod.lantern.isLit, true);
    expect("load keeps the matchbox", [mod.matchbox.count, mod.matchbox.struck], [1, 2]);
    loaded.choose("Take the key");
    loaded.choose("Continue");
    loaded.choose("Go to the cellar stairs");
    loaded.choose("Unlock the door");
    loaded.choose("Continue");
    loaded.choose("Go down");
    const text = loaded.game
      .render()
      .nodes.map((n) => ("text" in n ? n.text : ""))
      .join("");
    expect("ending", text, "You made it down. You were scared 1 times, and struck 2 matches.");

    // Only values that differ from the definition are stored; `name` never is.
    expect("store holds only changes", loaded.store.entity("lantern"), {
      isLit: true,
      taken: true,
    });

    // Replay the same choices from scratch: identical state.
    const replay = () => {
      const r = play();
      for (const c of [
        "Take the lantern",
        "Continue",
        "Strike a match",
        "Continue",
        "Strike a match",
        "Continue",
      ]) {
        r.choose(c);
      }
      return JSON.stringify(r.store.snapshot());
    };
    expect("replay is deterministic", replay() === replay(), true);
  } catch (error) {
    failures.push(`threw: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    style,
    lines: codeLines(story),
    errors,
    failures,
    mistakes: mistakes(dir, story, syntax),
  };
}

/** Deliberate mistakes, to compare how each style reports them. */
function mistakes(dir: string, story: string, syntax: string): string[] {
  const cases: [string, string, string, "story" | "scene"][] = [
    ["typo in a method", "this.isLit = true;", "this.isLitt = true;", "story"],
    ["wrong type in a method", "this.count -= 1;", 'this.count -= "1";', "story"],
    ["typo in a passage", "lantern.taken = true", "lantern.takn = true", "scene"],
  ];
  return cases.map(([what, from, to, where]) => {
    const files = [
      { path: "story.ts", text: where === "story" ? story.replace(from, to) : story },
      { path: "syntax.ts", text: syntax },
      { path: path.join(here, "runtime/objects.ts"), text: runtime },
      { path: "cellar.weft", text: where === "scene" ? scene.replace(from, to) : scene },
    ];
    const found = compileProject({ root: dir, files }).diagnostics;
    const shown = found.map(
      (d) => `${path.basename(d.file)}:${String(d.line)} ${d.message.split("\n")[0] ?? ""}`,
    );
    return `${what}: ${shown.length === 0 ? "NOT CAUGHT" : shown.join(" | ")}`;
  });
}

const results = [];
for (const style of STYLES) results.push(await check(style));
console.log("style       story.ts lines   type errors   walkthrough");
for (const r of results) {
  console.log(
    `${r.style.padEnd(12)}${String(r.lines).padStart(14)}${String(r.errors.length).padStart(14)}   ${r.failures.length === 0 ? "pass" : "FAIL"}`,
  );
  for (const e of r.errors) console.log(e);
  for (const f of r.failures) console.log(`  ${f}`);
}
console.log("\nHow each style reports deliberate mistakes:");
for (const r of results) {
  console.log(`${r.style}`);
  for (const m of r.mistakes) console.log(`  ${m}`);
}
process.exitCode = results.some((r) => r.errors.length > 0 || r.failures.length > 0) ? 1 : 0;
