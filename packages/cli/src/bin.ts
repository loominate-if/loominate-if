#!/usr/bin/env node
/** The `loominate` command. */
import { parseArgs } from "node:util";
import { build, dev } from "./commands.js";

const HELP = `Usage: loominate <command> [options]

Commands:
  dev      Serve the game, recompiling and reloading as you edit
  build    Build the game as a static site in dist/

Options:
  --root <dir>   The game's folder (default: the current folder)
  --port <n>     The dev server's port
  --open         Open the game in a browser (dev)
  -h, --help     Show this help`;

async function main(argv: readonly string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      root: { type: "string" },
      port: { type: "string" },
      open: { type: "boolean" },
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
  if (command === "dev") {
    const port = values.port === undefined ? undefined : Number(values.port);
    if (port !== undefined && !Number.isInteger(port)) throw new Error("--port must be a number.");
    const server = await dev({
      ...(root !== undefined && { root }),
      vite: { server: { ...(port !== undefined && { port }), ...(values.open && { open: true }) } },
    });
    await server.listen();
    server.printUrls();
    server.bindCLIShortcuts({ print: true });
  } else if (command === "build") {
    await build({ ...(root !== undefined && { root }) });
  } else {
    throw new Error(`There's no command "${command}". Run \`loominate --help\` to see them.`);
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`loominate: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
