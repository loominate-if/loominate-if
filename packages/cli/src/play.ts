/**
 * `loominate play` (#152, ADR 0133): serves the loader page and the service
 * worker that play a `.loom` archive in a browser, with the archive beside
 * them, to try an archive as players will.
 */
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateArchive } from "@loominate-if/archive";
import { build, type Plugin, type Rolldown } from "vite";

/** Options for {@link play}. */
export type PlayOptions = {
  /** The port to serve on. Defaults to 4180; 0 picks a free one. */
  readonly port?: number;
  /** Extra resolve conditions, as `["source"]` in the repository's own tests. */
  readonly conditions?: readonly string[];
};

/** The server {@link play} started. */
export type PlayServer = {
  /** The loader page, opening the archive. */
  readonly url: string;
  /** Stops serving. */
  close(): Promise<void>;
};

const LOADER = "\0loominate-loader";
const WORKER = "\0loominate-worker";
const SCRIPTS: Readonly<Record<string, string>> = {
  [LOADER]: `import { mountArchiveLoader } from "@loominate-if/archive";
await mountArchiveLoader(document.body);
`,
  [WORKER]: `import { serveArchives } from "@loominate-if/archive";
serveArchives(self);
`,
};

/** One of the scripts, bundled: the loader as a module, the worker as a classic script. */
async function bundle(id: string, conditions: readonly string[]): Promise<string> {
  const entry: Plugin = {
    name: "loominate-player-entry",
    resolveId: (source) => (source === id ? id : undefined),
    load: (source) => (source === id ? SCRIPTS[id] : undefined),
  };
  const output = await build({
    configFile: false,
    // The archive package resolves from this one, which depends on it.
    root: path.dirname(fileURLToPath(import.meta.url)),
    logLevel: "warn",
    ...(conditions.length > 0 && {
      resolve: { conditions: [...conditions, "module", "browser", "development|production"] },
    }),
    plugins: [entry],
    build: {
      write: false,
      modulePreload: false,
      rolldownOptions: {
        input: id,
        output: { codeSplitting: false, format: id === WORKER ? "iife" : "es" },
      },
    },
  });
  const outputs = (Array.isArray(output) ? output : [output]) as Rolldown.RolldownOutput[];
  const chunk = outputs
    .flatMap((o) => o.output)
    .find((c): c is Rolldown.OutputChunk => c.type === "chunk" && c.isEntry);
  if (!chunk) throw new Error("The player's scripts didn't build.");
  return chunk.code;
}

/** The loader page, its script inline, so it's one file to keep for playing offline. */
function loaderPage(script: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Loominate IF player</title>
<style>body { font: 1.1rem/1.5 system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; } [role="alert"] { color: #b00020; } @media (prefers-color-scheme: dark) { body { background: #121212; color: #eee; } [role="alert"] { color: #ff8a80; } }</style>
</head>
<body>
<script type="module">${script.replace(/<\/(script)/gi, "<\\/$1")}</script>
</body>
</html>
`;
}

/**
 * Serves the player for `file`, a `.loom` archive, on localhost: the loader
 * page, the service worker, and the archive, read afresh on each request so
 * a rebuilt archive is the one played.
 * @throws Error if `file` isn't an archive that plays, listing why.
 */
export async function play(file: string, options: PlayOptions = {}): Promise<PlayServer> {
  const problems = await validateArchive(new Uint8Array(await readFile(file)));
  if (problems.length > 0) {
    throw new Error(`${file} can't be played:\n  ${problems.join("\n  ")}`);
  }
  const conditions = options.conditions ?? [];
  const [loader, worker] = await Promise.all([
    bundle(LOADER, conditions),
    bundle(WORKER, conditions),
  ]);
  const page = loaderPage(loader);
  const name = path.basename(file);
  const server = createServer((request, response) => {
    const at = new URL(request.url ?? "/", "http://localhost").pathname;
    const send = (type: string, body: string | Uint8Array): void => {
      // No-cache: the worker keeps what's needed offline, and a rebuild is seen at once.
      response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
      response.end(request.method === "HEAD" ? undefined : body);
    };
    if (at === "/" || at === "/index.html") send("text/html; charset=utf-8", page);
    else if (at === "/sw.js") send("text/javascript; charset=utf-8", worker);
    else if (decodeURIComponent(at) === `/${name}`) {
      readFile(file).then(
        (bytes) => send("application/zip", bytes),
        () => {
          response.writeHead(404).end(`${name} is gone.`);
        },
      );
    } else {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(`There's no ${at} here.`);
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 4180, "localhost", resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://localhost:${String(port)}/?archive=${encodeURIComponent(name)}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((e) => (e ? reject(e) : resolve()));
      }),
  };
}
