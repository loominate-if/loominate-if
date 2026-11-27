/**
 * `loominate play` (#152, #153, ADRs 0133 and 0134): serves the generic
 * player for a `.loom` archive on localhost, as players will meet it: the
 * player page on `localhost`, and each game on its own origin,
 * `<ifid>.localhost`, in a sandboxed iframe.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isIfid, validateArchive } from "@loominate-if/archive";
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

const PLAYER = "\0loominate-player";
const PLAYER_WORKER = "\0loominate-player-worker";
const HOST = "\0loominate-game-host";
const GAME_WORKER = "\0loominate-game-worker";
/** The player's origin, from a page on it or on a game's: the same port, on plain localhost. */
const PLAYER_ORIGIN = `(location.protocol + "//localhost" + (location.port ? ":" + location.port : ""))`;
const SCRIPTS: Readonly<Record<string, string>> = {
  [PLAYER]: `import { mountPlayer } from "@loominate-if/archive";
await mountPlayer(document.body, {
  gameOrigin: (ifid) => location.protocol + "//" + ifid.toLowerCase() + ".localhost" + (location.port ? ":" + location.port : ""),
});
`,
  [PLAYER_WORKER]: `import { keepOffline } from "@loominate-if/archive";
keepOffline(self);
`,
  [HOST]: `import { mountGameHost } from "@loominate-if/archive";
await mountGameHost(document.body, { player: ${PLAYER_ORIGIN} });
`,
  [GAME_WORKER]: `import { sandboxPolicy, serveArchives } from "@loominate-if/archive";
serveArchives(self, { policy: sandboxPolicy(${PLAYER_ORIGIN}) });
`,
};
const WORKERS = new Set([PLAYER_WORKER, GAME_WORKER]);

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
        output: { codeSplitting: false, format: WORKERS.has(id) ? "iife" : "es" },
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

/** A page with its script inline, so it's one file to keep for playing offline. */
function page(title: string, script: string): { html: string; hash: string } {
  const code = script.replace(/<\/(script)/gi, "<\\/$1");
  return {
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>body { font: 1.1rem/1.5 system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; } [role="alert"] { color: #b00020; } @media (prefers-color-scheme: dark) { body { background: #121212; color: #eee; } [role="alert"] { color: #ff8a80; } }</style>
</head>
<body>
<script type="module">${code}</script>
</body>
</html>
`,
    hash: `'sha256-${createHash("sha256").update(code).digest("base64")}'`,
  };
}

/**
 * Serves the generic player for `file`, a `.loom` archive, on localhost: the
 * player page, its service worker, and the archive, read afresh on each
 * request so a rebuilt archive is the one played, on `localhost`; and each
 * game's host page and service worker on `<ifid>.localhost`. Any other host
 * name is refused, so another site can't reach it by DNS.
 * @throws Error if `file` isn't an archive that plays, listing why.
 */
export async function play(file: string, options: PlayOptions = {}): Promise<PlayServer> {
  const problems = await validateArchive(new Uint8Array(await readFile(file)));
  if (problems.length > 0) {
    throw new Error(`${file} can't be played:\n  ${problems.join("\n  ")}`);
  }
  const conditions = options.conditions ?? [];
  const [player, playerWorker, host, gameWorker] = await Promise.all(
    [PLAYER, PLAYER_WORKER, HOST, GAME_WORKER].map((id) => bundle(id, conditions)),
  );
  const playerPage = page("Loominate IF player", player as string);
  const hostPage = page("Opening the game", host as string);
  const name = path.basename(file);
  let port = options.port ?? 4180;

  const handle = (request: IncomingMessage, response: ServerResponse): void => {
    const at = new URL(request.url ?? "/", "http://localhost").pathname;
    const send = (type: string, body: string | Uint8Array, policy?: string): void => {
      response.writeHead(200, {
        "Content-Type": type,
        // No-cache: the workers keep what's needed offline, and a rebuild is seen at once.
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
        ...(policy !== undefined && { "Content-Security-Policy": policy }),
      });
      response.end(request.method === "HEAD" ? undefined : body);
    };
    const missing = (): void => {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(`There's no ${at} here.`);
    };
    const playerOrigin = `http://localhost:${String(port)}`;
    const hostName = (request.headers.host ?? "").toLowerCase();
    if (hostName === `127.0.0.1:${String(port)}` || hostName === `[::1]:${String(port)}`) {
      // Games' origins are below localhost, so the player is there too.
      response.writeHead(307, { Location: `${playerOrigin}${request.url ?? "/"}` }).end();
      return;
    }
    if (hostName === `localhost:${String(port)}`) {
      if (at === "/" || at === "/index.html") {
        send(
          "text/html; charset=utf-8",
          playerPage.html,
          `default-src 'self'; script-src ${playerPage.hash}; style-src 'unsafe-inline'; worker-src 'self'; frame-src http://*.localhost:${String(port)}; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
        );
      } else if (at === "/sw.js") send("text/javascript; charset=utf-8", playerWorker as string);
      else if (decodeURIComponent(at) === `/${name}`) {
        readFile(file).then(
          (bytes) => {
            send("application/zip", bytes);
          },
          () => {
            response.writeHead(404).end(`${name} is gone.`);
          },
        );
      } else missing();
      return;
    }
    const sub = hostName.endsWith(`.localhost:${String(port)}`) ? hostName.split(".")[0] : "";
    if (sub !== undefined && isIfid(sub)) {
      if (at === "/") {
        send(
          "text/html; charset=utf-8",
          hostPage.html,
          `default-src 'self'; script-src ${hostPage.hash}; style-src 'unsafe-inline'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${playerOrigin}`,
        );
      } else if (at === "/sw.js") send("text/javascript; charset=utf-8", gameWorker as string);
      // A game's own files come from its archive, through its worker, never from here.
      else missing();
      return;
    }
    response.writeHead(421, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(`This server plays ${name} at ${playerOrigin}/.`);
  };

  // Both loopback addresses, since browsers may take localhost, and its
  // subdomains, as either.
  const servers: Server[] = [];
  const listen = (address: string): Promise<void> =>
    new Promise((resolve, reject) => {
      const server = createServer(handle);
      server.once("error", reject);
      server.listen(port, address, () => {
        servers.push(server);
        port = (server.address() as AddressInfo).port;
        resolve();
      });
    });
  await listen("127.0.0.1");
  // Without IPv6, or with ::1 taken, 127.0.0.1 is enough.
  await listen("::1").catch(() => undefined);
  return {
    url: `http://localhost:${String(port)}/?archive=${encodeURIComponent(name)}`,
    close: () =>
      Promise.all(
        servers.map(
          (server) =>
            new Promise<void>((resolve, reject) => {
              server.close((e) => (e ? reject(e) : resolve()));
            }),
        ),
      ).then(() => undefined),
  };
}
