/**
 * The game's entry point, generated from its configuration (#52, ADR 0023):
 * `<script type="module" src="/@loominate/main">` in `index.html` plays every
 * passage file in the game with presentation's `playGame`. A game that wants
 * its own shell points `index.html` at its own module instead.
 */
import path from "node:path";
import { PASSAGE_EXTENSION } from "@loominate-if/compiler";
import type { Plugin } from "vite";
import type { ResolvedConfig } from "../config/config.js";
import { gameFiles } from "./plugin.js";

/** The URL `index.html` loads the generated entry point from. */
export const MAIN = "/@loominate/main";
const RESOLVED = "\0loominate:main";

/** Serves the generated entry point. */
export function loominateApp(config: ResolvedConfig): Plugin {
  const passageFiles = (): string[] =>
    gameFiles(config.root)
      .map((f) => f.path)
      .filter((p) => p.endsWith(PASSAGE_EXTENSION));
  return {
    name: "loominate-app",
    resolveId(source) {
      return source === MAIN ? RESOLVED : undefined;
    },
    load(id) {
      if (id !== RESOLVED) return;
      const files = passageFiles();
      const imports = files.map(
        (file, i) => `import { passages as p${String(i)} } from ${JSON.stringify(file)};`,
      );
      return [
        'import { playGame } from "@loominate-if/presentation";',
        ...imports,
        `const passages = [${files.map((_, i) => `...p${String(i)}`).join(", ")}];`,
        'const container = document.querySelector("#app") ?? document.body;',
        `await playGame(container, ${JSON.stringify({
          start: config.start,
          game: config.game,
          title: config.title ?? config.game.id,
        }).replace(/^\{/, "{ passages, ")});`,
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
