/**
 * Compiling a game's passage files and TypeScript modules as one program
 * (ADR 0005): parse each `.weft` file, generate its module, and type-check
 * everything together, mapping errors in generated code back to passage lines.
 */
import path from "node:path";
import ts from "typescript";
import { coreDirectives, type DirectiveSpec } from "../passages/directives.js";
import { parsePassageFile } from "../passages/parse.js";
import { locator } from "../passages/positions.js";
import type { Span } from "../passages/syntax.js";
import { CONTEXT_NAMES, generatePassageModule, type GeneratedModule } from "./generate.js";
import { checkLinks, closestName, codeIn, stringLiterals, type FilePassage } from "./links.js";
import { authorMessage, missingName, undefinedNameMessage, type NameHelp } from "./messages.js";
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
  /** Directives to recognize. Defaults to the core ones. */
  readonly directives?: readonly DirectiveSpec[];
  /**
   * The passage the game starts in. With it, passages that nothing leads to
   * are reported as warnings; without it, they aren't checked.
   */
  readonly start?: string;
};

/** A problem in a game's sources, positioned for the author. */
export type ProjectDiagnostic = {
  /** Errors stop the game from building; warnings point at likely mistakes. */
  readonly severity: "error" | "warning";
  /** Which stage found it. */
  readonly source: "parser" | "compiler" | "typescript";
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

/**
 * Parses, generates, and type-checks a game's sources.
 *
 * @remarks
 * Each passage file `scenes/cellar.weft` becomes a virtual module
 * `scenes/cellar.weft.ts` exporting `passages`. Errors in inline code are
 * reported at the passage file's lines.
 */
export function compileProject(options: ProjectOptions): CompiledProject {
  const root = path.resolve(options.root);
  const resolve = (p: string): string => path.resolve(root, p);
  const memory = new Map<string, string>();
  for (const f of options.files) memory.set(resolve(f.path), f.text);
  const compilerOptions = { ...DEFAULT_OPTIONS, ...options.compilerOptions, noEmit: true };
  const diagnostics: ProjectDiagnostic[] = [];

  const weft = [...memory.keys()].filter((p) => p.endsWith(PASSAGE_EXTENSION)).sort();
  const tsFiles = [...memory.keys()].filter((p) => /\.(m|c)?tsx?$/.test(p)).sort();
  const scopePath = resolve(options.scope ?? "story.ts");
  const namesPath = resolve("$passages.ts");

  const host = ts.createCompilerHost(compilerOptions);
  const virtual = new Map<string, string>();
  const read = (p: string): string | undefined => virtual.get(p) ?? memory.get(p);
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
  host.getSourceFile = (p, language, onError, create) => {
    const text = read(path.resolve(p));
    return text !== undefined
      ? ts.createSourceFile(p, text, language, true)
      : getSourceFile(p, language, onError, create);
  };

  // 1. What the scope module exports.
  const scopeExists = host.fileExists(scopePath);
  const scopeExports = new Set<string>();
  const reserved: { name: string; at: number }[] = [];
  let program: ts.Program | undefined;
  if (scopeExists) {
    program = ts.createProgram({
      rootNames: [...new Set([...tsFiles, scopePath])],
      options: compilerOptions,
      host,
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

  // 2. Parse and generate each passage file.
  const modules = new Map<string, GeneratedModule>();
  const names = new Set<string>();
  const sources = new Map<string, string>();
  const allPassages: FilePassage[] = [];
  // Strings in code may name passages, as in goTo("Attic"); those count as reachable.
  const named = new Set<string>();
  for (const f of tsFiles) for (const lit of stringLiterals(memory.get(f) ?? "")) named.add(lit);
  for (const file of weft) {
    const text = memory.get(file) ?? "";
    sources.set(file, text);
    const parsed = parsePassageFile(text, {
      file,
      directives: options.directives ?? coreDirectives,
    });
    for (const d of parsed.diagnostics) diagnostics.push({ source: "parser", file, ...d });
    for (const p of parsed.passages) {
      if (p.name.name === "") continue;
      names.add(p.name.name);
      allPassages.push({ file, passage: p });
      for (const c of codeIn(p.content)) for (const lit of stringLiterals(c.code)) named.add(lit);
    }
    const modulePath = `${file}.ts`;
    const generated = generatePassageModule(parsed, text, {
      modulePath,
      scopeExports,
      passageNamesSpecifier: specifier(modulePath, namesPath),
      ...(scopeExists && { scopeSpecifier: specifier(modulePath, scopePath) }),
    });
    for (const d of generated.diagnostics) diagnostics.push({ source: "compiler", file, ...d });
    modules.set(file, generated);
    virtual.set(modulePath, generated.code);
  }
  if (options.start !== undefined && !names.has(options.start)) {
    throw new Error(
      `start: there's no passage named ${JSON.stringify(options.start)}. Pass the name of the passage the game starts in.`,
    );
  }
  for (const problem of checkLinks(allPassages, named, options.start)) {
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

  const namesCode = [
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
  virtual.set(namesPath, namesCode);

  // 3. Type-check everything as one program.
  program = ts.createProgram({
    rootNames: [...new Set([...tsFiles, ...(scopeExists ? [scopePath] : []), ...virtual.keys()])],
    options: compilerOptions,
    host,
    ...(program && { oldProgram: program }),
  });
  const byModule = new Map([...modules.values()].map((m) => [m.path, m]));
  const userFiles = [...new Set([...tsFiles, ...(scopeExists ? [scopePath] : [])])];
  const display = (file: string): string => path.relative(root, file).split(path.sep).join("/");

  // What other modules export, to explain names passages can't see.
  const checker = program.getTypeChecker();
  const exportedBy = new Map<string, string>();
  for (const file of tsFiles) {
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

  for (const d of ts.getPreEmitDiagnostics(program)) {
    if (!d.file || d.start === undefined) continue;
    const fileName = path.resolve(d.file.fileName);
    const generated = byModule.get(fileName);
    const text = ts.flattenDiagnosticMessageText(d.messageText, "\n");
    const missing = generated ? missingName(text) : undefined;
    const message =
      missing !== undefined
        ? undefinedNameMessage(missing, nameHelp(missing))
        : authorMessage(text, {
            printed: generated?.code.slice(0, d.start).endsWith("$print(") ?? false,
          });
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
  return { modules, passageNames: { path: namesPath, code: namesCode }, diagnostics };
}
