/**
 * Generating a passage file's virtual TypeScript module (ADR 0005).
 *
 * The module is the compiled passage code itself: it exports `passages`, an
 * array of core `Passage`s, and the build emits it as is. Inline code is
 * copied verbatim and recorded in {@link Mapping}s, so TypeScript errors and
 * runtime stack traces lead back to the author's lines.
 */
import { identifiers } from "../passages/code-scan.js";
import { locator } from "../passages/positions.js";
import type {
  CodeSyntax,
  ContentSyntax,
  Diagnostic,
  DirectiveSyntax,
  LinkSyntax,
  PassageFileSyntax,
  PassageSyntax,
} from "../passages/syntax.js";
import { standaloneLinks } from "./links.js";
import { LINE_DIRECTIVE, passageLines, type PassageLines } from "./line-ids.js";
import { renderWriteMessage, renderWrites } from "./render-writes.js";
import { encodeSourceMap, type Mapping, type SourceMap } from "./source-map.js";

/** Names inline code gets from the passage's context, with no import. */
export const CONTEXT_NAMES: readonly string[] = ["visits", "firstVisit", "visited"];

const PHASES: Record<string, "firstVisit" | "enter" | "leave"> = {
  "on first visit": "firstVisit",
  "on enter": "enter",
  "on leave": "leave",
};

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
};

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
        for (const a of n.guard?.args ?? []) if (a.type !== "target") acc.push(a.value);
      } else if (n.type === "directive" && !(n.name in PHASES) && n.name !== LINE_DIRECTIVE) {
        for (const a of n.args) if (a.type !== "target") acc.push(a.value);
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
      } else if (n.type === "link") {
        const first = n.guard?.args[0];
        if (first?.type === "positional") acc.add(first.value);
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
          error(
            `\`${word}\` is a directive and also exported by the scope module. Write \`{(${word})}\` to print the export, or rename it.`,
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
        case "print":
          write(`${indent}${parts}.push($print(`);
          copy(n.expression);
          write("));\n");
          break;
        case "emphasis": {
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
            content(b.content, parts);
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
      }
    }
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
    let condition: CodeSyntax | undefined;
    let mode: string | undefined;
    let reason: CodeSyntax | undefined;
    for (const a of d.args) {
      if (a.type === "positional" && condition === undefined) condition = a.value;
      else if (
        a.type === "positional" &&
        (a.value.code === "hidden" || a.value.code === "disabled")
      ) {
        mode = a.value.code;
      } else if (a.type === "named" && a.key.name === "reason") reason = a.value;
      else {
        error(
          '`{when}` takes a condition, then optionally `hidden`, `disabled`, or `reason: "…"`.',
          a.span.start,
          a.span.end,
        );
      }
    }
    if (!condition) {
      error("`{when}` needs a condition, like `{when lantern.isLit}`.", d.span.start, d.span.end);
      return;
    }
    if (reason && mode !== undefined) {
      error(
        `\`reason:\` already shows the link disabled with its reason, so \`${mode}\` can't go with it.`,
        d.span.start,
        d.span.end,
      );
    }
    mark(d.span.start);
    write(", guard: { open: Boolean(");
    copy(condition);
    write(`), condition: ${str(condition.code)}`);
    if (reason) {
      write(', mode: "disabled-with-reason", reason: ');
      copy(reason);
    } else if (mode !== undefined) {
      write(`, mode: ${str(mode)}`);
    }
    write(" }");
  }

  function directive(d: DirectiveSyntax): void {
    if (d.name in PHASES) {
      error(
        `\`{${d.name}: …}\` runs when the passage is visited, not when it's shown, so it goes at the top level of the passage, not inside a block.`,
        d.span.start,
        d.span.end,
      );
      return;
    }
    if (d.name === "continue") {
      const target = d.args.find((a) => a.type === "target");
      const label = d.args.find((a) => a.type === "named" && a.key.name === "label");
      const other = d.args.find((a) => a !== target && a !== label);
      if (!target || target.type !== "target") {
        error(
          "`{continue}` needs a passage, like `{continue -> Platform}`.",
          d.span.start,
          d.span.end,
        );
        return;
      }
      if (other) {
        error(
          '`{continue}` takes `-> Passage` and optionally `label: "…"`.',
          other.span.start,
          other.span.end,
        );
      }
      mark(d.span.start);
      write(`${indent}$flush($nodes, $parts, $line);\n`);
      write(`${indent}$nodes.push({ type: "continue", target: ${str(target.target.name)}`);
      if (label?.type === "named") {
        write(", label: ");
        copy(label.value);
      }
      write(" });\n");
      lineChange("$parts", d.span.end);
      return;
    }
    // `{line}` only names the line below it; passageLines checks it.
    if (d.name === LINE_DIRECTIVE) return;
    if (d.name === "beat" || d.name === "wait") {
      error(
        `\`{${d.name}}\` isn't supported yet; it arrives with beats and cut scenes (#41).`,
        d.span.start,
        d.span.end,
      );
      return;
    }
    error(
      `\`{${d.name}}\` comes from a package that doesn't generate code yet.`,
      d.span.start,
      d.span.end,
    );
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
    checkClashes(p.content);
    standalone = standaloneLinks(p.content, source);
    lineIds = passageLines(p, source);
    for (const problem of lineIds.problems)
      error(problem.message, problem.span.start, problem.span.end);
    const effects = new Map<string, DirectiveSyntax[]>();
    const body: ContentSyntax[] = [];
    for (const n of p.content) {
      if (n.type === "directive" && n.name in PHASES) {
        const phase = PHASES[n.name] ?? "enter";
        effects.set(phase, [...(effects.get(phase) ?? []), n]);
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
    if (effects.size > 0) {
      write("    effects: {\n");
      for (const phase of ["firstVisit", "enter", "leave"]) {
        const list = effects.get(phase);
        if (!list) continue;
        const names = usedIn(list.flatMap((d) => (d.code ? [d.code] : [])));
        write(`      ${phase}: (${contextParam(names, "$EffectContext")}): void => {\n`);
        indent = "        ";
        contextLocals(names, "$context");
        for (const d of list) {
          if (!d.code) continue;
          mark(d.span.start);
          write(`${indent}{\n${indent}  `);
          copy(d.code);
          write(`\n${indent}}\n`);
        }
        write("      },\n");
      }
      write("    },\n");
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
  const preamble = [
    `// Generated from ${file.file.split(/[\\/]/).pop() ?? file.file} by @loominate-if/compiler. Do not edit.`,
    `import { ${["prose as $prose", ...values].join(", ")} } from "@loominate-if/core";`,
    `import type { ${types.join(", ")} } from "@loominate-if/core";`,
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
