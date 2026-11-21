/**
 * Checking a game's compiler extensions and combining them, in load order,
 * into the syntax the parser and generator use (ADR 0015).
 */
import type { DirectiveSpec, LineFormSpec } from "../passages/directives.js";
import { knownPackages, type SyntaxKind } from "./catalog.js";
import { coreExtension } from "./core.js";
import type {
  ArgumentSpec,
  CompilerExtension,
  DirectiveDefinition,
  ExtensionCheck,
  LineFormDefinition,
  RuntimeExport,
  TagRoleDefinition,
} from "./extension.js";

/** A registration and the package it came from. */
export type From<T> = { readonly definition: T; readonly from: string };

/** The syntax a game's extensions add up to. */
export type ResolvedSyntax = {
  /** What the parser needs to know about each directive name. */
  readonly parserDirectives: readonly DirectiveSpec[];
  /** What the parser needs to know about each line form. */
  readonly parserLineForms: readonly LineFormSpec[];
  /** Every definition of each directive name; more than one only in separate roles. */
  readonly directives: ReadonlyMap<string, readonly From<DirectiveDefinition>[]>;
  /** Line forms by prefix. */
  readonly lineForms: ReadonlyMap<string, From<LineFormDefinition>>;
  /** Tag roles by name. */
  readonly tagRoles: ReadonlyMap<string, From<TagRoleDefinition>>;
  /** Checks, in load order. */
  readonly checks: readonly From<ExtensionCheck>[];
  /** Names of `content` directives and line forms, which end a paragraph. */
  readonly paragraphEnds: ReadonlySet<string>;
  /** The packages that provide a directive, tag role, or line form this game doesn't load. */
  missing(kind: SyntaxKind, name: string): readonly string[];
  /**
   * The definition of directive `name` that applies in a passage with
   * `roles`, or why none does.
   */
  directive(
    name: string,
    roles: ReadonlySet<string>,
  ): From<DirectiveDefinition> | { readonly error: string };
};

const NAME = /^[a-z][a-z0-9-]*( [a-z][a-z0-9-]*)*$/;
const ROLE = /^[a-z][a-z0-9-]*$/;
const KEY = /^[A-Za-z_$][\w$]*$/;
const GRAMMAR = new Set(["if", "else", "else if"]);
/** Characters with a meaning at the start of a line already, or in prose. */
const TAKEN_PREFIXES = new Set(["{", "}", "[", "]", ":", "/", "*", "\\"]);

const fail = (message: string): never => {
  throw new Error(message);
};

/**
 * Whether two definitions of a name apply to the same passages. One limited
 * to roles is more specific than one that isn't, so it wins in its roles and
 * the other applies elsewhere (ADR 0004: `{show}` topics in `actor:` passages,
 * the VN kit's `{show}` everywhere else).
 */
const overlap = (a: readonly string[] | undefined, b: readonly string[] | undefined): boolean =>
  a === undefined || b === undefined ? a === b : a.some((r) => b.includes(r));

const rolesText = (roles: readonly string[]): string => roles.map((r) => `\`${r}:\``).join(" or ");

function checkArguments(where: string, args: readonly ArgumentSpec[]): void {
  const names = new Set<string>();
  let optional = false;
  let passages = 0;
  for (const a of args) {
    if (!KEY.test(a.name)) fail(`${where}: argument "${a.name}" needs an identifier for a name.`);
    if (names.has(a.name)) fail(`${where}: there are two arguments named "${a.name}".`);
    names.add(a.name);
    if (a.kind === "choice" && (a.choices ?? []).length === 0) {
      fail(`${where}: the choice argument "${a.name}" needs the words it accepts, in \`choices\`.`);
    }
    if (a.kind === "passage") passages++;
    if (a.kind !== "passage" && a.named !== true) {
      if (a.required === true && optional) {
        fail(
          `${where}: the required argument "${a.name}" comes after an optional one; put required positional arguments first.`,
        );
      }
      if (a.required !== true) optional = true;
    }
  }
  if (passages > 1) fail(`${where}: a directive takes at most one passage argument.`);
  for (const a of args) {
    for (const x of a.excludes ?? []) {
      if (!names.has(x))
        fail(`${where}: argument "${a.name}" excludes "${x}", which isn't an argument.`);
    }
  }
}

function checkDirective(from: string, d: DirectiveDefinition): void {
  const where = `${from}: directive "${d.name}"`;
  if (!NAME.test(d.name)) fail(`${where}: names are lowercase words separated by single spaces.`);
  if (GRAMMAR.has(d.name)) fail(`${where}: that name is part of the passage grammar.`);
  if (d.roles?.length === 0)
    fail(`${where}: \`roles\` is empty; leave it out to allow it everywhere.`);
  if (d.kind !== "effect") checkArguments(where, d.args ?? []);
  if (d.kind === "guard" && d.beat === true) {
    fail(`${where}: only a content directive can be a beat.`);
  }
  if ((d.kind === "content" || d.kind === "guard") && !d.runtime && d.unsupported === undefined) {
    fail(`${where}: give it a \`runtime\` export to call, or say why it's \`unsupported\`.`);
  }
  // Checked here too, since a package written in JavaScript isn't type-checked.
  if (d.kind === "arrival" && (d.runtime as RuntimeExport | undefined) === undefined) {
    fail(`${where}: an arrival directive needs a \`runtime\` export to call.`);
  }
}

/**
 * Combines extensions in load order, after core's.
 * @throws Error if a definition is malformed, or two packages register the
 * same name for the same passages: meaning must never depend on load order.
 */
export function resolveExtensions(extensions: readonly CompilerExtension[]): ResolvedSyntax {
  const all = [coreExtension, ...extensions.filter((e) => e !== coreExtension)];
  const loaded = new Set<string>();
  const directives = new Map<string, From<DirectiveDefinition>[]>();
  const lineForms = new Map<string, From<LineFormDefinition>>();
  const tagRoles = new Map<string, From<TagRoleDefinition>>();
  const checks: From<ExtensionCheck>[] = [];

  for (const ext of all) {
    if (ext.name.trim() === "") fail("A compiler extension needs a `name`: its package's name.");
    if (loaded.has(ext.name)) fail(`The compiler extension ${ext.name} is loaded twice.`);
    loaded.add(ext.name);
    const from = ext.name;
    for (const d of ext.directives ?? []) {
      checkDirective(from, d);
      const existing = directives.get(d.name) ?? [];
      for (const other of existing) {
        const o = other.definition;
        const sameShape =
          (o.kind === "effect") === (d.kind === "effect") &&
          (o.kind === "guard") === (d.kind === "guard");
        if (other.from === from) fail(`${from}: directive "${d.name}" is registered twice.`);
        if (!sameShape) {
          fail(
            `\`{${d.name}}\` is registered by ${other.from} and ${from} in different forms. A name must be written the same way wherever it's used; one package needs to rename it.`,
          );
        }
        if (overlap(o.roles, d.roles)) {
          fail(
            `\`{${d.name}}\` is registered by both ${other.from} and ${from} for the same passages, so its meaning would depend on load order. Limit one to other tag roles, or rename it.`,
          );
        }
      }
      directives.set(d.name, [...existing, { definition: d, from }]);
    }
    for (const r of ext.tagRoles ?? []) {
      if (!ROLE.test(r.name)) fail(`${from}: tag role "${r.name}" needs a lowercase name.`);
      const other = tagRoles.get(r.name);
      if (other)
        fail(`The tag role \`${r.name}:\` is registered by both ${other.from} and ${from}.`);
      tagRoles.set(r.name, { definition: r, from });
    }
    for (const f of ext.lineForms ?? []) {
      const where = `${from}: line form "${f.name}"`;
      if (!/^[!-/:-@[-`{-~]$/.test(f.prefix) || TAKEN_PREFIXES.has(f.prefix)) {
        fail(
          `${where}: the prefix must be one ASCII punctuation character not already used by passage syntax, such as \`@\`.`,
        );
      }
      const other = lineForms.get(f.prefix);
      if (other) {
        fail(
          `Lines starting with \`${f.prefix}\` are registered by both ${other.from} and ${from}.`,
        );
      }
      lineForms.set(f.prefix, { definition: f, from });
    }
    for (const c of ext.checks ?? []) checks.push({ definition: c, from });
  }

  for (const [name, defs] of directives) {
    for (const { definition, from } of defs) {
      for (const role of definition.roles ?? []) {
        if (!tagRoles.has(role)) {
          fail(
            `${from}: directive "${name}" is limited to the tag role \`${role}:\`, which no loaded package registers.`,
          );
        }
      }
    }
  }

  const parserDirectives: DirectiveSpec[] = [...directives].map(([name, defs]) => {
    const d = defs[0]?.definition;
    return {
      name,
      ...(d?.kind === "effect" && { code: true }),
      ...(d?.kind === "guard" && { guard: true }),
      ...(d?.example !== undefined && { example: d.example }),
    };
  });
  const paragraphEnds = new Set([
    ...[...directives].filter(([, defs]) => defs[0]?.definition.kind === "content").map(([n]) => n),
  ]);

  return {
    parserDirectives,
    parserLineForms: [...lineForms.values()].map(({ definition: f }) => ({
      name: f.name,
      prefix: f.prefix,
    })),
    directives,
    lineForms,
    tagRoles,
    checks,
    paragraphEnds,
    missing: (kind, name) => {
      const suggested = all.flatMap((e) => {
        const table: Readonly<Record<string, string>> = e.suggests?.[kind] ?? {};
        const pkg = Object.hasOwn(table, name) ? table[name] : undefined;
        return pkg === undefined ? [] : [pkg];
      });
      return [...new Set([...knownPackages(kind, name), ...suggested])].filter(
        (p) => !loaded.has(p),
      );
    },
    directive(name, roles) {
      const defs = directives.get(name) ?? [];
      const scoped = defs.find((d) => d.definition.roles?.some((r) => roles.has(r)));
      const found = scoped ?? defs.find((d) => d.definition.roles === undefined);
      if (found) return found;
      const allowed = defs.flatMap((d) => d.definition.roles ?? []);
      const from = [...new Set(defs.map((d) => d.from))].join(" and ");
      return {
        error: `\`{${name}}\` from ${from} only works in passages with the ${rolesText(allowed)} role.`,
      };
    },
  };
}
