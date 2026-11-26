/**
 * `loominate coverage` (#133, ADR 0109): a report in two parts. "Can't be
 * reached" is what the game's structure rules out: the compiler's
 * unreachable passages and rooms, and what core's `coverageChecks` find in
 * the begun game. "Not reached by walkthroughs" is what the game's
 * walkthrough tests never reached, like code coverage.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  compileProject,
  parsePassageFile,
  PASSAGE_EXTENSION,
  shownDiagnostics,
} from "@loominate-if/compiler";
import { createServer, mergeConfig, type Plugin } from "vite";
import { loadConfig, type ResolvedConfig } from "./config/config.js";
import { viteConfig, runWalkthroughs, type CommandOptions } from "./commands.js";
import { formatDiagnostic, gameFiles } from "./vite/plugin.js";
import { gameModule } from "./game-module.js";

/** Options for {@link coverage}. */
export type CoverageOptions = CommandOptions & {
  /** Writes the report as JSON to this file too, relative to the game's root. */
  readonly json?: string;
};

/** Something that can't be reached, in a coverage report. */
export type UnreachableEntry = {
  /** The check that found it, such as `passages` or `@loominate-if/world: unreachable rooms`. */
  readonly check: string;
  /** The heading it's under: "Passages", "Facts". */
  readonly title: string;
  /** What it is. */
  readonly label: string;
  /** Why it can't be reached, and how to fix it. */
  readonly why: string;
  /** The file it's written in, relative to the game's root, when the compiler found it. */
  readonly file?: string;
  /** Its line in that file, from 1. */
  readonly line?: number;
};

/** What walkthroughs never reached of one check's items. */
export type NotReachedEntry = {
  /** The check, such as `topics`. */
  readonly check: string;
  /** Its heading: "Topics". */
  readonly title: string;
  /** How many items it has. */
  readonly total: number;
  /** Those no walkthrough reached, by label, in the check's order. */
  readonly missed: readonly string[];
};

/** A coverage report. */
export type CoverageReport = {
  /** What the game's structure rules out. */
  readonly unreachable: readonly UnreachableEntry[];
  /** What the walkthroughs never reached, by check. */
  readonly notReached: readonly NotReachedEntry[];
  /** The walkthroughs run: how many tests, and how many failed. */
  readonly walkthroughs: { readonly tests: number; readonly failed: number };
};

/** Something found that can't be reached, with its item's key, if it has one. */
type Keyed = UnreachableEntry & { readonly key?: string };

/** What the begun game says, from the module loaded in Node. */
type Structure = {
  readonly startError?: string;
  readonly checks: readonly {
    readonly name: string;
    readonly title: string;
    readonly unreachable: readonly { key?: string; label: string; why: string }[];
    readonly items: readonly { key: string; label: string }[];
    readonly error?: string;
  }[];
};

const STRUCTURE = "/@loominate/coverage-structure";
const SETUP = "/@loominate/coverage-setup";
const OUT_ENV = "LOOMINATE_COVERAGE_OUT";

/**
 * Makes the game's coverage report: what can't be reached, and what its
 * walkthroughs never reached.
 * @throws Error if the game's config can't be loaded, or the game has errors.
 */
export async function coverage(options: CoverageOptions = {}): Promise<CoverageReport> {
  const config = await loadConfig(options.root ?? process.cwd(), {
    ...(options.conditions && { conditions: options.conditions }),
  });
  const files = gameFiles(config.root);
  const compiled = compileProject({
    root: config.root,
    files,
    start: config.start,
    extensions: config.loaded,
    ...(config.scope !== undefined && { scope: config.scope }),
    ...(options.conditions && { compilerOptions: { customConditions: [...options.conditions] } }),
    ambient: ["@loominate-if/presentation"],
  });
  const errors = compiled.diagnostics.filter((d) => d.severity === "error");
  if (errors.length > 0) {
    // The errors that matter, as the dev server shows them, without those that follow from others.
    const { shown, heldBack } = shownDiagnostics(errors, { verbose: options.verbose ?? false });
    throw new Error(
      [
        `the game has ${String(errors.length)} ${errors.length === 1 ? "error" : "errors"}; fix ${errors.length === 1 ? "it" : "them"} first:`,
        ...shown.map((d) => formatDiagnostic(config.root, d)),
        ...(heldBack > 0 ? [`and ${String(heldBack)} more that likely follow from these.`] : []),
      ].join("\n"),
    );
  }
  // The compiler's, keyed by the passage they're about, so a walkthrough that reaches one drops it.
  const fromCompiler: Keyed[] = compiled.diagnostics
    .filter((d) => d.unreachable === true)
    .map((d) => {
      const rooms = d.check?.endsWith("rooms") === true;
      const passage = rooms ? d.message.match(/"([^"]+)"/)?.[1] : d.message.match(/`([^`]+)`/)?.[1];
      return {
        ...(passage !== undefined && { key: `passage:${passage}` }),
        check: d.check ?? "passages",
        title: rooms ? "Rooms" : "Passages",
        label: d.message.match(/`([^`]+)`/)?.[1] ?? d.message,
        why: d.message,
        file: path.relative(config.root, d.file),
        line: d.line,
      };
    });

  const sectioned = sectionedPassages(config, files);
  const structure = await loadStructure(config, options, sectioned);

  const out = mkdtempSync(path.join(tmpdir(), "loominate-coverage-"));
  let walkthroughs: CoverageReport["walkthroughs"];
  const reached = new Set<string>();
  const before = process.env[OUT_ENV];
  process.env[OUT_ENV] = out;
  try {
    const result = await runWalkthroughs(config, options, {
      plugins: [coveragePlugin(config, sectioned)],
      setupFiles: [SETUP],
      passWithNoTests: true,
      quiet: true,
    });
    walkthroughs = { tests: result.tests, failed: result.failed };
    for (const name of readdirSync(out)) {
      // One folder for each test file's run, each with what it reached.
      const keys = JSON.parse(
        readFileSync(path.join(out, name, "reached.json"), "utf8"),
      ) as string[];
      for (const key of keys) reached.add(key);
    }
  } finally {
    if (before === undefined) Reflect.deleteProperty(process.env, OUT_ENV);
    else process.env[OUT_ENV] = before;
    rmSync(out, { recursive: true, force: true });
  }

  const found: Keyed[] = [
    ...fromCompiler,
    ...(structure.startError === undefined
      ? []
      : [
          {
            check: "start",
            title: "Starting the game",
            label: "The game couldn't start",
            why: structure.startError,
          },
        ]),
    ...structure.checks.flatMap((c) => [
      ...(c.error === undefined
        ? []
        : [{ check: c.name, title: c.title, label: "The check failed", why: c.error }]),
      ...c.unreachable.map((f) => ({
        ...(f.key !== undefined && { key: f.key }),
        check: c.name,
        title: c.title,
        label: f.label,
        why: f.why,
      })),
    ]),
  ];
  // A walkthrough that reaches it shows that code does what the structure couldn't.
  const shown = found.filter((f) => f.key === undefined || !reached.has(f.key));
  const unreachable: UnreachableEntry[] = shown.map((f) => {
    const entry: { -readonly [K in keyof Keyed]: Keyed[K] } = { ...f };
    delete entry.key;
    return entry;
  });
  // What can't be reached isn't counted as not reached too.
  const ruledOut = new Set(shown.flatMap((f) => (f.key === undefined ? [] : [f.key])));
  const notReached: NotReachedEntry[] = structure.checks
    .map((c) => ({ ...c, items: c.items.filter((i) => !ruledOut.has(i.key)) }))
    .filter((c) => c.items.length > 0)
    .map((c) => ({
      check: c.name,
      title: c.title,
      total: c.items.length,
      missed: c.items.filter((i) => !reached.has(i.key)).map((i) => i.label),
    }));
  const report: CoverageReport = { unreachable, notReached, walkthroughs };
  if (options.json !== undefined) {
    writeFileSync(path.resolve(config.root, options.json), `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

/**
 * The passages a package reads sections from, as an actor's topic blocks:
 * never visited, so not passages a walkthrough should reach.
 */
function sectionedPassages(
  config: ResolvedConfig,
  files: readonly { readonly path: string; readonly text: string }[],
): string[] {
  const roles = new Set(
    config.loaded
      .flatMap((e) => (e.tagRoles ?? []).filter((r) => r.sections === true))
      .map((r) => r.name),
  );
  return files
    .filter((f) => f.path.endsWith(PASSAGE_EXTENSION))
    .flatMap((f) => parsePassageFile(f.text, { file: f.path }).passages)
    .filter((p) => p.tags.some((t) => t.value !== undefined && roles.has(t.name)))
    .map((p) => p.name.name);
}

/** The modules coverage loads: the begun game's structure, and the walkthroughs' setup. */
function coveragePlugin(config: ResolvedConfig, sectioned: readonly string[]): Plugin {
  const resolved = new Map([STRUCTURE, SETUP].map((id) => [id, `\0loominate:${id.slice(12)}`]));
  return {
    name: "loominate-coverage",
    resolveId(source) {
      return resolved.get(source);
    },
    load(id) {
      if (id === resolved.get(STRUCTURE)) {
        return [
          'import { coverageChecks, createEventRecord, createStore, createStory } from "@loominate-if/core";',
          ...gameModule(config, sectioned),
          "const store = createStore();",
          `const story = createStory(store, createEventRecord(store), passages, { start: ${JSON.stringify(config.start)}, seed: "coverage" });`,
          "const said = (e) => (e instanceof Error ? e.message : String(e));",
          "let startError;",
          "try { story.begin(); } catch (e) { startError = said(e); }",
          "const game = { story, passages: shown };",
          "export const structure = {",
          "  ...(startError !== undefined && { startError }),",
          "  checks: coverageChecks.entries().map(({ key, value }) => {",
          "    try {",
          "      return { name: key, title: value.title, unreachable: [...(value.unreachable?.(game) ?? [])], items: [...(value.items?.(game) ?? [])] };",
          "    } catch (e) {",
          "      return { name: key, title: value.title, unreachable: [], items: [], error: said(e) };",
          "    }",
          "  }),",
          "};",
          "",
        ].join("\n");
      }
      if (id === resolved.get(SETUP)) {
        return [
          'import { mkdtempSync, writeFileSync } from "node:fs";',
          'import path from "node:path";',
          'import { coverageChecks } from "@loominate-if/core";',
          'import { _watchPlays } from "@loominate-if/testing";',
          'import { afterAll, afterEach } from "vitest";',
          ...gameModule(config, sectioned),
          "const reached = new Set();",
          "let last;",
          // Read while the walkthrough's game is still the one running: before the next begins, and after each test.
          "const collect = () => {",
          "  if (!last) return;",
          "  const game = { story: last, passages: shown };",
          "  for (const { value } of coverageChecks.entries()) {",
          "    try { for (const key of value.reached?.(game) ?? []) reached.add(key); } catch {}",
          "  }",
          "  last = undefined;",
          "};",
          "_watchPlays({ starting: collect, started: (story) => { last = story; } });",
          "afterEach(collect);",
          "afterAll(() => {",
          "  collect();",
          `  const dir = mkdtempSync(path.join(process.env[${JSON.stringify(OUT_ENV)}], "file-"));`,
          '  writeFileSync(path.join(dir, "reached.json"), JSON.stringify([...reached]));',
          "});",
          "",
        ].join("\n");
      }
      return undefined;
    },
  };
}

/** Loads the game in Node, begins it, and runs the checks on it. */
async function loadStructure(
  config: ResolvedConfig,
  options: CommandOptions,
  sectioned: readonly string[],
): Promise<Structure> {
  const server = await createServer(
    mergeConfig(viteConfig(config, options), {
      plugins: [coveragePlugin(config, sectioned)],
      // No HMR socket or watcher: it loads the game once.
      server: { middlewareMode: true, hmr: false, ws: false, watch: null },
      appType: "custom",
      logLevel: "silent",
    }),
  );
  try {
    const loaded = (await server.ssrLoadModule(STRUCTURE)) as { structure: Structure };
    return loaded.structure;
  } finally {
    await server.close();
  }
}

/** The report as the terminal shows it. */
export function formatCoverage(report: CoverageReport): string {
  const lines: string[] = [];
  const byTitle = <T extends { readonly title: string }>(list: readonly T[]) => {
    const groups = new Map<string, T[]>();
    for (const item of list) groups.set(item.title, [...(groups.get(item.title) ?? []), item]);
    return groups;
  };
  lines.push(
    report.unreachable.length === 0
      ? "Can't be reached: nothing."
      : `Can't be reached (${String(report.unreachable.length)}):`,
  );
  for (const [title, list] of byTitle(report.unreachable)) {
    lines.push(`  ${title}`);
    for (const u of list) {
      const at = u.file === undefined ? "" : `${u.file}:${String(u.line ?? 1)}: `;
      // The compiler's say what they're about; the checks' are named first.
      lines.push(`    ${at}${u.file === undefined ? `${u.label}: ${u.why}` : u.why}`);
    }
  }
  lines.push("");
  const { tests, failed } = report.walkthroughs;
  if (tests === 0) {
    lines.push("Not reached by walkthroughs: there are no walkthroughs (*.test.ts) to run.");
  } else {
    const missed = report.notReached.reduce((n, c) => n + c.missed.length, 0);
    const total = report.notReached.reduce((n, c) => n + c.total, 0);
    lines.push(
      `Not reached by walkthroughs (${String(missed)} of ${String(total)}, from ${String(tests)} ${tests === 1 ? "test" : "tests"}${failed > 0 ? `, ${String(failed)} failed` : ""}):`,
    );
    // Merged by heading, as core's actions and the world model's are one list.
    const merged = new Map<string, { total: number; missed: string[] }>();
    for (const c of report.notReached) {
      const m = merged.get(c.title) ?? { total: 0, missed: [] };
      merged.set(c.title, { total: m.total + c.total, missed: [...m.missed, ...c.missed] });
    }
    for (const [title, c] of merged) {
      lines.push(
        `  ${title}: ${c.missed.length === 0 ? `all ${String(c.total)} reached` : `${String(c.missed.length)} of ${String(c.total)} not reached`}`,
      );
      for (const label of c.missed) lines.push(`    ${label}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
