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
/** The module the entry point imports first, which shows errors instead of a blank page. */
const ERRORS = "/@loominate/errors";
const RESOLVED_ERRORS = "\0loominate:errors";
/** The dev server's channel for errors in the page, which it prints in the terminal. */
const ERROR_EVENT = "loominate:error";

/**
 * Shows an error that stops the game, on the page, instead of leaving it
 * blank: one thrown while the game loads, such as in `story.ts`, or one
 * nothing else caught, which the dev server also prints in the terminal.
 * Errors the page catches and shows during play reach the terminal through
 * `report`. Its words are English: the message table may not have loaded.
 */
const ERRORS_CODE = `
let started = false;
const text = (error) => (error instanceof Error ? error.message : String(error));
export function report(error) {
  if (import.meta.hot) {
    import.meta.hot.send(${JSON.stringify(ERROR_EVENT)}, {
      message: text(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}
export function markStarted() {
  started = true;
}
function show(error) {
  // The dev server prints uncaught errors itself, with a code frame.
  const container = document.querySelector("#app") ?? document.body;
  const box = document.createElement("div");
  box.className = "loominate-fatal";
  box.setAttribute("role", "alert");
  const title = document.createElement("p");
  title.append(document.createElement("strong"));
  title.firstChild.textContent = started ? "Something went wrong." : "The game couldn't start.";
  const detail = document.createElement("p");
  detail.textContent = text(error);
  box.append(title, detail);
  if (import.meta.hot && error instanceof Error && error.stack) {
    const stack = document.createElement("pre");
    stack.textContent = error.stack;
    box.append(stack);
  }
  container.prepend(box);
}
addEventListener("error", (event) => show(event.error ?? event.message));
addEventListener("unhandledrejection", (event) => show(event.reason));
`;
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
      if (source === ERRORS) return RESOLVED_ERRORS;
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
      if (id === RESOLVED_ERRORS) return ERRORS_CODE;
      if (id !== RESOLVED) return;
      const files = passageFiles();
      const imports = files.map(
        (file, i) => `import { passages as p${String(i)} } from ${JSON.stringify(file)};`,
      );
      const inspector = serving || (options.inspector ?? false);
      return [
        // First, so an error in anything after it shows on the page.
        `import { markStarted, report } from ${JSON.stringify(ERRORS)};`,
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
        }).replace(/^\{/, "{ passages, page: { onError: report }, ")});`,
        "markStarted();",
        ...(inspector ? ["inspect(player);"] : []),
        "",
      ].join("\n");
    },
    configureServer(server) {
      // Errors in the page, printed where the author is looking.
      server.ws.on(ERROR_EVENT, (data: { message?: string; stack?: string }) => {
        server.config.logger.error(
          `loominate: the game threw an error in the browser: ${data.stack ?? data.message ?? "(no message)"}`,
          { timestamp: true },
        );
      });
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
