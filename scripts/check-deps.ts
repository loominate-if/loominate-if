/**
 * Enforces the package layering from ADR 0001 (docs/decisions/0001-repository-layout.md).
 *
 * pnpm only links a package's declared dependencies, so checking each package.json
 * enforces the import graph. Relative imports that escape a package are checked
 * separately, because they bypass package.json entirely.
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, relative, resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { listPackages } from "./workspace.ts";

export type Kind =
  | { kind: "runtime"; rank: number }
  | { kind: "tooling"; noOptionalRuntime: boolean }
  | { kind: "example" };

/**
 * Runtime packages stack by rank; a runtime package may only depend on lower ranks.
 * Kits and the parser share the top rank, so they can't depend on each other.
 */
const RUNTIME_RANKS: Record<string, number> = {
  core: 0,
  presentation: 1,
  world: 2,
  parser: 3,
};
const KIT_RANK = 3;
/** Highest runtime layer that compiler and inspector may depend on: core and presentation. */
const CORE_TOOLING_MAX_RANK = 1;

/** Tooling that must stay usable without the world model or kits (ADR 0001, rule 3). */
const CORE_ONLY_TOOLING = new Set(["compiler", "inspector"]);

const TOOLING = new Set([
  "compiler",
  "inspector",
  "testing",
  "cli",
  "create",
  "language-server",
  "vscode",
  "archive",
  "player",
  "target-tauri",
  "target-capacitor",
]);

/** Classifies a workspace package by its path relative to the repo root, e.g. `packages/core`. */
export function classify(dir: string): Kind | undefined {
  const parts = dir.split(/[\\/]/);
  if (parts[0] === "examples" && parts.length === 2) return { kind: "example" };
  if (parts[0] !== "packages") return undefined;
  if (parts[1] === "kits" && parts.length === 3) return { kind: "runtime", rank: KIT_RANK };
  if (parts.length !== 2 || parts[1] === undefined) return undefined;
  const name = parts[1];
  const rank = RUNTIME_RANKS[name];
  if (rank !== undefined) return { kind: "runtime", rank };
  if (TOOLING.has(name)) return { kind: "tooling", noOptionalRuntime: CORE_ONLY_TOOLING.has(name) };
  return undefined;
}

/** Returns why `from` may not depend on `to`, or undefined when the dependency is allowed. */
export function checkDependency(
  fromDir: string,
  from: Kind,
  toDir: string,
  to: Kind,
): string | undefined {
  if (to.kind === "example") return `${fromDir} depends on example ${toDir}; examples are leaves.`;
  if (from.kind === "example") return undefined;
  if (from.kind === "runtime") {
    if (to.kind === "tooling") {
      return `runtime package ${fromDir} depends on tooling package ${toDir}; runtime packages must never depend on tooling.`;
    }
    if (to.rank >= from.rank) {
      return `${fromDir} depends on ${toDir}, which is at the same or a higher layer; runtime dependencies flow downward only (core <- presentation <- world <- kits), and kits never depend on each other.`;
    }
    return undefined;
  }
  if (from.noOptionalRuntime && to.kind === "runtime" && to.rank > CORE_TOOLING_MAX_RANK) {
    return `${fromDir} depends on optional package ${toDir}; it must stay usable without it. Have ${toDir} register into ${fromDir}'s extension API instead.`;
  }
  return undefined;
}

const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/g;

/** Finds relative import specifiers in `source` that resolve outside `packageDir`. */
export function findEscapingImports(packageDir: string, file: string, source: string): string[] {
  const root = resolve(packageDir);
  const out: string[] = [];
  for (const m of source.matchAll(IMPORT_RE)) {
    const spec = m[1];
    if (spec === undefined || !spec.startsWith(".")) continue;
    const target = resolve(dirname(file), spec);
    if (target !== root && !target.startsWith(root + sep)) out.push(spec);
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) return entry === "node_modules" ? [] : sourceFiles(p);
    return /\.(m|c)?[jt]sx?$/.test(entry) ? [p] : [];
  });
}

export function checkRepo(repo: string): string[] {
  const errors: string[] = [];
  const pkgs = listPackages(repo);
  const byName = new Map(pkgs.map((p) => [p.name, p]));
  for (const pkg of pkgs) {
    const from = classify(pkg.dir);
    if (!from) {
      errors.push(`${pkg.dir}: unknown package; classify it in scripts/check-deps.ts.`);
      continue;
    }
    for (const dep of pkg.deps) {
      const target = byName.get(dep);
      if (!target) continue;
      const to = classify(target.dir);
      if (!to) continue;
      const why = checkDependency(pkg.dir, from, target.dir, to);
      if (why) errors.push(`${pkg.dir}/package.json: ${why}`);
    }
    for (const file of sourceFiles(join(repo, pkg.dir, "src"))) {
      for (const spec of findEscapingImports(
        join(repo, pkg.dir),
        file,
        readFileSync(file, "utf8"),
      )) {
        errors.push(
          `${relative(repo, file)}: relative import "${spec}" leaves ${pkg.dir}; import the package by name and declare it in package.json.`,
        );
      }
    }
  }
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = checkRepo(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
  for (const e of errors) console.error(`check-deps: ${e}`);
  if (errors.length > 0) process.exitCode = 1;
}
