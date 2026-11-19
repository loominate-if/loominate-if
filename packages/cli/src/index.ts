/**
 * @packageDocumentation
 * The `loominate` command: dev server, test runner, builds, story map, coverage.
 */
export { formatDiagnostic, gameFiles, loominate, type LoominateOptions } from "./vite/plugin.js";
export {
  CONFIG_FILE,
  defineConfig,
  loadConfig,
  type LoadConfigOptions,
  type LoominateConfig,
  type ResolvedConfig,
} from "./config/config.js";
export { build, dev, type CommandOptions } from "./commands.js";
export { MAIN, loominateApp } from "./vite/app.js";
