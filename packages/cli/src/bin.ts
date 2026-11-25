#!/usr/bin/env node
/** The `loominate` command. */
import { parseArgs } from "node:util";
import { build, dev, test } from "./commands.js";
import { coverage, formatCoverage } from "./coverage.js";

const HELP = `Usage: loominate <command> [options]

Commands:
  dev      Serve the game, recompiling and reloading as you edit
  build    Build the game in dist/: a static site, or with --target single, one HTML file
  test     Run the game's walkthrough tests, *.test.ts; name files to run only those
  coverage Report what can't be reached, and what the walkthroughs never reach

Options:
  --root <dir>   The game's folder (default: the current folder)
  --port <n>     The dev server's port
  --open         Open the game in a browser (dev)
  --target <t>   What to build: static (default) or single (build)
  --inspector    Include the inspector, as dev does, e.g. for testers (build)
  --watch        Rerun tests as files change (test)
  --strict       Fail when anything can't be reached, or a walkthrough fails, for CI (coverage)
  --json <file>  Write the report as JSON to this file too (coverage)
  --verbose      Show every error, including those that likely follow from another
  -h, --help     Show this help`;

async function main(argv: readonly string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      root: { type: "string" },
      port: { type: "string" },
      open: { type: "boolean" },
      target: { type: "string" },
      inspector: { type: "boolean" },
      watch: { type: "boolean" },
      strict: { type: "boolean" },
      json: { type: "string" },
      verbose: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command] = positionals;
  if (values.help || command === undefined) {
    console.log(HELP);
    if (command === undefined && !values.help) process.exitCode = 1;
    return;
  }
  const root = values.root;
  const verbose = values.verbose === true ? { verbose: true } : {};
  if (command === "dev") {
    const port = values.port === undefined ? undefined : Number(values.port);
    if (port !== undefined && !Number.isInteger(port)) throw new Error("--port must be a number.");
    const server = await dev({
      ...(root !== undefined && { root }),
      ...verbose,
      vite: { server: { ...(port !== undefined && { port }), ...(values.open && { open: true }) } },
    });
    await server.listen();
    server.printUrls();
    server.bindCLIShortcuts({ print: true });
  } else if (command === "build") {
    const target = values.target ?? "static";
    if (target !== "static" && target !== "single") {
      throw new Error(
        `There's no build target "${target}". Use --target static or --target single.`,
      );
    }
    await build({
      ...(root !== undefined && { root }),
      ...verbose,
      target,
      ...(values.inspector && { inspector: true }),
    });
  } else if (command === "test") {
    const result = await test({
      ...(root !== undefined && { root }),
      ...verbose,
      filters: positionals.slice(1),
      ...(values.watch && { watch: true }),
    });
    if (!result.passed) process.exitCode = 1;
  } else if (command === "coverage") {
    const report = await coverage({
      ...(root !== undefined && { root }),
      ...verbose,
      ...(values.json !== undefined && { json: values.json }),
    });
    process.stdout.write(formatCoverage(report));
    if (values.strict && (report.unreachable.length > 0 || report.walkthroughs.failed > 0)) {
      process.exitCode = 1;
    }
  } else {
    throw new Error(`There's no command "${command}". Run \`loominate --help\` to see them.`);
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`loominate: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
