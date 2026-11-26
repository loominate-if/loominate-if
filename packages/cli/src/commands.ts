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
  type Plugin,
  type ViteDevServer,
} from "vite";
import { buildArchive } from "./archive.js";
import { loadConfig, type ResolvedConfig } from "./config/config.js";
import { findConflict } from "./vite/conflicts.js";
import { loominateApp } from "./vite/app.js";
import { singleFile, singleFileConfig } from "./vite/single.js";
import { loominateWalkthrough, WALKTHROUGH_SETUP } from "./vite/walkthrough.js";
import { loominate } from "./vite/plugin.js";

/** Options for {@link dev} and {@link build}. */
export type CommandOptions = {
  /** The game's root, holding `loominate.config.ts`. Defaults to the current directory. */
  readonly root?: string;
  /** Package export conditions, such as `source` in this repository's tests. */
  readonly conditions?: readonly string[];
  /** Report every diagnostic, including errors that follow from others, with no limit per file. */
  readonly verbose?: boolean;
  /** More Vite configuration, merged over the command's. */
  readonly vite?: InlineConfig;
};

/** The build targets: a static site of files, one HTML file, or a `.loom` archive. */
export type BuildTarget = "static" | "single" | "archive";

/** Options for {@link build}. */
export type BuildOptions = CommandOptions & {
  /**
   * What to build. `static`, the default, writes a site to `dist/`:
   * `index.html`, the bundled script, and assets as files, for any static
   * host. `single` writes one HTML file, `dist/<game id>.html`, with
   * everything inlined, which opens by double-click with no server.
   * `archive` writes `dist/<game id>.loom`, the static site in one file,
   * with a manifest and the game's IFID, for IF archives and players; the
   * config's `game.ifid` must be set.
   */
  readonly target?: BuildTarget;
  /**
   * Includes the inspector, which `dev` always has, for example in a build
   * for testers. Without it, a build carries none of the inspector's code.
   */
  readonly inspector?: boolean;
};

/** The Vite configuration for a game, from its resolved config. @internal */
export function viteConfig(config: ResolvedConfig, options: BuildOptions): InlineConfig {
  const conditions = options.conditions ?? [];
  const base: InlineConfig = {
    root: config.root,
    // Relative URLs, so a build works from any folder on any static host.
    base: "./",
    // One copy of each runtime package, so the game, its extensions, and the
    // inspector all see the same objects and registries.
    resolve: {
      dedupe: ["@loominate-if/core", "@loominate-if/presentation"],
      ...(conditions.length > 0 && {
        conditions: [...conditions, "module", "browser", "development|production"],
      }),
    },
    plugins: [
      loominate({
        start: config.start,
        extensions: config.loaded,
        ...(config.scope !== undefined && { scope: config.scope }),
        ...(conditions.length > 0 && { compilerOptions: { customConditions: [...conditions] } }),
        ...(options.verbose && { verbose: true }),
        title: config.title ?? config.game.id,
      }),
      loominateApp(config, { inspector: options.inspector ?? false }),
    ],
    ...(conditions.length > 0 && {
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
  const server = await createServer(viteConfig(config, options));
  // A clash between packages' names is reported in the terminal as the server starts (#74).
  void findConflict(config, options.conditions ? { conditions: options.conditions } : {}).then(
    (conflict) => {
      if (conflict !== undefined) server.config.logger.error(conflict, { timestamp: true });
    },
  );
  return server;
}

/**
 * Builds the game for a target, in `dist/`, failing on any error in it.
 * @throws Error if the game's config can't be loaded, the target is unknown,
 * or the game has errors.
 */
export async function build(options: BuildOptions = {}): Promise<void> {
  const target = options.target ?? "static";
  if (target !== "static" && target !== "single" && target !== "archive") {
    throw new Error(`There's no build target "${String(target)}". Use static, single, or archive.`);
  }
  const config = await loadConfig(options.root ?? process.cwd(), {
    ...(options.conditions && { conditions: options.conditions }),
  });
  // A clash between packages' names fails the build before it starts (#74).
  const conflict = await findConflict(
    config,
    options.conditions ? { conditions: options.conditions } : {},
  );
  if (conflict !== undefined) throw new Error(conflict);
  const base = viteConfig(config, options);
  if (target === "archive") {
    await buildArchive(config, base);
    return;
  }
  await viteBuild(
    target === "single"
      ? mergeConfig(mergeConfig(base, singleFileConfig), {
          plugins: [singleFile(`${config.game.id}.html`)],
        })
      : base,
  );
}

/** Options for {@link test}. */
export type TestOptions = CommandOptions & {
  /** Only test files whose paths contain one of these. */
  readonly filters?: readonly string[];
  /** Keep running, and rerun tests as files change. */
  readonly watch?: boolean;
};

/** A finished test run. */
export type TestResult = {
  /** Whether every test passed, and there was at least one. */
  readonly passed: boolean;
  /** How many tests ran. */
  readonly tests: number;
  /** How many tests failed. */
  readonly failed: number;
};

/**
 * Runs the game's walkthrough tests, `*.test.ts` files, with Vitest. Tests
 * import passage files as the game does, and `play()` from
 * `@loominate-if/testing` plays the game the config describes.
 * @throws Error if the game's config can't be loaded, or Vitest isn't installed.
 */
export async function test(options: TestOptions = {}): Promise<TestResult> {
  const config = await loadConfig(options.root ?? process.cwd(), {
    ...(options.conditions && { conditions: options.conditions }),
  });
  return runWalkthroughs(config, options);
}

/**
 * Runs the game's walkthroughs, with more plugins and setup files if given,
 * as `loominate coverage` does. @internal
 */
export async function runWalkthroughs(
  config: ResolvedConfig,
  options: TestOptions,
  more: {
    readonly plugins?: readonly Plugin[];
    readonly setupFiles?: readonly string[];
    readonly passWithNoTests?: boolean;
    /** Leaves out Vite's own messages, such as the compiler's warnings, which coverage reports itself. */
    readonly quiet?: boolean;
  } = {},
): Promise<TestResult> {
  let vitest: typeof import("vitest/node");
  try {
    vitest = await import("vitest/node");
  } catch {
    throw new Error(
      "Walkthrough tests run with Vitest, which isn't installed. Install it with `npm install --save-dev vitest @loominate-if/testing`.",
    );
  }
  const base = viteConfig(config, options);
  const run = await vitest.startVitest(
    [...(options.filters ?? [])],
    { root: config.root, watch: options.watch ?? false, run: !(options.watch ?? false) },
    mergeConfig(base, {
      plugins: [loominateWalkthrough(config), ...(more.plugins ?? [])],
      ...(more.quiet === true && { logLevel: "silent" as const }),
      test: {
        setupFiles: [WALKTHROUGH_SETUP, ...(more.setupFiles ?? [])],
        passWithNoTests: more.passWithNoTests ?? false,
      },
    }),
  );
  const files = run.state.getFiles();
  const tests = files.reduce((n, file) => n + countTests(file), 0);
  const failed = files.reduce((n, file) => n + countTests(file, "fail"), 0);
  // A file that fails to load, or an error outside any test, fails the run too.
  const broken =
    files.filter((f) => f.result?.state === "fail" && countTests(f, "fail") === 0).length +
    run.state.getUnhandledErrors().length;
  if (!(options.watch ?? false)) await run.close();
  return { passed: failed === 0 && broken === 0 && tests > 0, tests, failed };
}

/** A Vitest task: a file, a suite, or a test. */
type Task = { type: string; result?: { state?: string }; tasks?: readonly Task[] };

/** How many tests a file or suite has, or only those in a state such as `fail`. */
function countTests(task: Task, state?: string): number {
  if (task.type === "test") return state === undefined || task.result?.state === state ? 1 : 0;
  return (task.tasks ?? []).reduce((n, t) => n + countTests(t, state), 0);
}
