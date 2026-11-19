/**
 * The `loominate dev` and `loominate build` commands (#52, ADR 0023): Vite,
 * configured from `loominate.config.ts`, with the passage compiler and the
 * generated entry point. A `vite.config.ts` in the game, if there is one, is
 * merged in, for anything else a game needs from Vite.
 */
import {
  build as viteBuild,
  createServer,
  mergeConfig,
  type InlineConfig,
  type ViteDevServer,
} from "vite";
import { loadConfig, type ResolvedConfig } from "./config/config.js";
import { loominateApp } from "./vite/app.js";
import { singleFile, singleFileConfig } from "./vite/single.js";
import { loominate } from "./vite/plugin.js";

/** Options for {@link dev} and {@link build}. */
export type CommandOptions = {
  /** The game's root, holding `loominate.config.ts`. Defaults to the current directory. */
  readonly root?: string;
  /** Package export conditions, such as `source` in this repository's tests. */
  readonly conditions?: readonly string[];
  /** More Vite configuration, merged over the command's. */
  readonly vite?: InlineConfig;
};

/** The build targets: a static site of files, or one HTML file. */
export type BuildTarget = "static" | "single";

/** Options for {@link build}. */
export type BuildOptions = CommandOptions & {
  /**
   * What to build. `static`, the default, writes a site to `dist/`:
   * `index.html`, the bundled script, and assets as files, for any static
   * host. `single` writes one HTML file, `dist/<game id>.html`, with
   * everything inlined, which opens by double-click with no server.
   */
  readonly target?: BuildTarget;
};

/** The Vite configuration for a game, from its resolved config. */
function viteConfig(config: ResolvedConfig, options: CommandOptions): InlineConfig {
  const conditions = options.conditions ?? [];
  const base: InlineConfig = {
    root: config.root,
    // Relative URLs, so a build works from any folder on any static host.
    base: "./",
    plugins: [
      loominate({
        start: config.start,
        extensions: config.loaded,
        ...(config.scope !== undefined && { scope: config.scope }),
        ...(conditions.length > 0 && { compilerOptions: { customConditions: [...conditions] } }),
      }),
      loominateApp(config),
    ],
    ...(conditions.length > 0 && {
      resolve: { conditions: [...conditions, "module", "browser", "development|production"] },
      ssr: { resolve: { conditions: [...conditions, "module", "node", "development|production"] } },
    }),
  };
  return options.vite ? mergeConfig(base, options.vite) : base;
}

/**
 * Starts the dev server, which recompiles and hot-reloads the game as it's edited.
 * @throws Error if the game's config can't be loaded.
 */
export async function dev(options: CommandOptions = {}): Promise<ViteDevServer> {
  const config = await loadConfig(options.root ?? process.cwd(), {
    ...(options.conditions && { conditions: options.conditions }),
  });
  return createServer(viteConfig(config, options));
}

/**
 * Builds the game for a target, in `dist/`, failing on any error in it.
 * @throws Error if the game's config can't be loaded, the target is unknown,
 * or the game has errors.
 */
export async function build(options: BuildOptions = {}): Promise<void> {
  const target = options.target ?? "static";
  if (target !== "static" && target !== "single") {
    throw new Error(`There's no build target "${String(target)}". Use static or single.`);
  }
  const config = await loadConfig(options.root ?? process.cwd(), {
    ...(options.conditions && { conditions: options.conditions }),
  });
  const base = viteConfig(config, options);
  await viteBuild(
    target === "single"
      ? mergeConfig(mergeConfig(base, singleFileConfig), {
          plugins: [singleFile(`${config.game.id}.html`)],
        })
      : base,
  );
}
