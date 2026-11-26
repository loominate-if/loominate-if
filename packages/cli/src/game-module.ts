/**
 * The code that loads a game in Node, as coverage and the story map do: its
 * packages, in the config's order, then its passage files.
 */
import { PASSAGE_EXTENSION } from "@loominate-if/compiler";
import type { ResolvedConfig } from "./config/config.js";
import { gameFiles } from "./vite/plugin.js";

/** The game's passage files, imported, and the passages a player can visit. */
export function gameModule(config: ResolvedConfig, sectioned: readonly string[]): string[] {
  const files = gameFiles(config.root)
    .map((f) => f.path)
    .filter((p) => p.endsWith(PASSAGE_EXTENSION));
  return [
    // The listed packages first, in order, as the game loads them, so their checks are registered.
    ...config.runtimePackages.map((p) => `import ${JSON.stringify(p)};`),
    ...files.map((file, i) => `import { passages as p${String(i)} } from ${JSON.stringify(file)};`),
    `const passages = [${files.map((_, i) => `...p${String(i)}`).join(", ")}];`,
    `const sectioned = new Set(${JSON.stringify(sectioned)});`,
    "const shown = passages.filter((p) => !sectioned.has(p.id));",
  ];
}
