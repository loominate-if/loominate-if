/**
 * Generating a passage file's virtual TypeScript module (ADR 0005).
 *
 * The module is the compiled passage code itself: it exports `passages`, an
 * array of core `Passage`s, and the build emits it as is. Inline code is
 * copied verbatim and recorded in {@link Mapping}s, so TypeScript errors and
 * runtime stack traces lead back to the author's lines.
 */
import { bindArguments, type BoundArgument } from "../extensions/arguments.js";
import type {
  CompilerExtension,
  DirectiveDefinition,
  RuntimeExport,
} from "../extensions/extension.js";
import { resolveExtensions, type From } from "../extensions/resolve.js";
import { identifiers } from "../passages/code-scan.js";
import { locator } from "../passages/positions.js";
import type {
  CodeSyntax,
  ContentSyntax,
  Diagnostic,
  DirectiveSyntax,
  LineFormSyntax,
  LinkSyntax,
  PassageFileSyntax,
  PassageSyntax,
} from "../passages/syntax.js";
import { standaloneLinks } from "./links.js";
import { passageLines, type PassageLines } from "./line-ids.js";
import { renderWriteMessage, renderWrites } from "./render-writes.js";
import { encodeSourceMap, type Mapping, type SourceMap } from "./source-map.js";

/** Names inline code gets from the passage's context, with no import. */
export const CONTEXT_NAMES: readonly string[] = ["visits", "firstVisit", "visited"];

/** What the generator needs to know about the rest of the project. */
export type GenerateOptions = {
  /** The generated module's path, for its source map. */
  readonly modulePath: string;
  /** Names the scope module exports. */
  readonly scopeExports: ReadonlySet<string>;
  /** Import specifier for the scope module, from the generated module. Omit if there's none. */
  readonly scopeSpecifier?: string;
  /** Import specifier for the generated passage-names module. */
  readonly passageNamesSpecifier: string;
  /**
   * Packages' compiler extensions, in load order. Core's is always loaded
   * first. Give the same list the file was parsed with.
   */
  readonly extensions?: readonly CompilerExtension[];
};

/** A directive matched to its definition, with its arguments read. */
type Bound = {
  readonly from: string;
  readonly definition: DirectiveDefinition;
  readonly args: readonly BoundArgument[];
  /** False if an argument was wrong, so no call is generated. */
  readonly ok: boolean;
};

const listOf = (items: readonly string[]): string =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} or ${items.at(-1) ?? ""}`;

/** A passage file's generated module. */
export type GeneratedModule = {
  /** The passage file it came from. */
  readonly file: string;
  /** The generated module's path. */
  readonly path: string;
  /** The TypeScript code. */
  readonly code: string;
  /** How generated offsets map to the passage file, sorted by generated offset. */
  readonly mappings: readonly Mapping[];
  /** Constructs the generator can't compile, positioned in the passage file. */
  readonly diagnostics: readonly Diagnostic[];
  /** The source map for `code`. */
  sourceMap(): SourceMap;
};

/** Generates the TypeScript module for a parsed passage file. */
export function generatePassageModule(
  file: PassageFileSyntax,
  source: string,
  options: GenerateOptions,
): GeneratedModule {
  const syntax = resolveExtensions(options.extensions ?? []);
  const lines = locator(source);
  const diagnostics: Diagnostic[] = [];
  const mappings: Mapping[] = [];
  let out = "";

  const error = (message: string, start: number, end: number): void => {
    diagnostics.push(lines.error(message, start, end));
  };
  const write = (text: string): void => {
    out += text;
  };
  const mark = (sourceOffset: number): void => {
    mappings.push({ generated: out.length, source: sourceOffset, length: 0 });
  };
  const copy = (code: CodeSyntax): void => {
    mappings.push({ generated: out.length, source: code.span.start, length: code.code.length });
    out += code.code;
  };
  const str = (text: string): string => JSON.stringify(text);

  // ---- Directives and their definitions ----------------------------------

  /** How deep in blocks (`{if}`, emphasis) the content being generated is. */
  let nested = 0;

  /** The tag roles of the passage being generated. */
  let roles: ReadonlySet<string> = new Set();
  const bindings = new Map<DirectiveSyntax, Bound | undefined>();

  /** Matches a directive to its definition and reads its arguments, reporting problems once. */
  function bind(d: DirectiveSyntax): Bound | undefined {
    if (bindings.has(d)) return bindings.get(d);
    const found: From<DirectiveDefinition> | { readonly error: string } = syntax.directive(
      d.name,
      roles,
    );
    let bound: Bound | undefined;
    if ("error" in found) {
      error(found.error, d.span.start, d.span.end);
    } else if (found.definition.kind === "effect") {
      bound = { from: found.from, definition: found.definition, args: [], ok: true };
    } else {
      const def = found.definition;
      const { args, problems } = bindArguments(d, def.args ?? [], def.example);
      for (const p of problems) error(p.message, p.span.start, p.span.end);
      bound = { from: found.from, definition: def, args, ok: problems.length === 0 };
    }
    bindings.set(d, bound);
    return bound;
  }

  /** The phase an effect directive runs in, or undefined for other directives. */
  const phaseOf = (d: DirectiveSyntax): "firstVisit" | "enter" | "leave" | undefined => {
    if (d.code === undefined) return undefined;
    const def = bind(d)?.definition;
    return def?.kind === "effect" ? def.phase : undefined;
  };

  /** Code in a directive's arguments: its expressions and conditions. */
  const argumentCode = (d: DirectiveSyntax, kinds = ["expression", "condition"]): CodeSyntax[] =>
    (bind(d)?.args ?? []).flatMap((a) =>
      (a.kind === "expression" || a.kind === "condition") && kinds.includes(a.kind) ? [a.code] : [],
    );

  /** Runtime exports generated code calls, by module and export, with their local names. */
  const runtimes = new Map<string, { readonly runtime: RuntimeExport; readonly local: string }>();
  const localNames = new Set<string>();
  function runtimeName(runtime: RuntimeExport): string {
    const key = `${runtime.module}\u0000${runtime.export}`;
    const known = runtimes.get(key);
    if (known) return known.local;
    let local = `$rt_${runtime.export.replace(/[^\w$]/g, "_")}`;
    for (let n = 2; localNames.has(local); n++) local = `$rt_${runtime.export}${String(n)}`;
    localNames.add(local);
    runtimes.set(key, { runtime, local });
    return local;
  }

  /** Writes a call of `runtime` with the arguments as one object. */
  function call(runtime: RuntimeExport, args: readonly BoundArgument[]): void {
    write(`${runtimeName(runtime)}({`);
    for (const [i, a] of args.entries()) {
      write(`${i === 0 ? " " : ", "}${a.spec.name}: `);
      switch (a.kind) {
        case "expression":
          copy(a.code);
          break;
        case "condition":
          write("{ value: Boolean(");
          copy(a.code);
          write(`), text: ${str(a.code.code)} }`);
          break;
        case "duration":
          write(String(a.ms));
          break;
        case "passage":
          mark(a.target.span.start);
          write(str(a.target.name));
          break;
        case "words":
          write(`[${a.words.map(str).join(", ")}]`);
          break;
        case "choice":
          write(str(a.word));
          break;
      }
    }
    write(args.length > 0 ? " })" : "})");
  }

  /**
   * A printed expression that starts with the name of a directive from a
   * package this game doesn't load: say which package, not just that the name is undefined.
   */
  function missingDirective(code: string): string | undefined {
    const word = /^([a-z][a-z0-9-]*)(?=$|[\s,:])/.exec(code)?.[1];
    if (word === undefined || options.scopeExports.has(word) || CONTEXT_NAMES.includes(word)) {
      return undefined;
    }
    const packages = syntax.missing("directive", word);
    if (packages.length === 0) return undefined;
    return `\`{${word}}\` comes from ${listOf(packages)}, which this game doesn't load. Install it and add it to the game's extensions.`;
  }

  // ---- Which names each function needs -----------------------------------

  const used = new Set<string>();
  const usedIn = (codes: readonly CodeSyntax[]): Set<string> => {
    const names = new Set<string>();
    for (const c of codes) for (const n of identifiers(c.code)) names.add(n);
    for (const n of names) used.add(n);
    return names;
  };

  function bodyCode(nodes: readonly ContentSyntax[], acc: CodeSyntax[] = []): CodeSyntax[] {
    for (const n of nodes) {
      if (n.type === "print") acc.push(n.expression);
      else if (n.type === "emphasis") bodyCode(n.content, acc);
      else if (n.type === "if") {
        for (const b of n.branches) {
          if (b.condition) acc.push(b.condition);
          bodyCode(b.content, acc);
        }
      } else if (n.type === "link") {
        bodyCode(n.label, acc);
        if (n.guard) acc.push(...argumentCode(n.guard));
      } else if (n.type === "directive" && n.code === undefined) {
        acc.push(...argumentCode(n));
      }
    }
    return acc;
  }

  // ---- Checks before generating ------------------------------------------

  /** Conditions in `{if}` and `{when}`, where `=` is likely a mistyped `===`. */
  function conditions(
    nodes: readonly ContentSyntax[],
    acc = new Set<CodeSyntax>(),
  ): Set<CodeSyntax> {
    for (const n of nodes) {
      if (n.type === "emphasis") conditions(n.content, acc);
      else if (n.type === "if") {
        for (const b of n.branches) {
          if (b.condition) acc.add(b.condition);
          conditions(b.content, acc);
        }
      } else if (n.type === "link" && n.guard) {
        for (const c of argumentCode(n.guard, ["condition"])) acc.add(c);
      }
    }
    return acc;
  }

  /** Rendering is pure (#222): report state changes in rendering code. */
  function checkRenderWrites(body: readonly ContentSyntax[]): void {
    const conds = conditions(body);
    for (const code of bodyCode(body)) {
      for (const w of renderWrites(code.code)) {
        error(
          renderWriteMessage(w, conds.has(code)),
          code.span.start + w.start,
          code.span.start + w.end,
        );
      }
    }
  }

  function checkClashes(nodes: readonly ContentSyntax[]): void {
    for (const n of nodes) {
      if (n.type === "directive") {
        const word = n.name.split(" ")[0] ?? "";
        if (options.scopeExports.has(word)) {
          const from = [...new Set((syntax.directives.get(n.name) ?? []).map((d) => d.from))];
          error(
            `\`${word}\` is a directive from ${listOf(from)} and also exported by the scope module. Write \`{(${word})}\` to print the export, or rename it.`,
            n.span.start,
            n.span.end,
          );
        }
      }
      if (n.type === "emphasis") checkClashes(n.content);
      if (n.type === "if") for (const b of n.branches) checkClashes(b.content);
      if (n.type === "link" && n.guard) checkClashes([n.guard]);
    }
  }

  // ---- Bodies -------------------------------------------------------------

  /** Links on lines of their own, which stand between paragraphs; others are inline. */
  let standalone: ReadonlySet<LinkSyntax> = new Set();
  let lineIds: PassageLines | undefined;
  let indent = "";

  /**
   * Where the source paragraph can change, sets the line the rendered
   * paragraph takes: the first source paragraph that adds text to it.
   */
  function lineChange(parts: string, offset: number): void {
    // Emphasis can't span paragraphs, so the line only changes at the top level.
    if (parts !== "$parts" || !lineIds) return;
    // No text can come before the next change, so a paragraph with no prose needs none.
    const id = lineIds.lineAt(offset);
    if (id !== undefined) write(`${indent}$line = $at($parts, $line, ${str(id)});\n`);
  }

  function content(nodes: readonly ContentSyntax[], parts: string): void {
    for (const n of nodes) {
      switch (n.type) {
        case "text":
          mark(n.span.start);
          write(`${indent}${parts}.push(${str(n.text)});\n`);
          break;
        case "print": {
          const missing = missingDirective(n.expression.code);
          if (missing !== undefined) {
            error(missing, n.span.start, n.span.end);
            break;
          }
          write(`${indent}${parts}.push($print(`);
          copy(n.expression);
          write("));\n");
          break;
        }
        case "emphasis": {
          nested++;
          const inner = `$parts${String(indent.length)}`;
          mark(n.span.start);
          write(`${indent}{\n`);
          const outer = indent;
          indent += "  ";
          write(`${indent}const ${inner}: $ProsePart[] = [];\n`);
          content(n.content, inner);
          write(`${indent}${parts}.push(${n.strong ? "$strong" : "$emphasis"}(...${inner}));\n`);
          indent = outer;
          write(`${indent}}\n`);
          nested--;
          break;
        }
        case "break":
          write(`${indent}$flush($nodes, $parts, $line);\n`);
          lineChange(parts, n.span.end);
          break;
        case "if":
          for (const [i, b] of n.branches.entries()) {
            mark(b.span.start);
            if (b.condition) {
              write(i === 0 ? `${indent}if (` : `${indent}else if (`);
              copy(b.condition);
              write(") {\n");
            } else {
              write(`${indent}else {\n`);
            }
            const outer = indent;
            indent += "  ";
            lineChange(parts, b.span.start);
            nested++;
            content(b.content, parts);
            nested--;
            indent = outer;
            write(`${indent}}\n`);
          }
          lineChange(parts, n.span.end);
          break;
        case "link":
          link(n, parts);
          break;
        case "directive":
          directive(n);
          break;
        case "lineForm":
          lineForm(n);
          break;
      }
    }
  }

  function lineForm(n: LineFormSyntax): void {
    const form = syntax.lineForms.get(n.prefix);
    if (!form) return;
    const def = form.definition;
    const match = def.pattern.exec(n.text);
    if (!match || match.index !== 0 || match[0].length !== n.text.length) {
      const like = def.example === undefined ? "" : ` Write it like \`${def.example}\`.`;
      error(
        `This line starts with \`${n.prefix}\`, so it's a ${def.name} line (from ${form.from}), but the rest doesn't fit that form.${like} Write \`\\${n.prefix}\` for a literal \`${n.prefix}\`.`,
        n.span.start,
        n.span.end,
      );
      return;
    }
    const groups = Object.entries(match.groups ?? {}).filter(
      (g): g is [string, string] => g[1] !== undefined,
    );
    mark(n.span.start);
    write(`${indent}$flush($nodes, $parts, $line);\n`);
    write(`${indent}$nodes.push(...[${runtimeName(def.runtime)}({`);
    write(groups.map(([k, v]) => ` ${JSON.stringify(k)}: ${str(v)}`).join(","));
    write(groups.length > 0 ? " })].flat());\n" : "})].flat());\n");
    lineChange("$parts", n.span.end);
  }

  function link(n: LinkSyntax, parts: string): void {
    if (n.label.some((l) => l.type === "emphasis")) {
      error(
        "Formatting in link labels isn't supported yet. Remove the `*` from this label.",
        n.span.start,
        n.span.end,
      );
      return;
    }
    const inline = !standalone.has(n);
    mark(n.span.start);
    if (inline) {
      // The label reads as part of the sentence, and of its line (ADR 0007).
      write(`${indent}${parts}.push({ type: "link", label: `);
    } else {
      write(`${indent}$flush($nodes, $parts, $line);\n`);
      write(`${indent}$nodes.push({ type: "link", label: `);
    }
    if (n.label.every((l) => l.type === "text")) {
      write(str(n.label.map((l) => (l.type === "text" ? l.text : "")).join("")));
    } else {
      write("[");
      for (const [i, l] of n.label.entries()) {
        if (i > 0) write(", ");
        if (l.type === "text") write(str(l.text));
        else if (l.type === "print") {
          write("$print(");
          copy(l.expression);
          write(")");
        }
      }
      write('].join("")');
    }
    write(`, target: ${str(n.target.name)}`);
    const id = lineIds?.links.get(n);
    if (id !== undefined) write(`, line: ${str(id)}`);
    if (n.guard) guard(n.guard);
    write(" });\n");
    if (!inline) lineChange(parts, n.guard?.span.end ?? n.span.end);
  }

  function guard(d: DirectiveSyntax): void {
    const b = bind(d);
    if (!b?.ok) return;
    const def = b.definition;
    if (def.kind !== "guard") return;
    if (!def.runtime) {
      error(
        `\`{${d.name}}\` isn't supported yet; ${def.unsupported ?? ""}.`,
        d.span.start,
        d.span.end,
      );
      return;
    }
    mark(d.span.start);
    write(", guard: ");
    call(def.runtime, b.args);
  }

  function directive(d: DirectiveSyntax): void {
    const b = bind(d);
    if (!b) return;
    const def = b.definition;
    if (def.kind === "content" && def.beat === true && nested > 0) {
      error(
        `\`{${d.name}}\` divides the passage into parts the player reaches in turn, so it goes at the top level of the passage, not inside a block.`,
        d.span.start,
        d.span.end,
      );
      return;
    }
    switch (def.kind) {
      case "effect":
        error(
          `\`{${d.name}: …}\` runs when the passage is visited, not when it's shown, so it goes at the top level of the passage, not inside a block.`,
          d.span.start,
          d.span.end,
        );
        return;
      // An annotation generates no code, and a guard away from a link was reported by the parser.
      case "annotation":
      case "guard":
        return;
      case "content":
        if (!def.runtime) {
          error(
            `\`{${d.name}}\` isn't supported yet; ${def.unsupported ?? ""}.`,
            d.span.start,
            d.span.end,
          );
          return;
        }
        if (!b.ok) return;
        mark(d.span.start);
        write(`${indent}$flush($nodes, $parts, $line);\n`);
        write(`${indent}$nodes.push(...[`);
        call(def.runtime, b.args);
        write("].flat());\n");
        lineChange("$parts", d.span.end);
        return;
    }
  }

  /** Destructures the context names `names` uses. */
  /**
   * The context parameter, only when the code uses a context name, so authors
   * who enable `noUnusedParameters` get no errors in generated code (#213).
   */
  function contextParam(names: ReadonlySet<string>, type: string): string {
    return CONTEXT_NAMES.some((n) => names.has(n)) ? `$context: ${type}` : "";
  }

  function contextLocals(names: ReadonlySet<string>, ctx: string): void {
    const plain = ["visits", "firstVisit"].filter((n) => names.has(n));
    if (plain.length > 0) write(`${indent}const { ${plain.join(", ")} } = ${ctx};\n`);
    if (names.has("visited")) {
      write(`${indent}const visited: (passage: $PassageName) => boolean = ${ctx}.visited;\n`);
    }
  }

  function passage(p: PassageSyntax): void {
    roles = new Set(p.tags.filter((t) => t.value !== undefined).map((t) => t.name));
    for (const t of p.tags) {
      if (t.value === undefined || syntax.tagRoles.has(t.name)) continue;
      const packages = syntax.missing("tagRole", t.name);
      if (packages.length > 0) {
        error(
          `The tag role \`${t.name}:\` comes from ${listOf(packages)}, which this game doesn't load. Install it and add it to the game's extensions.`,
          t.span.start,
          t.span.end,
        );
      } else {
        // The game's own code may read its own roles, so this is only a warning.
        diagnostics.push({
          ...lines.error(
            `No loaded package uses the tag role \`${t.name}:\`. If it's a typo, fix it; if the game's own code reads it, this is fine.`,
            t.span.start,
            t.span.end,
          ),
          severity: "warning",
        });
      }
    }
    checkClashes(p.content);
    standalone = standaloneLinks(p.content, source);
    lineIds = passageLines(p, source, syntax.paragraphEnds);
    for (const problem of lineIds.problems)
      error(problem.message, problem.span.start, problem.span.end);
    // Beats divide the passage into parts; effect phases belong to the part they're written in.
    const parts: Map<string, DirectiveSyntax[]>[] = [new Map()];
    const body: ContentSyntax[] = [];
    for (const n of p.content) {
      const phase = n.type === "directive" ? phaseOf(n) : undefined;
      // Looked up without bind(), so problems are still reported in source order.
      const found =
        n.type === "directive" && n.code === undefined
          ? syntax.directive(n.name, roles)
          : undefined;
      const def = found && "definition" in found ? found.definition : undefined;
      if (def?.kind === "content" && def.beat === true) parts.push(new Map());
      const effects = parts.at(-1) as Map<string, DirectiveSyntax[]>;
      if (n.type === "directive" && phase === "leave" && parts.length > 1) {
        error(
          "`{on leave: …}` runs when the player leaves the passage, not when they reach a part of it, so it goes before the passage's first beat.",
          n.span.start,
          n.span.end,
        );
      } else if (n.type === "directive" && phase !== undefined) {
        effects.set(phase, [...(effects.get(phase) ?? []), n]);
      } else if (n.type === "directive" && n.code !== undefined) {
        // An effect directive that doesn't apply here was reported by bind().
      } else {
        body.push(n);
      }
    }

    mark(p.header.start);
    write("  {\n");
    write(`    id: ${str(p.name.name)},\n`);
    write(
      `    tags: [${p.tags.map((t) => str(t.value === undefined ? t.name : `${t.name}: ${t.value}`)).join(", ")}],\n`,
    );
    /** Writes one part's effect phases as an object's properties, at `at` indentation. */
    const phases = (effects: Map<string, DirectiveSyntax[]>, at: string): void => {
      for (const phase of ["firstVisit", "enter", "leave"]) {
        const list = effects.get(phase);
        if (!list) continue;
        const names = usedIn(list.flatMap((d) => (d.code ? [d.code] : [])));
        write(`${at}${phase}: (${contextParam(names, "$EffectContext")}): void => {\n`);
        indent = `${at}  `;
        contextLocals(names, "$context");
        for (const d of list) {
          if (!d.code) continue;
          mark(d.span.start);
          write(`${indent}{\n${indent}  `);
          copy(d.code);
          write(`\n${indent}}\n`);
        }
        write(`${at}},\n`);
      }
    };
    const [effects, ...later] = parts as [
      Map<string, DirectiveSyntax[]>,
      ...Map<string, DirectiveSyntax[]>[],
    ];
    if (effects.size > 0) {
      write("    effects: {\n");
      phases(effects, "      ");
      write("    },\n");
    }
    if (later.some((m) => m.size > 0)) {
      write("    beats: [\n");
      for (const m of later) {
        write("      {\n");
        phases(m, "        ");
        write("      },\n");
      }
      write("    ],\n");
    }
    checkRenderWrites(body);
    const names = usedIn(bodyCode(body));
    write(`    body: (${contextParam(names, "$RenderContext")}): $PassageNode[] => {\n`);
    indent = "      ";
    contextLocals(names, "$context");
    write(`${indent}const $nodes: $PassageNode[] = [];\n`);
    write(`${indent}const $parts: $ProsePart[] = [];\n`);
    const first = lineIds.lineAt(p.header.end);
    write(
      `${indent}let $line: string | undefined = ${first === undefined ? "undefined" : str(first)};\n`,
    );
    content(body, "$parts");
    write(`${indent}$flush($nodes, $parts, $line);\n`);
    write(`${indent}return $nodes;\n`);
    write("    },\n");
    write("  },\n");
  }

  // ---- Module -------------------------------------------------------------

  for (const p of file.passages) passage(p);
  const passagesCode = out;

  // Written after the passages, so the imports list only what they use.
  const has = (name: string): boolean => passagesCode.includes(name);
  const scopeImports = [...used]
    .filter((n) => options.scopeExports.has(n) && !CONTEXT_NAMES.includes(n))
    .sort();
  const values = ["$emphasis", "$strong"].filter(has).map((n) => `${n.slice(1)} as ${n}`);
  const types = ["$EffectContext", "$Passage", "$PassageNode", "$ProsePart", "$RenderContext"]
    .filter((n) => n === "$Passage" || has(n))
    .map((n) => `${n.slice(1)} as ${n}`);
  // Runtime exports that directives and line forms call, one import per module.
  const byModule = new Map<string, string[]>();
  for (const { runtime, local } of runtimes.values()) {
    byModule.set(runtime.module, [
      ...(byModule.get(runtime.module) ?? []),
      `${runtime.export} as ${local}`,
    ]);
  }
  const runtimeImports = [...byModule]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([module, names]) => `import { ${names.join(", ")} } from ${str(module)};`);
  const preamble = [
    `// Generated from ${file.file.split(/[\\/]/).pop() ?? file.file} by @loominate-if/compiler. Do not edit.`,
    `import { ${["prose as $prose", ...values].join(", ")} } from "@loominate-if/core";`,
    `import type { ${types.join(", ")} } from "@loominate-if/core";`,
    ...runtimeImports,
    ...(has("$PassageName")
      ? [`import type { PassageName as $PassageName } from ${str(options.passageNamesSpecifier)};`]
      : []),
    ...(scopeImports.length > 0 && options.scopeSpecifier !== undefined
      ? [`import { ${scopeImports.join(", ")} } from ${str(options.scopeSpecifier)};`]
      : []),
    "",
    ...(has("$print(")
      ? [
          "/** Printed values must be text or numbers (ADR 0004). */",
          "const $print = (value: string | number): string | number => value;",
          "",
        ]
      : []),
    ...(has("$at(")
      ? [
          "/** The line a paragraph takes: the first source paragraph that adds text to it (ADR 0007). */",
          "function $at(parts: $ProsePart[], line: string | undefined, next: string): string | undefined {",
          '  return parts.every((p) => typeof p === "string" && p.trim() === "") ? next : line;',
          "}",
          "",
        ]
      : []),
    "/** Ends the paragraph being built, if it has any text. */",
    "function $flush(nodes: $PassageNode[], parts: $ProsePart[], line: string | undefined): void {",
    '  while (typeof parts[0] === "string" && parts[0].trim() === "") parts.shift();',
    '  while (typeof parts.at(-1) === "string" && String(parts.at(-1)).trim() === "") parts.pop();',
    "  const first = parts[0];",
    '  if (typeof first === "string") parts[0] = first.trimStart();',
    "  const last = parts.at(-1);",
    '  if (typeof last === "string") parts[parts.length - 1] = last.trimEnd();',
    "  if (parts.length > 0) nodes.push($prose(parts.splice(0), line === undefined ? {} : { line }));",
    "}",
    "",
    "/** The passages in this file. */",
    "export const passages: readonly $Passage[] = [",
    "",
  ].join("\n");
  const code = `${preamble}${passagesCode}];\n`;
  const shifted = mappings.map((m) => ({ ...m, generated: m.generated + preamble.length }));

  return {
    file: file.file,
    path: options.modulePath,
    code,
    mappings: shifted,
    diagnostics,
    sourceMap: () => encodeSourceMap(shifted, code, options.modulePath, file.file, source),
  };
}
