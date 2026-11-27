#!/usr/bin/env node
/** The `loominate` command. */
import { parseArgs } from "node:util";
import { validate } from "./archive.js";
import { build, dev, test } from "./commands.js";
import { coverage, formatCoverage } from "./coverage.js";
import { storyMap } from "./map/command.js";
import { MAP_PATH } from "./map/page.js";
import { play } from "./play.js";

const HELP = `Usage: loominate <command> [options]

Commands:
  dev      Serve the game, recompiling and reloading as you edit
  build    Build the game in dist/: a static site, one HTML file (--target single), or a .loom archive (--target archive)
  test     Run the game's walkthrough tests, *.test.ts; name files to run only those
  coverage Report what can't be reached, and what the walkthroughs never reach
  map      Write the story map, the game's passages and links, as one HTML file
  validate Check a .loom archive: loominate validate dist/my-game.loom
  play     Play a .loom archive in a browser, as players will: loominate play dist/my-game.loom

Options:
  --root <dir>   The game's folder (default: the current folder)
  --port <n>     The port to serve on (dev, play)
  --open         Open the game in a browser (dev)
  --target <t>   What to build: static (default), single, or archive (build)
  --inspector    Include the inspector, as dev does, e.g. for testers (build)
  --watch        Rerun tests as files change (test)
  --strict       Fail when anything can't be reached, or a walkthrough fails, for CI (coverage)
  --json <file>  Write the report as JSON to this file too (coverage)
  --out <file>   Where to write the map (map; default: dist/story-map.html)
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
      out: { type: "string" },
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
    const url = server.resolvedUrls?.local[0];
    if (url !== undefined) console.log(`  ➜  Story map: ${new URL(MAP_PATH.slice(1), url).href}`);
    server.bindCLIShortcuts({ print: true });
  } else if (command === "build") {
    const target = values.target ?? "static";
    if (target !== "static" && target !== "single" && target !== "archive") {
      throw new Error(
        `There's no build target "${target}". Use --target static, --target single, or --target archive.`,
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
  } else if (command === "map") {
    const result = await storyMap({
      ...(root !== undefined && { root }),
      ...(values.out !== undefined && { out: values.out }),
    });
    const errors =
      result.errors > 0
        ? ` The game has ${String(result.errors)} error${result.errors === 1 ? "" : "s"}; run \`loominate build\` to see them.`
        : "";
    console.log(
      `Wrote the story map, ${String(result.passages)} passage${result.passages === 1 ? "" : "s"}, to ${result.file}.${errors}`,
    );
  } else if (command === "validate") {
    const files = positionals.slice(1);
    if (files.length === 0)
      throw new Error("Name the archive to check: loominate validate my-game.loom");
    for (const file of files) {
      const problems = await validate(file);
      if (problems.length === 0) {
        console.log(`${file}: a valid archive.`);
      } else {
        process.exitCode = 1;
        console.log(`${file}:`);
        for (const p of problems) console.log(`  ${p}`);
      }
    }
  } else if (command === "play") {
    const [file, ...more] = positionals.slice(1);
    if (file === undefined || more.length > 0) {
      throw new Error("Name one archive to play: loominate play dist/my-game.loom");
    }
    const port = values.port === undefined ? undefined : Number(values.port);
    if (port !== undefined && !Number.isInteger(port)) throw new Error("--port must be a number.");
    const server = await play(file, { ...(port !== undefined && { port }) });
    console.log(`Playing ${file} at ${server.url}\nPress Ctrl+C to stop.`);
  } else {
    throw new Error(`There's no command "${command}". Run \`loominate --help\` to see them.`);
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`loominate: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
