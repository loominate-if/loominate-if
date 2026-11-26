/**
 * Compiling a game's passage files and TypeScript modules as one program
 * (ADR 0005): parse each `.weft` file, generate its module, and type-check
 * everything together, mapping errors in generated code back to passage lines.
 */
import { checkTextIn, registeredIn } from "./text-parameters.js";
import { checkVerbPhrases } from "./verb-phrases.js";
import path from "node:path";
import ts from "typescript";
import type { CompilerExtension } from "../extensions/extension.js";
import { resolveExtensions } from "../extensions/resolve.js";
import { parsePassageFile } from "../passages/parse.js";
import { locator } from "../passages/positions.js";
import type { PassageFileSyntax, Span } from "../passages/syntax.js";
import { passageView, type StoryMap } from "../map/story-map.js";
import { CONTEXT_NAMES, generatePassageModule, type GeneratedModule } from "./generate.js";
import {
  checkLinks,
  closestName,
  codeIn,
  passageTargets,
  stringLiterals,
  type FilePassage,
} from "./links.js";
import { nameUses, type NameUse } from "./uses.js";
import {
  authorMessage,
  missingName,
  undefinedNameMessage,
  type MessageContext,
  type NameHelp,
} from "./messages.js";
import { checkObjectIds, findObjectDefinitions } from "./object-ids.js";
import { toSource } from "./source-map.js";

/** Libraries a passage's undefined name may come from, beyond those `story.ts` imports. */
const LIBRARIES = ["@loominate-if/core", "@loominate-if/world"];

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
  /**
   * True if it likely follows from another error rather than being one of
   * its own, as when TypeScript recovers from a broken expression: any error
   * after the file's first syntax error, an error in generated code with no
   * author position while the file has others, or, in a file with a syntax
   * error, one about the generated code around it, such as a passage body
   * that no longer returns or a compiler-generated `$` name. {@link shownDiagnostics}
   * holds these back unless asked for every diagnostic.
   */
  readonly followOn?: true;
  /**
   * True if it says something can't be reached, as a passage nothing leads
   * to: `loominate coverage` reports these (#133).
   */
  readonly unreachable?: true;
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
  /** The game's story map: its passages and the ways between them (#149). */
  storyMap(): StoryMap;
  /** A passage file as last parsed, by its path, for an editor's features (#410). */
  parsed(path: string): PassageFileSyntax | undefined;
  /**
   * The directives and tag roles the game's packages add, core's first, each
   * with the package it's from, for an editor to complete (#410).
   */
  syntax(): SessionSyntax;
  /**
   * Every problem in the game as it stands, sorted by file and position.
   * Type-checking reuses the last check's work.
   * @throws Error if `start` names no passage.
   */
  diagnostics(): readonly ProjectDiagnostic[];
};

/** The directives and tag roles a session's packages add, as {@link CompilerSession.syntax} gives them. */
export type SessionSyntax = {
  /** Each directive, with how it's written, its kind, and the passage roles it's limited to, if any. */
  readonly directives: readonly {
    readonly name: string;
    readonly kind: string;
    readonly example?: string;
    readonly roles?: readonly string[];
    readonly from: string;
  }[];
  /** Each tag role, as `room` in `[room: hall]`. */
  readonly tagRoles: readonly { readonly name: string; readonly from: string }[];
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
  /**
   * Each name the given packages export, with the first package that does,
   * from a small program of its own, so a game's own check never sees
   * packages it doesn't use.
   */
  const exportsOfLibraries = (packages: readonly string[]): Map<string, string> => {
    const out = new Map<string, string>();
    const probe = resolve("$libraries.ts");
    const code = packages
      .map((p, i) => `import type * as $${String(i)} from ${JSON.stringify(p)};\n`)
      .join("");
    virtual.set(probe, code);
    try {
      const libs = ts.createProgram({ rootNames: [probe], options: compilerOptions, host });
      const checker = libs.getTypeChecker();
      const source = libs.getSourceFile(probe);
      for (const statement of source?.statements ?? []) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
          continue;
        }
        const symbol = checker.getSymbolAtLocation(statement.moduleSpecifier);
        for (const s of symbol ? checker.getExportsOfModule(symbol) : []) {
          if (!out.has(s.name)) out.set(s.name, statement.moduleSpecifier.text);
        }
      }
    } finally {
      virtual.delete(probe);
    }
    return out;
  };
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
    // Where names are used, for checks that ask: worked out once, the first time one does.
    let uses: ReadonlyMap<string, readonly NameUse[]> | undefined;
    const usesOf = (name: string): readonly NameUse[] => {
      uses ??= nameUses(
        [...new Set([...tsFiles(), ...(host.fileExists(scopePath) ? [scopePath] : [])])].map(
          (file) => ({ file, text: read(file) ?? host.readFile(file) ?? "" }),
        ),
        allPassages.flatMap(({ file, passage }) =>
          codeIn(passage.content).map((c) => ({ file, code: c.code })),
        ),
      );
      return uses?.get(name) ?? [];
    };
    const targeted = new Set(
      allPassages.flatMap(({ passage }) => passageTargets(passage.content).map((t) => t.name)),
    );
    const context = {
      files: parsedFiles,
      ...(options.start !== undefined && { start: options.start }),
      isNamed: (name: string) => targeted.has(name) || named.has(name),
      uses: usesOf,
    };
    for (const { definition: c, from } of syntax.checks) {
      let found;
      try {
        found = c.run(context);
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
          ...(d.unreachable === true && { unreachable: true as const }),
        });
      }
    }
    // Guards whose links take an action and stay on the passage, like `{act …}`.
    const stays = new Set(
      [...syntax.directives].flatMap(([name, defs]) =>
        defs.some((d) => d.definition.kind === "guard" && d.definition.stays === true)
          ? [name]
          : [],
      ),
    );
    for (const problem of checkLinks(allPassages, named, options.start, entryRoles, stays)) {
      const at = problem.at.span.start;
      diagnostics.push({
        severity: problem.severity,
        source: "compiler",
        file: problem.file,
        message: problem.message,
        span: problem.at.span,
        ...locator(sources.get(problem.file) ?? "").locate(at),
        ...(problem.unreachable === true && { unreachable: true as const }),
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
    // The names the scope module imports, and the packages it imports them from.
    const importedByScope = new Set<string>();
    const scopePackages = new Set<string>();
    const scopeSource = scopeExists ? program.getSourceFile(scopePath) : undefined;
    for (const statement of scopeSource?.statements ?? []) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
        continue;
      }
      const from = statement.moduleSpecifier.text;
      if (!from.startsWith(".") && !path.isAbsolute(from)) scopePackages.add(from);
      const clause = statement.importClause;
      if (clause?.name) importedByScope.add(clause.name.text);
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const e of bindings.elements) importedByScope.add(e.name.text);
      }
    }
    /** Which library exports a name, looked up only when a passage needs it. */
    let libraryExports: Map<string, string> | undefined;
    const libraryOf = (name: string): string | undefined => {
      libraryExports ??= exportsOfLibraries([...scopePackages, ...LIBRARIES]);
      return libraryExports.get(name);
    };
    const nameHelp = (name: string): NameHelp => {
      const other = scopeExports.has(name) ? undefined : exportedBy.get(name);
      const imported = !scopeExports.has(name) && importedByScope.has(name);
      const library = imported || other !== undefined ? undefined : libraryOf(name);
      const suggestion = closestName(name, usable);
      return {
        scope: scopeExists ? display(scopePath) : undefined,
        ...(imported && { importedByScope: true }),
        ...(other !== undefined && {
          exportedBy: { path: display(other), specifier: specifier(scopePath, other) },
        }),
        ...(library !== undefined && { library }),
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

    // Syntax errors, so the type errors that follow from them can be told apart.
    const syntactic = new Set<ts.Diagnostic>(program.getSyntacticDiagnostics());
    const typescript: { d: ProjectDiagnostic; syntax: boolean; unmapped: boolean }[] = [];
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
      const syntax = syntactic.has(d);
      if (generated) {
        const mapped = toSource(generated.mappings, d.start);
        const at = mapped ?? 0;
        const end = toSource(generated.mappings, d.start + (d.length ?? 0)) ?? at;
        const lines = locator(sources.get(generated.file) ?? "");
        typescript.push({
          d: {
            severity: "error",
            source: "typescript",
            file: generated.file,
            message,
            span: { start: at, end: Math.max(end, at) },
            ...lines.locate(at),
            code: d.code,
          },
          syntax,
          unmapped: mapped === undefined,
        });
      } else if (memory.has(fileName)) {
        const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
        typescript.push({
          d: {
            severity: "error",
            source: "typescript",
            file: fileName,
            message,
            span: { start: d.start, end: d.start + (d.length ?? 0) },
            line: line + 1,
            column: character + 1,
            code: d.code,
          },
          syntax,
          unmapped: false,
        });
      }
    }
    diagnostics.push(...markFollowOns(typescript));

    // `t` templates' message parameters: their braces, and names a package or the game registers (#235).
    const parameterNames = new Map(syntax.messageParameters);
    for (const file of userFiles) {
      const source = program.getSourceFile(file);
      for (const name of source ? registeredIn(source) : []) {
        if (!parameterNames.has(name)) parameterNames.set(name, display(file));
      }
    }
    const known = {
      names: parameterNames,
      fallbacks: syntax.parameterFallbacks.map((f) => ({ from: f.from, ...f.definition })),
    };
    for (const file of userFiles) {
      const source = program.getSourceFile(file);
      if (!source || !memory.has(file)) continue;
      for (const problem of checkTextIn(source, checker, known)) {
        const { line, character } = source.getLineAndCharacterOfPosition(problem.start);
        diagnostics.push({
          severity: problem.severity,
          source: "compiler",
          file,
          message: problem.message,
          span: { start: problem.start, end: problem.end },
          line: line + 1,
          column: character + 1,
        });
      }
    }
    // Actions' verb phrases: each slot names one of the action's roles (#79).
    for (const file of userFiles) {
      const source = program.getSourceFile(file);
      if (!source || !memory.has(file)) continue;
      for (const problem of checkVerbPhrases(source, checker)) {
        const { line, character } = source.getLineAndCharacterOfPosition(problem.start);
        diagnostics.push({
          severity: "error",
          source: "compiler",
          file,
          message: problem.message,
          span: { start: problem.start, end: problem.end },
          line: line + 1,
          column: character + 1,
        });
      }
    }
    for (const generated of modules.values()) {
      const source = program.getSourceFile(generated.path);
      if (!source) continue;
      const lines = locator(sources.get(generated.file) ?? "");
      for (const problem of checkTextIn(source, checker, known)) {
        const at = toSource(generated.mappings, problem.start);
        if (at === undefined) continue;
        const end = toSource(generated.mappings, problem.end) ?? at;
        diagnostics.push({
          severity: problem.severity,
          source: "compiler",
          file: generated.file,
          message: problem.message,
          span: { start: at, end: Math.max(end, at) },
          ...lines.locate(at),
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
    parsed: (p) => generated.get(resolve(p))?.parsed,
    storyMap() {
      const files = [...generated]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, g]) => ({ parsed: g.parsed, text: g.text }));
      // The compiler reports an unreachable passage at its header.
      const unreachable = new Set<string>();
      for (const d of (checked ??= check())) {
        if (d.unreachable !== true) continue;
        const passage = generated
          .get(d.file)
          ?.parsed.passages.find(
            (p) => p.header.start <= d.span.start && d.span.start <= p.header.end,
          );
        if (passage) unreachable.add(passage.name.name);
      }
      const stays = new Set(
        [...syntax.directives].flatMap(([name, defs]) =>
          defs.some((d) => d.definition.kind === "guard" && d.definition.stays === true)
            ? [name]
            : [],
        ),
      );
      return {
        views: [
          passageView(files, {
            ...(options.start !== undefined && { start: options.start }),
            stays,
            unreachable,
          }),
        ],
      };
    },
    syntax: () => ({
      directives: [...syntax.directives].flatMap(([name, defs]) =>
        defs.map(({ definition: d, from }) => ({
          name,
          kind: d.kind,
          ...(d.example !== undefined && { example: d.example }),
          ...(d.roles !== undefined && { roles: d.roles }),
          from,
        })),
      ),
      tagRoles: [...syntax.tagRoles].map(([name, { from }]) => ({ name, from })),
    }),
    diagnostics() {
      checked ??= check();
      return checked;
    },
  };
}

/** TypeScript's "A function whose declared type is neither … must return a value." */
const MUST_RETURN = 2355;

/**
 * Marks the TypeScript errors that likely follow from others. Once a file's
 * parse breaks, TypeScript's view of everything after the first syntax error
 * is unreliable, so every error after it is held back; errors before it
 * stand. In a file with a syntax error, those about the generated code
 * around it, a passage body that no longer returns or a compiler-generated
 * `$` name, are held back too, and in a file with other errors, those in
 * generated code with no author position.
 */
function markFollowOns(
  found: readonly { d: ProjectDiagnostic; syntax: boolean; unmapped: boolean }[],
): ProjectDiagnostic[] {
  /** Each file's first syntax error. */
  const firstSyntax = new Map<string, number>();
  for (const f of found) {
    if (!f.syntax || f.unmapped) continue;
    const known = firstSyntax.get(f.d.file);
    if (known === undefined || f.d.span.start < known) firstSyntax.set(f.d.file, f.d.span.start);
  }
  const withMapped = new Set(found.filter((f) => !f.unmapped).map((f) => f.d.file));
  return found.map((f) => {
    const first = firstSyntax.get(f.d.file);
    const after = first !== undefined && f.d.span.start > first;
    const aroundBreak =
      first !== undefined &&
      !f.syntax &&
      (f.d.code === MUST_RETURN || f.d.message.startsWith("`$"));
    const orphan = f.unmapped && withMapped.has(f.d.file);
    return after || aroundBreak || orphan ? { ...f.d, followOn: true as const } : f.d;
  });
}

/** What {@link shownDiagnostics} shows, and how many it held back. */
export type ShownDiagnostics = {
  /** The diagnostics to show, in order. */
  readonly shown: readonly ProjectDiagnostic[];
  /** How many it held back: follow-on errors, and those past the limit per file. */
  readonly heldBack: number;
};

/**
 * The diagnostics worth showing an author: without the errors that likely
 * follow from others, and at most `perFile` per file, so one broken line
 * doesn't bury the error that matters. `verbose` shows every one.
 *
 * @example
 * ```ts
 * const { shown, heldBack } = shownDiagnostics(project.diagnostics);
 * // heldBack > 0: "and 58 more; run with --verbose to see them all"
 * ```
 */
export function shownDiagnostics(
  diagnostics: readonly ProjectDiagnostic[],
  options: { readonly verbose?: boolean; readonly perFile?: number } = {},
): ShownDiagnostics {
  if (options.verbose === true) return { shown: diagnostics, heldBack: 0 };
  const perFile = options.perFile ?? 5;
  const counts = new Map<string, number>();
  const shown: ProjectDiagnostic[] = [];
  for (const d of diagnostics) {
    if (d.followOn) continue;
    const n = counts.get(d.file) ?? 0;
    counts.set(d.file, n + 1);
    if (n < perFile) shown.push(d);
  }
  return { shown, heldBack: diagnostics.length - shown.length };
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
