/**
 * Public API surface check (AGENTS.md design principle 9).
 *
 * Each package has exactly one public entry point, `exports["."]`. API Extractor
 * writes that entry's surface to `packages/<pkg>/api/<pkg>.api.md`, which is
 * committed, so any change to public API shows up in the PR diff. Run against the
 * built `.d.ts` files, so `tsc -b` must run first.
 *
 *   node scripts/api-report.ts           fail if any report is out of date (CI)
 *   node scripts/api-report.ts --update  rewrite the reports
 */
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Extractor,
  ExtractorConfig,
  ExtractorLogLevel,
  type ExtractorMessage,
  type IConfigFile,
} from "@microsoft/api-extractor";
import { listPackages } from "./workspace.ts";

/** Returns why a package's `exports` field isn't a single public entry, or undefined if it is. */
export function checkEntryPoint(json: Record<string, unknown>): string | undefined {
  const exports = json.exports;
  if (typeof exports !== "object" || exports === null) {
    return `has no "exports" field; declare one public entry as exports["."].`;
  }
  const keys = Object.keys(exports);
  if (keys.length !== 1 || keys[0] !== ".") {
    return `exports ${keys.map((k) => `"${k}"`).join(", ")}; a package has exactly one public entry, exports["."]. Mark anything else @internal and keep it behind that entry.`;
  }
  const entry = (exports as Record<string, unknown>)["."];
  if (typeof entry !== "object" || entry === null || !("types" in entry) || !("source" in entry)) {
    return `exports["."] needs "source", "types", and "default" conditions.`;
  }
  return undefined;
}

export function extractorConfig(packageDir: string): IConfigFile {
  return {
    projectFolder: packageDir,
    mainEntryPointFilePath: "<projectFolder>/dist/index.d.ts",
    compiler: {
      tsconfigFilePath: "<projectFolder>/tsconfig.json",
      // Workspace packages resolve to their source for tests; the report reads
      // each dependency's built declarations, as a consumer would.
      overrideTsconfig: {
        extends: "./tsconfig.json",
        compilerOptions: { customConditions: [] },
      },
    },
    apiReport: {
      enabled: true,
      reportFolder: "<projectFolder>/api/",
      reportTempFolder: "<projectFolder>/dist/api-report/",
    },
    docModel: { enabled: false },
    dtsRollup: { enabled: false },
    tsdocMetadata: { enabled: false },
    newlineKind: "lf",
    messages: {
      // Problems go to the console, where they fail CI, rather than into the report.
      // This replaces API Extractor's defaults, which bury several of them in the report.
      extractorMessageReporting: {
        default: { logLevel: ExtractorLogLevel.Warning, addToApiReportFile: false },
        // Exports are public unless tagged @internal, so @public tags would be noise.
        "ae-missing-release-tag": { logLevel: ExtractorLogLevel.None },
        // Public API is author-facing, so every export needs a doc comment.
        "ae-undocumented": { logLevel: ExtractorLogLevel.Warning, addToApiReportFile: false },
      },
      tsdocMessageReporting: {
        default: { logLevel: ExtractorLogLevel.Warning, addToApiReportFile: false },
      },
      compilerMessageReporting: {
        default: { logLevel: ExtractorLogLevel.Warning, addToApiReportFile: false },
      },
    },
  };
}

/** Runs API Extractor on one package. Returns true when its report is current (or was updated). */
export function runExtractor(
  packageDir: string,
  update: boolean,
  messageCallback?: (message: ExtractorMessage) => void,
): boolean {
  if (update) mkdirSync(join(packageDir, "api"), { recursive: true });
  const config = ExtractorConfig.prepare({
    configObject: extractorConfig(packageDir),
    configObjectFullPath: undefined,
    packageJsonFullPath: join(packageDir, "package.json"),
  });
  const result = Extractor.invoke(config, {
    localBuild: update,
    printApiReportDiff: !update,
    ...(messageCallback && { messageCallback }),
  });
  return result.succeeded;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const update = process.argv.includes("--update");
  let ok = true;
  for (const pkg of listPackages(repo)) {
    if (pkg.dir.startsWith("examples/")) continue;
    // A package that isn't TypeScript, as the Tree-sitter grammar (#411), has no API to report.
    if (!existsSync(join(repo, pkg.dir, "tsconfig.json"))) continue;
    // A private package with no entry point, as the VS Code extension (#414), has no public API.
    if (pkg.json.private === true && pkg.json.exports === undefined) continue;
    const why = checkEntryPoint(pkg.json);
    if (why) {
      console.error(`api-report: ${pkg.dir}/package.json ${why}`);
      ok = false;
      continue;
    }
    if (!runExtractor(join(repo, pkg.dir), update)) ok = false;
  }
  if (!ok) {
    console.error(
      update
        ? "api-report: fix the errors above."
        : "api-report: public API changed or has problems. If the change is intended, run `pnpm api:update` and commit the reports.",
    );
    process.exitCode = 1;
  }
}
