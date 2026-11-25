/**
 * A game's configuration, `loominate.config.ts` (#238, ADR 0023): its ID and
 * version, title, start passage, the packages it loads, in order, for their
 * compiler extensions and inspector modules, and its own inspector module. The dev server, builds, and tests all read it, so they
 * compile the game the same way.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { findPackageJSON } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { CompilerExtension } from "@loominate-if/compiler";
import { runnerImport } from "vite";

/** The module a config's `import { defineConfig } from "@loominate-if/cli"` loads. */
const DEFINE = "\0loominate:define-config";
/** What the config's import of `@loominate-if/cli` is rewritten to. */
const DEFINE_URL = "/@loominate/define-config";

/** The config file's name, in the game's root. */
export const CONFIG_FILE = "loominate.config.ts";

/** What `loominate.config.ts` exports. */
export type LoominateConfig = {
  /** The game's stable ID, which keeps its saves apart from other games', and its version, which saves record. */
  readonly game: { readonly id: string; readonly version: string };
  /** The game's name, shown on its start screen. Defaults to the game's ID. */
  readonly title?: string;
  /** Who wrote it: on its start screen and in story log exports. */
  readonly author?: string;
  /**
   * The game's cover art, on its start screen: an image in the game's
   * `public/` folder, by its path there, and what it shows, for those who
   * can't see it.
   */
  readonly cover?: { readonly image: string; readonly alt: string };
  /**
   * Whether the game has sound: it plays what it cues with `music`,
   * `ambience`, and `sound`, files in its `public/` folder, and offers a
   * Sound switch and settings. Off by default.
   */
  readonly audio?: boolean;
  /**
   * Shareable seeds: `true` makes each new game's seed memorable words, shown
   * in the game menu to share, and takes one to play; `"daily"` gives
   * everyone today's; any other text is the seed every game starts from.
   * Off by default, for games with nothing random to share.
   */
  readonly seeds?: boolean | "daily" | (string & {});
  /** The passage a new game starts in. */
  readonly start: string;
  /**
   * Packages the game loads, by name, in the order they load. Each package
   * says, in its package.json, where its compiler extension is, where its
   * inspector module is, or both:
   * `"loominate": { "extension": "./dist/extension.js", "inspector": "./dist/inspector.js" }`.
   * Inspector modules are loaded only where the inspector is.
   */
  readonly extensions?: readonly string[];
  /**
   * The game's own inspector module, such as `inspector.ts`, which registers
   * inspector panels and explainers. It's loaded only where the inspector is:
   * by `loominate dev`, and by `loominate build --inspector`.
   */
  readonly inspector?: string;
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
 *   author: "A. Writer",
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
  /**
   * The inspector modules to load where the inspector is, as absolute paths:
   * the packages' in order, then the game's own.
   */
  readonly inspectorModules: readonly string[];
  /**
   * The listed packages that have a runtime entry, in the order listed: the
   * game's entry imports them first, in this order, so the config sets the
   * order packages load in, at runtime as in the compiler (#74).
   */
  readonly runtimePackages: readonly string[];
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
    ssr: { resolve: { conditions, externalConditions: conditions } },
    plugins: [
      {
        // A config needs only defineConfig from the CLI. Supplying it here means
        // reading a config never loads the whole CLI, whether it's installed
        // built or, as in this repository, as TypeScript sources.
        name: "loominate-config",
        enforce: "pre",
        // Rewritten in the config's own source, since Vite's server runtime
        // hands an installed package's import to Node before plugins see it.
        transform: (code, id) =>
          path.resolve(id) === file
            ? code.replace(/(from\s*)(["'])@loominate-if\/cli\2/g, `$1"${DEFINE_URL}"`)
            : undefined,
        resolveId: (source) => (source === DEFINE_URL ? DEFINE : undefined),
        load: (id) =>
          id === DEFINE ? "export const defineConfig = (config) => config;\n" : undefined,
      },
    ],
  });
  const config = check(module.default);
  const packages = await loadPackages(dir, config.extensions ?? []);
  const own = config.inspector === undefined ? [] : [path.resolve(dir, config.inspector)];
  for (const module of own) {
    if (!existsSync(module)) {
      throw new Error(
        `${CONFIG_FILE}: \`inspector\` names ${config.inspector ?? ""}, which isn't in ${dir}. Create it, or remove \`inspector\`.`,
      );
    }
  }
  return {
    ...config,
    root: dir,
    loaded: packages.extensions,
    inspectorModules: [...packages.inspectorModules, ...own],
    runtimePackages: packages.runtimePackages,
  };
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
  const { game, title, author, cover, audio, seeds, start, extensions, scope, inspector } = value;
  if (!isRecord(game) || !text(game.id) || !text(game.version)) {
    fail(
      '`game` needs an `id` and a `version`, like `game: { id: "lantern-road", version: "1.0.0" }`.',
    );
  }
  if (!text(start)) fail('`start` names the passage a new game starts in, like `start: "Start"`.');
  if (title !== undefined && typeof title !== "string") fail("`title` must be a string.");
  if (author !== undefined && typeof author !== "string") {
    fail('`author` must be a string, like `author: "A. Writer"`.');
  }
  if (
    cover !== undefined &&
    !(isRecord(cover) && text(cover.image) && typeof cover.alt === "string")
  ) {
    fail(
      '`cover` needs an `image` and its `alt` text, like `cover: { image: "cover.jpg", alt: "A lighthouse in a storm" }`.',
    );
  }
  if (audio !== undefined && typeof audio !== "boolean") {
    fail("`audio` is `true` for a game with sound, or `false`, like `audio: true`.");
  }
  if (seeds !== undefined && typeof seeds !== "boolean" && !text(seeds)) {
    fail(
      '`seeds` must be `true`, `false`, `"daily"`, or the seed every game starts from, like `seeds: true`.',
    );
  }
  if (scope !== undefined && !text(scope)) fail("`scope` must name a module, like `story.ts`.");
  if (inspector !== undefined && !text(inspector)) {
    fail("`inspector` must name a module, like `inspector.ts`.");
  }
  if (extensions !== undefined && !(Array.isArray(extensions) && extensions.every(text))) {
    fail('`extensions` lists package names, like `extensions: ["@loominate-if/world"]`.');
  }
  return value as LoominateConfig;
}

/**
 * Finds each listed package's compiler extension and inspector module, in
 * order, and loads the extensions. The inspector modules are only located:
 * the game's entry imports them where the inspector is.
 */
async function loadPackages(
  root: string,
  names: readonly string[],
): Promise<{
  extensions: CompilerExtension[];
  inspectorModules: string[];
  runtimePackages: string[];
}> {
  const from = pathToFileURL(path.join(root, "package.json"));
  const extensions: CompilerExtension[] = [];
  const inspectorModules: string[] = [];
  const runtimePackages: string[] = [];
  for (const name of names) {
    let manifest: string | undefined;
    try {
      manifest = findPackageJSON(name, from);
    } catch {
      manifest = undefined;
    }
    if (manifest === undefined) {
      throw new Error(
        `${CONFIG_FILE}: the package ${name} isn't installed. Install it with \`npm install ${name}\`, or remove it from \`extensions\`.`,
      );
    }
    const pkg = JSON.parse(readFileSync(manifest, "utf8")) as {
      loominate?: { extension?: unknown; inspector?: unknown };
      main?: unknown;
      exports?: unknown;
    };
    // A package the game can import has a runtime entry: its main, or its "." export.
    const exportsRoot =
      typeof pkg.exports === "string" ||
      (typeof pkg.exports === "object" && pkg.exports !== null && "." in pkg.exports);
    if (typeof pkg.main === "string" || exportsRoot) runtimePackages.push(name);
    const { extension: entry, inspector } = pkg.loominate ?? {};
    if (typeof entry !== "string" && typeof inspector !== "string") {
      throw new Error(
        `${CONFIG_FILE}: ${name} provides neither a compiler extension nor an inspector module; its package.json has no \`"loominate": { "extension": "…" }\` or \`"loominate": { "inspector": "…" }\`. Remove it from \`extensions\`.`,
      );
    }
    if (typeof inspector === "string") {
      // Its real path: a linked package, as in a workspace, is then served as source, reloaded
      // when it's rebuilt, not through node_modules as a dependency the browser caches for good (#332).
      const file = path.join(path.dirname(manifest), inspector);
      inspectorModules.push(existsSync(file) ? realpathSync(file) : file);
    }
    if (typeof entry !== "string") continue;
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
    extensions.push(extension as CompilerExtension);
  }
  return { extensions, inspectorModules, runtimePackages };
}
