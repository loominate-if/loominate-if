/**
 * `loominate map` (#149, ADR 0123): the story map as one HTML file, with the
 * viewer and the laid-out map inlined, to open by double-click or share.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCompilerSession } from "@loominate-if/compiler";
import { build, createServer, mergeConfig, type Plugin, type Rolldown } from "vite";
import { viteConfig, type CommandOptions } from "../commands.js";
import { loadConfig, type ResolvedConfig } from "../config/config.js";
import { gameFiles } from "../vite/plugin.js";
import { layoutStoryMap, type MapViewInput } from "./layout.js";
import { MAP_VIEWS, unreadable, type ViewsModule } from "./runtime.js";
import { mapPage, STANDALONE_SCRIPT } from "./page.js";

/** Options for {@link storyMap}. */
export type MapOptions = CommandOptions & {
  /** Where to write the map, relative to the game's root. Defaults to `dist/story-map.html`. */
  readonly out?: string;
};

/** What {@link storyMap} wrote. */
export type MapResult = {
  /** The file, as an absolute path. */
  readonly file: string;
  /** How many passages the map has. */
  readonly passages: number;
  /** How many errors the game has; the map is drawn anyway. */
  readonly errors: number;
};

const ENTRY = "\0loominate-map-entry";
const INSPECTOR = "@loominate-if/inspector";

/** The views packages add, as the world model's rooms, read from the game begun once. */
async function packageViews(
  config: ResolvedConfig,
  options: CommandOptions,
): Promise<readonly MapViewInput[]> {
  try {
    const server = await createServer(
      mergeConfig(viteConfig(config, options), {
        // No HMR socket or watcher: it loads the game once.
        server: { middlewareMode: true, hmr: false, ws: false, watch: null },
        appType: "custom",
        logLevel: "silent",
      }),
    );
    try {
      return ((await server.ssrLoadModule(MAP_VIEWS)) as ViewsModule).views;
    } finally {
      await server.close();
    }
  } catch (error) {
    return [unreadable(error)];
  }
}

/**
 * Writes the game's story map as one HTML file.
 * @throws Error if the game's config can't be loaded.
 */
export async function storyMap(options: MapOptions = {}): Promise<MapResult> {
  const config = await loadConfig(options.root ?? process.cwd(), {
    ...(options.conditions && { conditions: options.conditions }),
  });
  const session = createCompilerSession({
    root: config.root,
    files: gameFiles(config.root),
    start: config.start,
    extensions: config.loaded,
    ...(config.scope !== undefined && { scope: config.scope }),
    ...(options.conditions && { compilerOptions: { customConditions: [...options.conditions] } }),
    ambient: ["@loominate-if/presentation"],
  });
  const title = config.title ?? config.game.id;
  const map = session.storyMap();
  const drawing = await layoutStoryMap(
    { views: [...map.views, ...(await packageViews(config, options))] },
    title,
  );
  const conditions = options.conditions ?? [];
  const entry: Plugin = {
    name: "loominate-map-entry",
    async resolveId(source) {
      if (source === ENTRY) return ENTRY;
      // The game's own inspector if it has one, otherwise the CLI's.
      if (source === INSPECTOR) {
        return (
          (await this.resolve(source, path.join(config.root, "index.html"), { skipSelf: true })) ??
          (await this.resolve(source, fileURLToPath(import.meta.url), { skipSelf: true }))
        );
      }
      return undefined;
    },
    load(id) {
      return id === ENTRY ? STANDALONE_SCRIPT : undefined;
    },
  };
  const output = await build({
    configFile: false,
    root: config.root,
    logLevel: "warn",
    ...(conditions.length > 0 && {
      resolve: { conditions: [...conditions, "module", "browser", "development|production"] },
    }),
    plugins: [entry],
    build: {
      write: false,
      modulePreload: false,
      rolldownOptions: { input: ENTRY, output: { codeSplitting: false } },
    },
  });
  const outputs = (Array.isArray(output) ? output : [output]) as Rolldown.RolldownOutput[];
  const chunk = outputs
    .flatMap((o) => o.output)
    .find((c): c is Rolldown.OutputChunk => c.type === "chunk" && c.isEntry);
  if (!chunk) throw new Error("The story map's script didn't build.");
  const file = path.resolve(config.root, options.out ?? "dist/story-map.html");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, mapPage(title, { code: chunk.code, drawing }));
  return {
    file,
    passages: map.views[0]?.nodes.filter((n) => n.missing !== true).length ?? 0,
    errors: session.diagnostics().filter((d) => d.severity === "error").length,
  };
}
