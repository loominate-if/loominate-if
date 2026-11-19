/**
 * Loads the game for walkthrough tests (#54, ADR 0026): a setup module,
 * generated from the game's config, that gives `@loominate-if/testing` every
 * passage file and the start passage, so `play()` needs no arguments.
 */
import { PASSAGE_EXTENSION } from "@loominate-if/compiler";
import type { Plugin } from "vite";
import type { ResolvedConfig } from "../config/config.js";
import { gameFiles } from "./plugin.js";

/** The setup module `loominate test` runs before each test file. */
export const WALKTHROUGH_SETUP = "/@loominate/walkthrough";
const RESOLVED = "\0loominate:walkthrough";

/** Serves the walkthrough setup module. */
export function loominateWalkthrough(config: ResolvedConfig): Plugin {
  return {
    name: "loominate-walkthrough",
    resolveId(source) {
      return source === WALKTHROUGH_SETUP ? RESOLVED : undefined;
    },
    load(id) {
      if (id !== RESOLVED) return;
      const files = gameFiles(config.root)
        .map((f) => f.path)
        .filter((p) => p.endsWith(PASSAGE_EXTENSION));
      return [
        'import { _setGame } from "@loominate-if/testing";',
        ...files.map(
          (file, i) => `import { passages as p${String(i)} } from ${JSON.stringify(file)};`,
        ),
        `_setGame({ passages: [${files.map((_, i) => `...p${String(i)}`).join(", ")}], start: ${JSON.stringify(config.start)} });`,
        "",
      ].join("\n");
    },
  };
}
