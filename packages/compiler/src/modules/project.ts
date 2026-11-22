/**
 * Compiling a game's passage files and TypeScript modules as one program
 * (ADR 0005): parse each `.weft` file, generate its module, and type-check
 * everything together, mapping errors in generated code back to passage lines.
 */
import path from "node:path";
import ts from "typescript";
import type { CompilerExtension } from "../extensions/extension.js";
import { resolveExtensions } from "../extensions/resolve.js";
import { parsePassageFile } from "../passages/parse.js";
import { locator } from "../passages/positions.js";
import type { PassageFileSyntax, Span } from "../passages/syntax.js";
import { CONTEXT_NAMES, generatePassageModule, type GeneratedModule } from "./generate.js";
import { checkLinks, closestName, codeIn, stringLiterals, type FilePassage } from "./links.js";
import {
  authorMessage,
  missingName,
  undefinedNameMessage,
  type MessageContext,
  type NameHelp,
} from "./messages.js";
import { checkObjectIds, findObjectDefinitions } from "./object-ids.js";
import { toSource } from "./source-map.js";

/** The extension of passage files. */
export const PASSAGE_EXTENSION = ".weft";

/** A source file given to the compiler in memory. */
export type ProjectFile = {
  /** Path, absolute or relative to the project root. */
  readonly path: string;
  /** The file's text. */
  readonly text: string;
};

/** Options for {@link compileProject}. */
export type ProjectOptions = {
  /** The game's root directory. Relative paths are resolved against it. */
  readonly root: string;
  /**
   * Passage files (`.weft`) and TypeScript modules, in memory. Other files,
   * such as packages in `node_modules`, are read from disk.
   */
  readonly files: readonly ProjectFile[];
  /**
   * The scope module, whose exports inline code can use without importing.
   * Relative to `root`. Defaults to `story.ts`; it's fine for it not to exist.
   */
  readonly scope?: string;
  /** TypeScript options. Defaults to strict ES2023 modules with Node resolution. */
  readonly compilerOptions?: ts.CompilerOptions;
  /**
   * Packages' compiler extensions, in load order: the directives, tag roles,
   * line forms, and checks they add. Core's is always loaded first.
   */
  readonly extensions?: readonly CompilerExtension[];
  /**
   * The passage the game starts in. With it, passages that nothing leads to
   * are reported as warnings; without it, they aren't checked.
   */
  readonly start?: string;
  /**
   * Packages the game is played with but doesn't import itself, such as
   * `@loominate-if/presentation`, whose type declarations apply to the game
   * as if `story.ts` imported them: the message keys, event kinds, and hooks
   * they declare. A package that can't be found is skipped.
   */
  readonly ambient?: readonly string[];
};

/** A problem in a game's sources, positioned for the author. */
export type ProjectDiagnostic = {
  /** Errors stop the game from building; warnings point at likely mistakes. */
  readonly severity: "error" | "warning";
  /** Which stage found it: an `extension` is a package's check. */
  readonly source: "parser" | "compiler" | "typescript" | "extension";
  /** For an extension's check, the package and check, as `@loominate-if/world: exits`. */
  readonly check?: string;
  /** The author's file: a passage file for errors in inline code. */
  readonly file: string;
  /** What went wrong. */
  readonly message: string;
  /** Where, in `file`. */
  readonly span: Span;
  /** Line of `span.start`, from 1. */
  readonly line: number;
  /** Column of `span.start`, from 1. */
  readonly column: number;
  /** The TypeScript error code, for TypeScript diagnostics. */
  readonly code?: number;
};

/** The result of {@link compileProject}. */
export type CompiledProject = {
  /** Each passage file's generated module, by passage file path. */
  readonly modules: ReadonlyMap<string, GeneratedModule>;
  /** The generated module listing every passage name as a type. */
  readonly passageNames: { readonly path: string; readonly code: string };
  /** Every problem found, sorted by file and position. */
  readonly diagnostics: readonly ProjectDiagnostic[];
};

const DEFAULT_OPTIONS: ts.CompilerOptions = {
  strict: true,
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  skipLibCheck: true,
  noEmit: true,
};

/** A relative import specifier from `fromFile` to the TypeScript file `toFile`. */
function specifier(fromFile: string, toFile: string): string {
  let rel = path.relative(path.dirname(fromFile), toFile).split(path.sep).join("/");
  rel = rel.replace(/\.(m|c)?tsx?$/, (ext) => ext.replace("t", "j"));
  return rel.startsWith(".") ? rel : `./${rel}`;
}

/** What changed after {@link CompilerSession.update}. */
export type SessionChange = {
  /** Passage files whose generated module changed, or that were removed. */
  readonly modules: readonly string[];
  /** Whether the passage-names module changed, because passages were added, removed, or renamed. */
  readonly passageNames: boolean;
};

/**
 * A compiler that stays alive between edits, for a dev server or editor: it
 * regenerates only the passage modules an edit affects, and type-checks
 * incrementally.
 */
export type CompilerSession = {
  /**
   * Replaces a file's text, or removes it with `undefined`, and regenerates
   * what depends on it: the passage file's module, or every module if the
   * scope module's exports changed.
   */
  update(path: string, text: string | undefined): SessionChange;
  /** A passage file's generated module, by the passage file's path. */
  module(path: string): GeneratedModule | undefined;
  /** Every generated module, by passage file path. */
  modules(): ReadonlyMap<string, GeneratedModule>;
  /** The generated module listing every passage name as a type. */
  passageNames(): { readonly path: string; readonly code: string };
  /**
   * Every problem in the game as it stands, sorted by file and position.
   * Type-checking reuses the last check's work.
   * @throws Error if `start` names no passage.
   */
  diagnostics(): readonly ProjectDiagnostic[];
};

/** A passage file as last generated, with what it was generated from. */
type Generated = {
  readonly text: string;
  readonly scopeKey: string;
  readonly parsed: PassageFileSyntax;
  readonly module: GeneratedModule;
};

/**
 * Starts a compiler session over a game's sources. See {@link compileProject}
 * for a one-off compile.
 * @throws Error if the extensions are malformed or conflict.
 */
export function createCompilerSession(options: ProjectOptions): CompilerSession {
  const root = path.resolve(options.root);
  const resolve = (p: string): string => path.resolve(root, p);
  const memory = new Map<string, string>();
  for (const f of options.files) memory.set(resolve(f.path), f.text);
  const compilerOptions = { ...DEFAULT_OPTIONS, ...options.compilerOptions, noEmit: true };
  const extensions = options.extensions ?? [];
  // Malformed or conflicting extensions are the game's setup, not its source: throw.
  const syntax = resolveExtensions(extensions);
  const entryRoles = new Set(
    [...syntax.tagRoles.values()]
      .filter((r) => r.definition.entry === true)
      .map((r) => r.definition.name),
  );
  const scopePath = resolve(options.scope ?? "story.ts");
  const namesPath = resolve("$passages.ts");
  const isTs = (p: string): boolean => /\.(m|c)?tsx?$/.test(p);
  const weftFiles = (): string[] =>
    [...memory.keys()].filter((p) => p.endsWith(PASSAGE_EXTENSION)).sort();
  const tsFiles = (): string[] => [...memory.keys()].filter(isTs).sort();

  const host = ts.createCompilerHost(compilerOptions);
  const virtual = new Map<string, string>();
  const read = (p: string): string | undefined => virtual.get(p) ?? memory.get(p);
  // Brings in the declarations of packages the game is played with, such as
  // presentation's message keys, though nothing in the game imports them.
  if (options.ambient && options.ambient.length > 0) {
    virtual.set(
      resolve("$ambient.ts"),
      options.ambient.map((m) => `import type {} from ${JSON.stringify(m)};\n`).join(""),
    );
  }
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (p) => read(path.resolve(p)) !== undefined || fileExists(p);
  // In-memory files may live in directories that don't exist on disk.
  const directoryExists = host.directoryExists?.bind(host);
  host.directoryExists = (d) => {
    const dir = path.resolve(d) + path.sep;
    for (const p of [...memory.keys(), ...virtual.keys()]) if (p.startsWith(dir)) return true;
    return directoryExists ? directoryExists(d) : ts.sys.directoryExists(d);
  };
  host.readFile = (p) => read(path.resolve(p)) ?? readFile(p);
  // Source files are kept while their text is unchanged, so later checks reuse them.
  const sourceFiles = new Map<string, ts.SourceFile>();
  host.getSourceFile = (p, language, onError, create) => {
    const text = read(path.resolve(p));
    if (text === undefined) return getSourceFile(p, language, onError, create);
    const known = sourceFiles.get(p);
    if (known?.text === text) return known;
    const made = ts.createSourceFile(p, text, language, true);
    sourceFiles.set(p, made);
    return made;
  };

  let program: ts.Program | undefined;
  let scopeExists = false;
  let scopeExports = new Set<string>();
  /** The scope's exports as one string, so a module knows when it's stale. */
  let scopeKey = "";
  let reserved: { name: string; at: number }[] = [];
  const generated = new Map<string, Generated>();
  let namesCode = "";
  let checked: readonly ProjectDiagnostic[] | undefined;

  /** What the scope module exports. */
  function refreshScope(): void {
    scopeExists = host.fileExists(scopePath);
    scopeExports = new Set();
    reserved = [];
    if (scopeExists) {
      program = ts.createProgram({
        rootNames: [...new Set([...tsFiles(), scopePath])],
        options: compilerOptions,
        host,
        ...(program && { oldProgram: program }),
      });
      const checker = program.getTypeChecker();
      const file = program.getSourceFile(scopePath);
      const symbol = file && checker.getSymbolAtLocation(file);
      for (const s of symbol ? checker.getExportsOfModule(symbol) : []) {
        scopeExports.add(s.name);
        if (CONTEXT_NAMES.includes(s.name) || s.name.startsWith("$")) {
          reserved.push({ name: s.name, at: s.declarations?.[0]?.getStart() ?? 0 });
        }
      }
    }
    scopeKey = `${String(scopeExists)}:${[...scopeExports].sort().join(",")}`;
  }

  /** Regenerates the passage modules that are stale, and the passage-names module. */
  function regenerate(): SessionChange {
    const changed: string[] = [];
    const files = weftFiles();
    for (const file of [...generated.keys()]) {
      if (memory.has(file)) continue;
      generated.delete(file);
      virtual.delete(`${file}.ts`);
      changed.push(file);
    }
    for (const file of files) {
      const text = memory.get(file) ?? "";
      const known = generated.get(file);
      if (known?.text === text && known.scopeKey === scopeKey) continue;
      const parsed = parsePassageFile(text, {
        file,
        directives: syntax.parserDirectives,
        lineForms: syntax.parserLineForms,
      });
      const modulePath = `${file}.ts`;
      const module = generatePassageModule(parsed, text, {
        modulePath,
        scopeExports,
        passageNamesSpecifier: specifier(modulePath, namesPath),
        extensions,
        ...(scopeExists && { scopeSpecifier: specifier(modulePath, scopePath) }),
      });
      generated.set(file, { text, scopeKey, parsed, module });
      if (known?.module.code !== module.code) {
        virtual.set(modulePath, module.code);
        changed.push(file);
      }
    }
    const names = new Set<string>();
    for (const { parsed } of generated.values()) {
      for (const p of parsed.passages) if (p.name.name !== "") names.add(p.name.name);
    }
    const code = [
      "// Generated by @loominate-if/compiler. Do not edit.",
      "/** The name of every passage in the game. */",
      `export type PassageName = ${
        names.size > 0
          ? [...names]
              .sort()
              .map((n) => JSON.stringify(n))
              .join(" | ")
          : "never"
      };`,
      "",
    ].join("\n");
    const namesChanged = code !== namesCode;
    namesCode = code;
    virtual.set(namesPath, namesCode);
    checked = undefined;
    return { modules: changed.sort(), passageNames: namesChanged };
  }

  function check(): ProjectDiagnostic[] {
    const diagnostics: ProjectDiagnostic[] = [];
    const scopeLines = locator(host.readFile(scopePath) ?? "");
    for (const { name, at } of reserved) {
      diagnostics.push({
        severity: "error",
        source: "compiler",
        file: scopePath,
        message: name.startsWith("$")
          ? `The scope module exports \`${name}\`, but names starting with \`$\` are reserved for generated code. Rename the export.`
          : `The scope module exports \`${name}\`, but passages already have \`${name}\` from their context. Rename the export.`,
        span: { start: at, end: at + name.length },
        ...scopeLines.locate(at),
      });
    }

    const names = new Set<string>();
    const sources = new Map<string, string>();
    const allPassages: FilePassage[] = [];
    const parsedFiles: PassageFileSyntax[] = [];
    const modules = new Map<string, GeneratedModule>();
    // Strings in code may name passages, as in goTo("Attic"); those count as reachable.
    const named = new Set<string>();
    for (const f of tsFiles())
      for (const lit of stringLiterals(memory.get(f) ?? "")) named.add(lit);
    for (const [file, { text, parsed, module }] of [...generated].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      sources.set(file, text);
      parsedFiles.push(parsed);
      modules.set(file, module);
      for (const d of parsed.diagnostics) diagnostics.push({ source: "parser", file, ...d });
      for (const p of parsed.passages) {
        if (p.name.name === "") continue;
        names.add(p.name.name);
        allPassages.push({ file, passage: p });
        for (const c of codeIn(p.content)) for (const lit of stringLiterals(c.code)) named.add(lit);
      }
      for (const d of module.diagnostics) diagnostics.push({ source: "compiler", file, ...d });
    }
    if (options.start !== undefined && !names.has(options.start)) {
      throw new Error(
        `start: there's no passage named ${JSON.stringify(options.start)}. Pass the name of the passage the game starts in.`,
      );
    }
    for (const { definition: c, from } of syntax.checks) {
      let found;
      try {
        found = c.run({ files: parsedFiles });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`The check "${c.name}" from ${from} failed: ${reason}`, { cause: error });
      }
      for (const d of found) {
        diagnostics.push({
          severity: d.severity,
          source: "extension",
          check: `${from}: ${c.name}`,
          file: d.file,
          message: d.message,
          span: d.span,
          ...locator(sources.get(d.file) ?? "").locate(d.span.start),
        });
      }
    }
    for (const problem of checkLinks(allPassages, named, options.start, entryRoles)) {
      const at = problem.at.span.start;
      diagnostics.push({
        severity: problem.severity,
        source: "compiler",
        file: problem.file,
        message: problem.message,
        span: problem.at.span,
        ...locator(sources.get(problem.file) ?? "").locate(at),
      });
    }

    // Type-check everything as one program, reusing the last check's work.
    const files = tsFiles();
    program = ts.createProgram({
      rootNames: [...new Set([...files, ...(scopeExists ? [scopePath] : []), ...virtual.keys()])],
      options: compilerOptions,
      host,
      ...(program && { oldProgram: program }),
    });
    const byModule = new Map([...modules.values()].map((m) => [m.path, m]));
    const userFiles = [...new Set([...files, ...(scopeExists ? [scopePath] : [])])];
    const display = (file: string): string => path.relative(root, file).split(path.sep).join("/");

    // What other modules export, to explain names passages can't see.
    const checker = program.getTypeChecker();
    const exportedBy = new Map<string, string>();
    for (const file of files) {
      if (file === scopePath) continue;
      const source = program.getSourceFile(file);
      const symbol = source && checker.getSymbolAtLocation(source);
      for (const s of symbol ? checker.getExportsOfModule(symbol) : []) {
        if (!exportedBy.has(s.name)) exportedBy.set(s.name, file);
      }
    }
    const usable = [...scopeExports, ...CONTEXT_NAMES];
    const nameHelp = (name: string): NameHelp => {
      const other = scopeExports.has(name) ? undefined : exportedBy.get(name);
      const suggestion = closestName(name, usable);
      return {
        scope: scopeExists ? display(scopePath) : undefined,
        ...(other !== undefined && {
          exportedBy: { path: display(other), specifier: specifier(scopePath, other) },
        }),
        ...(suggestion !== undefined && { suggestion }),
      };
    };

    /** What a message rewrite can know about an error in a generated module. */
    const passageContext = (code: string, start: number, length = 0): MessageContext => ({
      printed: code.slice(0, start).endsWith("$print("),
      code: code.slice(start, start + length),
      assigned: /^\s*=(?!=)/.test(code.slice(start + length)),
      passages: names,
      scope: scopeExists ? display(scopePath) : "story.ts",
    });

    for (const d of ts.getPreEmitDiagnostics(program)) {
      if (!d.file || d.start === undefined) continue;
      const fileName = path.resolve(d.file.fileName);
      const generated = byModule.get(fileName);
      const text = ts.flattenDiagnosticMessageText(d.messageText, "\n");
      const missing = generated ? missingName(text) : undefined;
      const message =
        missing !== undefined
          ? undefinedNameMessage(missing, nameHelp(missing))
          : authorMessage(text, generated ? passageContext(generated.code, d.start, d.length) : {});
      if (generated) {
        const at = toSource(generated.mappings, d.start) ?? 0;
        const end = toSource(generated.mappings, d.start + (d.length ?? 0)) ?? at;
        const lines = locator(sources.get(generated.file) ?? "");
        diagnostics.push({
          severity: "error",
          source: "typescript",
          file: generated.file,
          message,
          span: { start: at, end: Math.max(end, at) },
          ...lines.locate(at),
          code: d.code,
        });
      } else if (memory.has(fileName)) {
        const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
        diagnostics.push({
          severity: "error",
          source: "typescript",
          file: fileName,
          message,
          span: { start: d.start, end: d.start + (d.length ?? 0) },
          line: line + 1,
          column: character + 1,
          code: d.code,
        });
      }
    }

    // 4. Object IDs must be unique and not reserved.
    const sites = findObjectDefinitions(program, userFiles);
    const lines = new Map<string, ReturnType<typeof locator>>();
    const lineOf = (file: string): ReturnType<typeof locator> => {
      let l = lines.get(file);
      if (!l) lines.set(file, (l = locator(host.readFile(file) ?? "")));
      return l;
    };
    const where = (file: string, at: number): string => {
      const { line, column } = lineOf(file).locate(at);
      return `${display(file)}:${String(line)}:${String(column)}`;
    };
    for (const { site, message } of checkObjectIds(sites, (s) => where(s.file, s.start))) {
      diagnostics.push({
        severity: "error",
        source: "compiler",
        file: site.file,
        message,
        span: { start: site.start, end: site.end },
        ...lineOf(site.file).locate(site.start),
      });
    }

    diagnostics.sort((a, b) => a.file.localeCompare(b.file) || a.span.start - b.span.start);
    return diagnostics;
  }

  refreshScope();
  regenerate();

  return {
    update(file, text) {
      const at = resolve(file);
      if (text === undefined) memory.delete(at);
      else memory.set(at, text);
      // A TypeScript file can change what the scope module exports.
      if (isTs(at)) refreshScope();
      return regenerate();
    },
    module: (file) => generated.get(resolve(file))?.module,
    modules: () =>
      new Map(
        [...generated].sort(([a], [b]) => a.localeCompare(b)).map(([file, g]) => [file, g.module]),
      ),
    passageNames: () => ({ path: namesPath, code: namesCode }),
    diagnostics() {
      checked ??= check();
      return checked;
    },
  };
}

/**
 * Parses, generates, and type-checks a game's sources once.
 *
 * @remarks
 * Each passage file `scenes/cellar.weft` becomes a virtual module
 * `scenes/cellar.weft.ts` exporting `passages`. Errors in inline code are
 * reported at the passage file's lines. A dev server keeps a
 * {@link createCompilerSession} instead, so edits recompile incrementally.
 */
export function compileProject(options: ProjectOptions): CompiledProject {
  const session = createCompilerSession(options);
  const diagnostics = session.diagnostics();
  return { modules: session.modules(), passageNames: session.passageNames(), diagnostics };
}
