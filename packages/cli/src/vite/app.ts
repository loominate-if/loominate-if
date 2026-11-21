/**
 * The game's entry point, generated from its configuration (#52, ADR 0023):
 * `<script type="module" src="/@loominate/main">` in `index.html` plays every
 * passage file in the game with presentation's `playGame`. A game that wants
 * its own shell points `index.html` at its own module instead.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PASSAGE_EXTENSION } from "@loominate-if/compiler";
import type { Plugin } from "vite";
import type { ResolvedConfig } from "../config/config.js";
import { gameFiles } from "./plugin.js";

/** The URL `index.html` loads the generated entry point from. */
export const MAIN = "/@loominate/main";
const RESOLVED = "\0loominate:main";
const INSPECTOR = "@loominate-if/inspector";

/** Options for {@link loominateApp}. */
export type AppOptions = {
  /** Adds the inspector in a build. The dev server always adds it. */
  readonly inspector?: boolean;
};

/** Serves the generated entry point. */
export function loominateApp(config: ResolvedConfig, options: AppOptions = {}): Plugin {
  let serving = false;
  const passageFiles = (): string[] =>
    gameFiles(config.root)
      .map((f) => f.path)
      .filter((p) => p.endsWith(PASSAGE_EXTENSION));
  return {
    name: "loominate-app",
    configResolved(resolved) {
      serving = resolved.command === "serve";
    },
    async resolveId(source, importer) {
      if (source === MAIN) return RESOLVED;
      // Everything gets one copy of the inspector, so the panels that packages
      // and the game register are the ones it shows: the game's own if it
      // installed one, otherwise the one the CLI depends on.
      if (source === INSPECTOR && importer !== undefined) {
        return (
          (await this.resolve(source, path.join(config.root, "index.html"), { skipSelf: true })) ??
          (await this.resolve(source, fileURLToPath(import.meta.url), { skipSelf: true }))
        );
      }
      return undefined;
    },
    load(id) {
      if (id !== RESOLVED) return;
      const files = passageFiles();
      const imports = files.map(
        (file, i) => `import { passages as p${String(i)} } from ${JSON.stringify(file)};`,
      );
      const inspector = serving || (options.inspector ?? false);
      return [
        'import { playGame } from "@loominate-if/presentation";',
        // Only when wanted: a build without it carries none of its code.
        ...(inspector
          ? [
              `import { inspect } from ${JSON.stringify(INSPECTOR)};`,
              // Packages' panels and explainers, then the game's own, before the inspector starts.
              ...config.inspectorModules.map((m) => `import ${JSON.stringify(m)};`),
            ]
          : []),
        ...imports,
        `const passages = [${files.map((_, i) => `...p${String(i)}`).join(", ")}];`,
        'const container = document.querySelector("#app") ?? document.body;',
        `const player = await playGame(container, ${JSON.stringify({
          start: config.start,
          game: config.game,
          title: config.title ?? config.game.id,
        }).replace(/^\{/, "{ passages, ")});`,
        ...(inspector ? ["inspect(player);"] : []),
        "",
      ].join("\n");
    },
    configureServer(server) {
      // A passage file added or removed changes which files the entry imports.
      const changed = (file: string) => {
        if (!file.endsWith(PASSAGE_EXTENSION) || !path.resolve(file).startsWith(config.root))
          return;
        const mod = server.moduleGraph.getModuleById(RESOLVED);
        if (!mod) return;
        server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: "full-reload" });
      };
      server.watcher.on("add", changed);
      server.watcher.on("unlink", changed);
    },
  };
}
