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
export {
  build,
  dev,
  type BuildOptions,
  type BuildTarget,
  type CommandOptions,
  test,
  type TestOptions,
  type TestResult,
} from "./commands.js";
export {
  coverage,
  formatCoverage,
  type CoverageOptions,
  type CoverageReport,
  type NotReachedEntry,
  type UnreachableEntry,
} from "./coverage.js";
export { MAIN, loominateApp, type AppOptions } from "./vite/app.js";
export { storyMap, type MapOptions, type MapResult } from "./map/command.js";
export { loominateWalkthrough, WALKTHROUGH_SETUP } from "./vite/walkthrough.js";
