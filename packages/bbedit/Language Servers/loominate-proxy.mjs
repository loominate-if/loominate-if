// The language server BBEdit starts for passage files (#412, ADR 0120). It
// reads the project folder from the editor's `initialize` request, finds the
// language server for it, and hands the connection to that server: the
// game's own, so its compiler matches the game's, or a Loominate IF
// checkout's.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Where a folder, or a folder above it, keeps a language server. */
const PLACES = [
  "node_modules/@loominate-if/language-server/dist/bin.js",
  "packages/language-server/dist/bin.js",
];

/** The language server for `folder`: the nearest at or above it, if any. */
export function serverFor(folder) {
  for (let dir = folder; ; dir = dirname(dir)) {
    for (const place of PLACES) {
      if (existsSync(join(dir, place))) return join(dir, place);
    }
    if (dirname(dir) === dir) return undefined;
  }
}

/** The folder an `initialize` request names: its first workspace folder, or its root. */
export function folderOf(params) {
  const uri = params?.workspaceFolders?.[0]?.uri ?? params?.rootUri;
  if (typeof uri === "string" && uri.startsWith("file:")) return fileURLToPath(uri);
  return typeof params?.rootPath === "string" ? params.rootPath : undefined;
}

/** One LSP message from the front of `buffer`, and the bytes it took, if it's all there. */
export function firstMessage(buffer) {
  const end = buffer.indexOf("\r\n\r\n");
  if (end < 0) return undefined;
  const length = /content-length:\s*(\d+)/i.exec(buffer.subarray(0, end).toString("ascii"));
  if (!length) return undefined;
  const start = end + 4;
  const size = Number(length[1]);
  if (buffer.length < start + size) return undefined;
  return { message: JSON.parse(buffer.subarray(start, start + size).toString("utf8")) };
}

/** Answers the editor's `initialize` with an error, as when there's no server to hand over to. */
function refuse(message, id) {
  const reply = JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32002, message } });
  process.stdout.write(`Content-Length: ${Buffer.byteLength(reply)}\r\n\r\n${reply}`);
  process.stderr.write(`${message}\n`);
}

function main() {
  let buffer = Buffer.alloc(0);
  const read = (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    const first = firstMessage(buffer);
    if (!first) return;
    process.stdin.off("data", read);
    process.stdin.pause();
    const folder = folderOf(first.message.params);
    const entry = folder === undefined ? undefined : serverFor(folder);
    if (entry === undefined) {
      refuse(
        `Loominate IF: no language server for ${folder ?? "this file"}. Install it in your game with \`npm install --save-dev @loominate-if/language-server\`, and open the game's folder. In a Loominate IF checkout, run \`pnpm build\` first.`,
        first.message.id,
      );
      process.exit(1);
    }
    const server = spawn(process.execPath, [entry, "--stdio"], {
      stdio: ["pipe", "inherit", "inherit"],
    });
    server.stdin.write(buffer);
    process.stdin.pipe(server.stdin);
    process.stdin.resume();
    server.on("exit", (code) => process.exit(code ?? 0));
  };
  process.stdin.on("data", read);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
