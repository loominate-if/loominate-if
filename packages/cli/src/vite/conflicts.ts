/**
 * Finding names two packages register (#74, ADR 0065): before a build, and
 * as the dev server starts, the packages the config lists are loaded in
 * Node, in its order, then the game's scope module, as the game's entry
 * loads them. Registering a name something else registered first throws
 * core's `NameTaken`, which this reports as an error naming both, before
 * the game ever opens in a browser.
 *
 * Only that error is reported. Anything else that goes wrong loading code
 * in Node, such as code that needs a browser, is left for the page to
 * report, where it really runs.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { createServer, type InlineConfig } from "vite";
import type { ResolvedConfig } from "../config/config.js";

const CONFIG_FILE = "loominate.config.ts";

/** Whether `error` is core's `NameTaken`, from any copy of core: a name registered twice. */
const isTaken = (error: unknown): error is Error =>
  error instanceof Error && (error as { readonly taken?: unknown }).taken === true;

/**
 * Loads the game's packages, then its scope module, in Node, in the order
 * the game does, and returns why if one registers a name that's taken, or
 * `undefined` if none does.
 */
export async function findConflict(
  config: ResolvedConfig,
  options: { readonly conditions?: readonly string[] } = {},
): Promise<string | undefined> {
  const conditions = options.conditions ?? [];
  const settings: InlineConfig = {
    root: config.root,
    configFile: false,
    logLevel: "silent",
    appType: "custom",
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    // Transform everything, so the packages load as the game's bundle would have them.
    ssr: {
      noExternal: true,
      ...(conditions.length > 0 && {
        resolve: { conditions: [...conditions, "module", "node", "development|production"] },
      }),
    },
    resolve: {
      dedupe: ["@loominate-if/core", "@loominate-if/presentation"],
      ...(conditions.length > 0 && {
        conditions: [...conditions, "module", "development|production"],
      }),
    },
  };
  const server = await createServer(settings);
  try {
    const scope = path.resolve(config.root, config.scope ?? "story.ts");
    const steps = [
      ...config.runtimePackages.map((name, i) => ({
        load: name,
        what: `${CONFIG_FILE}: ${name}, listed ${ordinal(i + 1)} in \`extensions\`,`,
      })),
      ...(existsSync(scope) ? [{ load: scope, what: path.basename(scope) }] : []),
    ];
    for (const { load, what } of steps) {
      try {
        await server.ssrLoadModule(load);
      } catch (error) {
        if (!isTaken(error)) return undefined; // not a clash: the page will say what's wrong
        return `${what} registers a name that's taken: ${error.message}\nPackages load in the order ${CONFIG_FILE} lists them, then ${path.basename(scope)}, so a name belongs to whatever registers it first. Take it over on purpose with replace(), rename one of them, or remove a package from \`extensions\`.`;
      }
    }
    return undefined;
  } finally {
    await server.close();
  }
}

const ordinal = (n: number): string =>
  n === 1 ? "first" : n === 2 ? "second" : n === 3 ? "third" : `${String(n)}th`;
