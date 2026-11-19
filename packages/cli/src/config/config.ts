/**
 * A game's configuration, `loominate.config.ts` (#238, ADR 0023): its ID and
 * version, title, start passage, and the packages whose compiler extensions it
 * loads, in order. The dev server, builds, and tests all read it, so they
 * compile the game the same way.
 */
import { existsSync, readFileSync } from "node:fs";
import { findPackageJSON } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { CompilerExtension } from "@loominate-if/compiler";
import { runnerImport } from "vite";

/** The config file's name, in the game's root. */
export const CONFIG_FILE = "loominate.config.ts";

/** What `loominate.config.ts` exports. */
export type LoominateConfig = {
  /** The game's stable ID, which keeps its saves apart from other games', and its version, which saves record. */
  readonly game: { readonly id: string; readonly version: string };
  /** The game's name, shown on its start screen. Defaults to the game's ID. */
  readonly title?: string;
  /** The passage a new game starts in. */
  readonly start: string;
  /**
   * Packages whose compiler extensions the game loads, by name, in the order
   * they load. Each package says where its extension is, in its package.json:
   * `"loominate": { "extension": "./dist/extension.js" }`.
   */
  readonly extensions?: readonly string[];
  /** The scope module, whose exports passages can use. Defaults to `story.ts`. */
  readonly scope?: string;
};

/**
 * Declares a game's configuration, with types.
 *
 * @example
 * ```ts
 * // loominate.config.ts
 * import { defineConfig } from "@loominate-if/cli";
 *
 * export default defineConfig({
 *   game: { id: "lantern-road", version: "1.0.0" },
 *   title: "Lantern Road",
 *   start: "Start",
 * });
 * ```
 */
export function defineConfig(config: LoominateConfig): LoominateConfig {
  return config;
}

/** A game's configuration, read and checked, with its compiler extensions loaded. */
export type ResolvedConfig = LoominateConfig & {
  /** The game's root directory. */
  readonly root: string;
  /** The extensions, loaded, in order. */
  readonly loaded: readonly CompilerExtension[];
};

/** Options for {@link loadConfig}. */
export type LoadConfigOptions = {
  /** Package export conditions for resolving the config's imports, such as `source` in this repository's tests. */
  readonly conditions?: readonly string[];
};

/**
 * Reads `loominate.config.ts` in `root`, checks it, and loads its extensions.
 * @throws Error saying what's wrong and how to fix it: no config file, a
 * missing or mistyped field, or an extension that isn't installed or provides none.
 */
export async function loadConfig(
  root: string,
  options: LoadConfigOptions = {},
): Promise<ResolvedConfig> {
  const dir = path.resolve(root);
  const file = path.join(dir, CONFIG_FILE);
  if (!existsSync(file)) {
    throw new Error(
      `There's no ${CONFIG_FILE} in ${dir}. Run this in a game's folder, or create one with \`npm create @loominate-if\`.`,
    );
  }
  const conditions = [...(options.conditions ?? []), "module", "node", "import", "default"];
  const { module } = await runnerImport<{ default?: unknown }>(file, {
    root: dir,
    configFile: false,
    logLevel: "silent",
    resolve: { conditions },
    ssr: {
      resolve: { conditions, externalConditions: conditions },
      // Packages read from source, as in this repository, go through Vite, which compiles them.
      ...(options.conditions?.length ? { noExternal: [/^@loominate-if\//] } : {}),
    },
  });
  const config = check(module.default);
  return { ...config, root: dir, loaded: await loadExtensions(dir, config.extensions ?? []) };
}

/** Checks a config's shape, explaining the first problem. */
function check(value: unknown): LoominateConfig {
  const fail = (problem: string): never => {
    throw new Error(`${CONFIG_FILE}: ${problem}`);
  };
  const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  const text = (v: unknown) => typeof v === "string" && v.trim() !== "";
  if (!isRecord(value)) {
    return fail(
      "export the game's configuration as the default: `export default defineConfig({ … })`.",
    );
  }
  const { game, title, start, extensions, scope } = value;
  if (!isRecord(game) || !text(game.id) || !text(game.version)) {
    fail(
      '`game` needs an `id` and a `version`, like `game: { id: "lantern-road", version: "1.0.0" }`.',
    );
  }
  if (!text(start)) fail('`start` names the passage a new game starts in, like `start: "Start"`.');
  if (title !== undefined && typeof title !== "string") fail("`title` must be a string.");
  if (scope !== undefined && !text(scope)) fail("`scope` must name a module, like `story.ts`.");
  if (extensions !== undefined && !(Array.isArray(extensions) && extensions.every(text))) {
    fail('`extensions` lists package names, like `extensions: ["@loominate-if/world"]`.');
  }
  return value as LoominateConfig;
}

/** Loads each listed package's compiler extension, in order. */
async function loadExtensions(
  root: string,
  names: readonly string[],
): Promise<CompilerExtension[]> {
  const from = pathToFileURL(path.join(root, "package.json"));
  const loaded: CompilerExtension[] = [];
  for (const name of names) {
    let manifest: string | undefined;
    try {
      manifest = findPackageJSON(name, from);
    } catch {
      manifest = undefined;
    }
    if (manifest === undefined) {
      throw new Error(
        `${CONFIG_FILE}: the extension package ${name} isn't installed. Install it with \`npm install ${name}\`, or remove it from \`extensions\`.`,
      );
    }
    const pkg = JSON.parse(readFileSync(manifest, "utf8")) as {
      loominate?: { extension?: unknown };
    };
    const entry = pkg.loominate?.extension;
    if (typeof entry !== "string") {
      throw new Error(
        `${CONFIG_FILE}: ${name} doesn't provide a compiler extension; its package.json has no \`"loominate": { "extension": "…" }\`. Remove it from \`extensions\`.`,
      );
    }
    const mod = (await import(pathToFileURL(path.join(path.dirname(manifest), entry)).href)) as {
      default?: unknown;
    };
    const extension = mod.default;
    if (
      typeof extension !== "object" ||
      extension === null ||
      typeof (extension as { name?: unknown }).name !== "string"
    ) {
      throw new Error(
        `${CONFIG_FILE}: ${name}'s extension module, ${entry}, must export its compiler extension as the default.`,
      );
    }
    loaded.push(extension as CompilerExtension);
  }
  return loaded;
}
