/**
 * The Vite plugin that compiles passage files (#35, ADR 0016).
 *
 * It keeps one compiler session for the game. `import { passages } from
 * "./cellar.weft"` resolves to the passage file's generated module,
 * `cellar.weft.ts`, which Vite compiles as TypeScript, with a source map back
 * to the passage file. When a passage file or TypeScript module changes, the
 * session regenerates only the modules the edit affects, and those are
 * hot-updated.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  createCompilerSession,
  PASSAGE_EXTENSION,
  type CompilerExtension,
  type CompilerSession,
  type ProjectDiagnostic,
  type ProjectFile,
  type SessionChange,
} from "@loominate-if/compiler";
import type { EnvironmentModuleNode, ErrorPayload, Logger, Plugin } from "vite";

/** Options for {@link loominate}. */
export type LoominateOptions = {
  /** The scope module, relative to the game's root. Defaults to `story.ts`. */
  readonly scope?: string;
  /** The passage the game starts in, so unreachable passages are reported. */
  readonly start?: string;
  /** Packages' compiler extensions, in load order. */
  readonly extensions?: readonly CompilerExtension[];
  /** TypeScript options for type-checking, on top of the compiler's defaults. */
  readonly compilerOptions?: Parameters<typeof createCompilerSession>[0]["compilerOptions"];
};

/** The suffix of a passage file's generated module: `cellar.weft` → `cellar.weft.ts`. */
const MODULE_SUFFIX = ".ts";
const SKIP = new Set(["node_modules", "dist", ".git"]);
const SOURCE = /\.(weft|m?tsx?)$/;
/** Tool configuration such as `vite.config.ts`, which isn't part of the game. */
const CONFIG = /\.config\.[cm]?[jt]sx?$/;

/**
 * Every passage file and TypeScript module under `root`, outside dependencies
 * and output, and not tool configuration such as `vite.config.ts`.
 */
export function gameFiles(root: string): ProjectFile[] {
  const out: ProjectFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (
        SOURCE.test(entry.name) &&
        !entry.name.endsWith(".d.ts") &&
        !CONFIG.test(entry.name)
      ) {
        out.push({ path: full, text: readFileSync(full, "utf8") });
      }
    }
  };
  walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Vite's error overlay payload for the game's errors, or `undefined` if it has none. */
export function overlay(
  root: string,
  diagnostics: readonly ProjectDiagnostic[],
): ErrorPayload | undefined {
  const errors = diagnostics.filter((d) => d.severity === "error");
  const [first] = errors;
  if (!first) return undefined;
  const count = errors.length === 1 ? "an error" : `${String(errors.length)} errors`;
  return {
    type: "error",
    err: {
      message: `The game has ${count}:\n${errors.map((d) => formatDiagnostic(root, d)).join("\n")}`,
      stack: "",
      id: first.file,
      plugin: "loominate",
      loc: { file: first.file, line: first.line, column: first.column },
      frame: codeFrame(readSource(first.file), first.line, first.column),
    },
  };
}

/** A file's text, or "" if it's gone. */
function readSource(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

/** The lines around `line`, numbered, with a caret under `column`. */
export function codeFrame(text: string, line: number, column: number): string {
  const lines = text.split(/\r?\n/);
  const from = Math.max(1, line - 2);
  const to = Math.min(lines.length, line + 1);
  const width = String(to).length;
  const out: string[] = [];
  for (let n = from; n <= to; n++) {
    out.push(`${n === line ? ">" : " "} ${String(n).padStart(width)} | ${lines[n - 1] ?? ""}`);
    if (n === line) out.push(`  ${" ".repeat(width)} | ${" ".repeat(Math.max(0, column - 1))}^`);
  }
  return out.join("\n");
}

/** A diagnostic as one line: `scenes/cellar.weft:3:5 error: …`. */
export function formatDiagnostic(root: string, d: ProjectDiagnostic): string {
  const file = path.relative(root, d.file).split(path.sep).join("/");
  return `${file}:${String(d.line)}:${String(d.column)} ${d.severity}: ${d.message}`;
}

/**
 * Compiles a game's passage files for Vite, with hot updates.
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { loominate } from "@loominate-if/cli";
 * export default { plugins: [loominate({ start: "Kitchen" })] };
 * ```
 */
export function loominate(options: LoominateOptions = {}): Plugin {
  let root = "";
  let session: CompilerSession | undefined;
  let logger: Logger | undefined;
  /** Each file change, applied once and shared by every environment's hot update. */
  const changes = new Map<string, SessionChange>();

  const active = (): CompilerSession => {
    if (!session) throw new Error("loominate: the plugin's config hasn't been resolved yet.");
    return session;
  };
  const isPassageFile = (id: string): boolean => id.endsWith(PASSAGE_EXTENSION);
  const inGame = (file: string): boolean =>
    file.startsWith(root + path.sep) && !file.split(path.sep).some((part) => SKIP.has(part));

  /** Whether the last report had problems, so fixing the last one can be announced. */
  let hadProblems = false;
  /**
   * Logs the game's problems when the dev server starts and after each edit,
   * so the author sees them where the server runs, and says when they're all fixed.
   */
  const report = (): void => {
    const diagnostics = active().diagnostics();
    for (const d of diagnostics) {
      const line = formatDiagnostic(root, d);
      if (d.severity === "error") logger?.error(line, { timestamp: true });
      else logger?.warn(line, { timestamp: true });
    }
    if (diagnostics.length === 0 && hadProblems) {
      logger?.info("The game has no problems now.", { timestamp: true });
    }
    hadProblems = diagnostics.length > 0;
  };

  /** A passage file's generated code, for Vite and for its dependency scan. */
  const generatedCode = (id: string): string | undefined =>
    id.endsWith(PASSAGE_EXTENSION + MODULE_SUFFIX)
      ? active().module(id.slice(0, -MODULE_SUFFIX.length))?.code
      : undefined;

  return {
    name: "loominate",
    enforce: "pre",

    config() {
      // Vite scans the game's imports for dependencies at startup, reading each
      // module from disk. Generated modules aren't on disk, so give it their code.
      return {
        optimizeDeps: {
          rolldownOptions: {
            plugins: [
              {
                name: "loominate-scan",
                load(id: string) {
                  const code = generatedCode(id);
                  return code === undefined ? undefined : { code, moduleType: "ts" as const };
                },
              },
            ],
          },
        },
      };
    },

    configResolved(config) {
      root = path.resolve(config.root);
      logger = config.logger;
      session = createCompilerSession({
        root,
        files: gameFiles(root),
        ...(options.scope !== undefined && { scope: options.scope }),
        ...(options.start !== undefined && { start: options.start }),
        ...(options.extensions !== undefined && { extensions: options.extensions }),
        ...(options.compilerOptions !== undefined && { compilerOptions: options.compilerOptions }),
      });
    },

    configureServer(server) {
      // Problems already in the game when the server starts, before any edit.
      report();
      // Each page that connects, including after the reload an edit causes,
      // sees the game's errors in Vite's overlay as well as in the terminal.
      server.ws.on("vite:client:connect", (_data, client) => {
        const payload = overlay(root, active().diagnostics());
        if (payload) client.send(payload);
      });
    },

    buildStart() {
      // A build fails on errors; the dev server only reports them.
      if (this.meta.watchMode) return;
      const diagnostics = active().diagnostics();
      for (const d of diagnostics) {
        if (d.severity === "warning") this.warn(formatDiagnostic(root, d));
      }
      const errors = diagnostics.filter((d) => d.severity === "error");
      if (errors.length > 0) {
        this.error(
          `the game has ${String(errors.length)} error${errors.length === 1 ? "" : "s"}:\n${errors
            .map((d) => formatDiagnostic(root, d))
            .join("\n")}`,
        );
      }
    },

    resolveId(source, importer) {
      // A generated module asked for by its own URL, `/cellar.weft.ts`, as Vitest's
      // module runner does when a second test file imports what a first one did.
      if (source.endsWith(PASSAGE_EXTENSION + MODULE_SUFFIX)) {
        const file = source.slice(0, -MODULE_SUFFIX.length);
        if (path.isAbsolute(file) && active().module(file)) return source;
        const fromRoot = path.join(root, file);
        if (active().module(fromRoot)) return fromRoot + MODULE_SUFFIX;
        return undefined;
      }
      // `./cellar.weft.js` is how TypeScript's NodeNext resolution names it; `./cellar.weft` works too.
      const spec = source.endsWith(`${PASSAGE_EXTENSION}.js`) ? source.slice(0, -3) : source;
      if (!isPassageFile(spec) || !(spec.startsWith(".") || path.isAbsolute(spec))) return;
      const file = path.resolve(importer ? path.dirname(importer) : root, spec);
      return active().module(file) ? file + MODULE_SUFFIX : undefined;
    },

    load(id) {
      if (!id.endsWith(PASSAGE_EXTENSION + MODULE_SUFFIX)) return;
      const file = id.slice(0, -MODULE_SUFFIX.length);
      const module = active().module(file);
      if (!module) return;
      this.addWatchFile(file);
      const map = module.sourceMap();
      // Vite's types want mutable arrays.
      const { file: mapped, mappings, version } = map;
      return {
        code: module.code,
        map: {
          version,
          file: mapped,
          mappings,
          names: [...map.names],
          sources: [...map.sources],
          sourcesContent: [...map.sourcesContent],
        },
      };
    },

    async hotUpdate({ file, timestamp, type, read, modules }) {
      if (!SOURCE.test(file) || CONFIG.test(file) || !inGame(file)) return;
      const key = `${file}@${String(timestamp)}`;
      let change = changes.get(key);
      if (!change) {
        change = active().update(file, type === "delete" ? undefined : await read());
        changes.set(key, change);
        // Only the latest few are needed: one per environment for each change.
        for (const old of [...changes.keys()].slice(0, -16)) changes.delete(old);
        report();
      }
      const graph = this.environment.moduleGraph;
      const regenerated = change.modules
        .map((f) => graph.getModuleById(f + MODULE_SUFFIX))
        .filter((m): m is EnvironmentModuleNode => m !== undefined);
      // A passage file is known only through its generated module.
      if (isPassageFile(file)) return regenerated;
      // A TypeScript module updates as usual, plus any passage modules it changed.
      return regenerated.length > 0 ? [...modules, ...regenerated] : undefined;
    },
  };
}
