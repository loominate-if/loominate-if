/** Reads the workspace packages listed in pnpm-workspace.yaml. */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const SCOPE = "@loominate-if/";

/** Workspace globs from pnpm-workspace.yaml, as parent folders. */
const PACKAGE_PARENTS = ["packages", "packages/kits", "examples"];

export interface WorkspacePackage {
  /** Path relative to the repo root, e.g. `packages/core`. */
  dir: string;
  name: string;
  /** Workspace (`@loominate-if/…`) packages it depends on, of any dependency kind. */
  deps: string[];
  json: Record<string, unknown>;
}

export function listPackages(repo: string): WorkspacePackage[] {
  const dirs: string[] = [];
  for (const base of PACKAGE_PARENTS) {
    const abs = join(repo, base);
    if (!existsSync(abs)) continue;
    for (const entry of readdirSync(abs).sort()) {
      if (existsSync(join(abs, entry, "package.json"))) dirs.push(`${base}/${entry}`);
    }
  }
  return dirs.map((dir) => {
    const json = JSON.parse(readFileSync(join(repo, dir, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const deps = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]
      .flatMap((k) => Object.keys((json[k] as Record<string, string> | undefined) ?? {}))
      .filter((d) => d.startsWith(SCOPE));
    return { dir, name: String(json.name), deps, json };
  });
}
