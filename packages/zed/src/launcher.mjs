// Starts the language server for the folder Zed opened (#411, ADR 0119): the
// game's own, a Loominate IF checkout's, or the one the extension installed
// from npm. It runs in Node, so it sees the real file system, which the
// extension itself doesn't.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [root = "", installed = ""] = process.argv.splice(2, 2);
const entry = [
  join(root, "node_modules/@loominate-if/language-server/dist/bin.js"),
  join(root, "packages/language-server/dist/bin.js"),
  installed,
].find((path) => path !== "" && existsSync(path));
if (entry === undefined) {
  console.error(
    `Loominate IF: no language server for ${root}. Install it in your game with \`npm install --save-dev @loominate-if/language-server\`, and open the game's folder. In a Loominate IF checkout, run \`pnpm build\` first.`,
  );
  process.exit(1);
}
await import(pathToFileURL(entry).href);
