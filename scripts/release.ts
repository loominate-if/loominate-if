/**
 * Release helpers (#257, ADR 0029): the published packages share one version,
 * and their manifests carry what npm and provenance need.
 *
 *   node scripts/release.ts check [--tag v0.1.0]   problems with the manifests, or the tag
 *   node scripts/release.ts version 0.2.0          sets every published package's version
 *   node scripts/release.ts pack <folder>          packs each into <folder>, checking the packed manifests
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listPackages, type WorkspacePackage } from "./workspace.ts";

/** The repository provenance is checked against, as npm wants it written. */
export const REPOSITORY_URL = "git+https://github.com/loominate-if/loominate-if.git";

const RUNTIME_DEPENDENCY_KINDS = ["dependencies", "peerDependencies", "optionalDependencies"];
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** The packages that are published: those under `packages/` that aren't private. */
export function publishedPackages(repo: string): WorkspacePackage[] {
  return listPackages(repo).filter((p) => p.dir.startsWith("packages/") && p.json.private !== true);
}

/** What's wrong with the published packages' manifests, or with the tag a release is cut from. */
export function checkRelease(repo: string, tag?: string): string[] {
  const published = publishedPackages(repo);
  const names = new Set(published.map((p) => p.name));
  const problems: string[] = [];
  const versions = [...new Set(published.map((p) => String(p.json.version)))];
  if (versions.length > 1) {
    problems.push(
      `The published packages must share one version, but have ${versions.join(", ")}. Set them with \`node scripts/release.ts version <version>\`.`,
    );
  }
  for (const p of published) {
    const json = p.json;
    const where = `${p.dir}/package.json`;
    if (typeof json.version !== "string" || !SEMVER.test(json.version)) {
      problems.push(`${where}: "version" must be a version like 0.1.0.`);
    }
    if (json.license !== "MIT") problems.push(`${where}: "license" must be "MIT".`);
    const repository = json.repository as { url?: unknown; directory?: unknown } | undefined;
    if (repository?.url !== REPOSITORY_URL || repository.directory !== p.dir) {
      problems.push(
        `${where}: "repository" must be { "type": "git", "url": "${REPOSITORY_URL}", "directory": "${p.dir}" }, so npm can check its provenance.`,
      );
    }
    if ((json.publishConfig as { access?: unknown } | undefined)?.access !== "public") {
      problems.push(
        `${where}: "publishConfig" must have "access": "public", as a scoped package is private otherwise.`,
      );
    }
    if (!Array.isArray(json.files) || !json.files.includes("dist")) {
      problems.push(`${where}: "files" must include "dist".`);
    }
    for (const kind of RUNTIME_DEPENDENCY_KINDS) {
      for (const dep of Object.keys((json[kind] as Record<string, string> | undefined) ?? {})) {
        if (dep.startsWith("@loominate-if/") && !names.has(dep)) {
          problems.push(`${where}: it depends on ${dep}, which isn't published.`);
        }
      }
    }
  }
  if (tag !== undefined && versions.length === 1 && tag !== `v${versions[0] ?? ""}`) {
    problems.push(
      `The tag ${tag} doesn't match the packages' version, ${versions[0] ?? ""}: tag v${versions[0] ?? ""} instead.`,
    );
  }
  return problems;
}

/** Where core declares `ENGINE_VERSION`, which saves record and must be core's version. */
export const ENGINE_VERSION_FILE = "packages/core/src/save/save.ts";
const ENGINE_VERSION_LINE = /^export const ENGINE_VERSION = "[^"]*";$/m;

/** Sets every published package's version, and core's `ENGINE_VERSION` to match. */
export function setVersion(repo: string, version: string): void {
  if (!SEMVER.test(version)) throw new Error(`"${version}" isn't a version like 0.1.0.`);
  for (const p of publishedPackages(repo)) {
    const file = join(repo, p.dir, "package.json");
    const json = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    json.version = version;
    writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  }
  const engine = join(repo, ENGINE_VERSION_FILE);
  if (existsSync(engine)) {
    const source = readFileSync(engine, "utf8");
    if (!ENGINE_VERSION_LINE.test(source)) {
      throw new Error(
        `${ENGINE_VERSION_FILE} no longer declares ENGINE_VERSION as a string; update scripts/release.ts.`,
      );
    }
    writeFileSync(
      engine,
      source.replace(ENGINE_VERSION_LINE, `export const ENGINE_VERSION = "${version}";`),
    );
  }
}

/** What's wrong with a packed manifest: anything pnpm should have rewritten, or files it left out. */
export function checkPacked(json: Record<string, unknown>, files: readonly string[]): string[] {
  const problems: string[] = [];
  const name = String(json.name);
  for (const kind of [...RUNTIME_DEPENDENCY_KINDS, "devDependencies"]) {
    for (const [dep, range] of Object.entries(
      (json[kind] as Record<string, string> | undefined) ?? {},
    )) {
      if (range.startsWith("workspace:")) problems.push(`${name}: ${dep} is still "${range}".`);
    }
  }
  const has = new Set(files.map((f) => f.replace(/^package\//, "").replace(/^\.\//, "")));
  const wanted: string[] = [];
  const bin = json.bin as Record<string, string> | undefined;
  wanted.push(...Object.values(bin ?? {}));
  const exported = (json.exports as Record<string, Record<string, string>> | undefined)?.["."];
  for (const [condition, target] of Object.entries(exported ?? {})) {
    if (condition !== "source") wanted.push(target);
  }
  for (const file of wanted) {
    const path = file.replace(/^\.\//, "");
    if (!has.has(path))
      problems.push(`${name}: the package is missing ${path}. Run \`pnpm build\` first.`);
  }
  return problems;
}

/** Build output is in `dist/` beside `dist/api-report/`, made from the same path under `src/`. */
const OUTPUT = /^dist\/(?!api-report\/)(.+)\.(?:d\.ts|js)(?:\.map)?$/;

/**
 * Packed build output whose source is gone. `tsc -b` never deletes output when
 * a source file is removed, so an old checkout can carry files that aren't part
 * of the package.
 */
export function staleOutput(
  name: string,
  files: readonly string[],
  sourceExists: (path: string) => boolean,
): string[] {
  const problems: string[] = [];
  for (const file of files) {
    const path = file.replace(/^package\//, "");
    const built = OUTPUT.exec(path);
    if (built && !sourceExists(`src/${built[1] ?? ""}.ts`)) {
      problems.push(
        `${name}: ${path} has no source in src/, so it's left from an old build. Delete dist and build again.`,
      );
    }
  }
  return problems;
}

/** The file `pnpm pack` writes for a package: `@loominate-if/core` at 0.1.0 is `loominate-if-core-0.1.0.tgz`. */
export function tarballName(name: string, version: string): string {
  return `${name.replace(/^@/, "").replace("/", "-")}-${version}.tgz`;
}

/** Packs each published package into `out` and checks what was packed. */
export function pack(repo: string, out: string): string[] {
  mkdirSync(out, { recursive: true });
  const problems: string[] = [];
  for (const p of publishedPackages(repo)) {
    // Named as pnpm names it, so an old tarball in the folder is never mistaken for this one.
    const tarball = tarballName(p.name, String(p.json.version));
    rmSync(join(out, tarball), { force: true });
    execFileSync("pnpm", ["pack", "--pack-destination", out], {
      cwd: join(repo, p.dir),
      stdio: ["ignore", "ignore", "inherit"],
    });
    if (!existsSync(join(out, tarball))) {
      problems.push(
        `${p.name}: pnpm pack didn't write ${tarball}; ${out} has ${readdirSync(out).join(", ") || "nothing"}.`,
      );
      continue;
    }
    const unpacked = mkdtempSync(join(tmpdir(), "loominate-pack-"));
    try {
      execFileSync("tar", ["-xzf", join(out, tarball), "-C", unpacked]);
      const files = execFileSync("tar", ["-tzf", join(out, tarball)], { encoding: "utf8" })
        .split("\n")
        .filter((f) => f !== "");
      const json = JSON.parse(
        readFileSync(join(unpacked, "package", "package.json"), "utf8"),
      ) as Record<string, unknown>;
      problems.push(...checkPacked(json, files));
      problems.push(...staleOutput(p.name, files, (path) => existsSync(join(repo, p.dir, path))));
    } finally {
      rmSync(unpacked, { recursive: true, force: true });
    }
  }
  return problems;
}

function main(args: readonly string[]): number {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const [command, ...rest] = args;
  const report = (problems: readonly string[]) => {
    for (const problem of problems) console.error(problem);
    return problems.length === 0 ? 0 : 1;
  };
  switch (command) {
    case "check": {
      const at = rest.indexOf("--tag");
      return report(checkRelease(repo, at === -1 ? undefined : rest[at + 1]));
    }
    case "version": {
      const [version] = rest;
      if (version === undefined)
        return report(["Give the version: node scripts/release.ts version 0.2.0"]);
      setVersion(repo, version);
      return report(checkRelease(repo));
    }
    case "pack": {
      const [out] = rest;
      if (out === undefined) return report(["Give a folder: node scripts/release.ts pack release"]);
      return report([...checkRelease(repo), ...pack(repo, resolve(out))]);
    }
    default:
      return report([
        "Usage: node scripts/release.ts check [--tag vX.Y.Z] | version X.Y.Z | pack <folder>",
      ]);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
