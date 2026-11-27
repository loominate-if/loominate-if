/**
 * The service worker that plays games from their archives (#152, ADR 0133).
 * The loader page keeps each archive opened in Cache Storage, under its
 * IFID; the worker serves its files at `games/<IFID>/…`, below its own scope,
 * so a game's ordinary relative paths work, and keeps the loader page and
 * what it fetched, so both work offline.
 */
import { isIfid, readArchive, type Archive } from "./archive.js";
import { archiveResponse } from "./serve.js";

/** The folder, below the worker's scope, that games are served from. */
export const GAMES_PATH = "games/";
/** The cache that holds archives the loader opened. */
export const ARCHIVES_CACHE = "loominate-archives";
/** The cache that holds the loader page and what it fetched, for playing offline. */
export const PLAYER_CACHE = "loominate-player";

/** The URL of the game with this IFID, below the worker's `scope`. */
export function gameUrl(scope: string, ifid: string): string {
  return new URL(`${GAMES_PATH}${ifid.toUpperCase()}/`, scope).href;
}

/** Where the archive with this IFID is kept in {@link ARCHIVES_CACHE}. */
export function archiveKey(scope: string, ifid: string): string {
  return new URL(`archives/${ifid.toUpperCase()}.loom`, scope).href;
}

/** An event whose handler can keep the worker alive until a promise settles. */
export type WorkerEvent = { waitUntil(work: Promise<unknown>): void };

/** A request the worker can answer, as a `FetchEvent` has it. */
export type WorkerFetchEvent = {
  readonly request: Request;
  respondWith(response: Promise<Response>): void;
};

/** What {@link serveArchives} uses of a service worker's global scope, `self`. */
export type ArchiveWorkerScope = {
  readonly registration: { readonly scope: string };
  readonly caches: CacheStorage;
  readonly clients: { claim(): Promise<void> };
  fetch(request: Request): Promise<Response>;
  skipWaiting(): Promise<void>;
  addEventListener(type: "install" | "activate", listener: (event: WorkerEvent) => void): void;
  addEventListener(type: "fetch", listener: (event: WorkerFetchEvent) => void): void;
};

const escape = (text: string): string =>
  text.replace(/[&<>"]/g, (c) => `&#${String(c.charCodeAt(0))};`);

const page = (status: number, title: string, body: string): Response =>
  new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><main><h1>${title}</h1>${body}</main></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );

/**
 * Makes `worker` serve games from archives the loader page opened: called
 * from the service worker's script with its `self`. The worker takes over at
 * once, so a game opened from the first visit plays from its archive.
 */
export function serveArchives(worker: ArchiveWorkerScope): void {
  const scope = worker.registration.scope;
  const games = new URL(GAMES_PATH, scope);
  // An archive read once, kept while its stored copy is the same.
  const opened = new Map<string, { tag: string; archive: Promise<Archive> }>();

  async function archive(ifid: string): Promise<Archive | undefined> {
    const stored = await (await worker.caches.open(ARCHIVES_CACHE)).match(archiveKey(scope, ifid));
    if (!stored) return undefined;
    const tag = stored.headers.get("ETag") ?? "";
    const known = opened.get(ifid);
    if (known && known.tag === tag && tag !== "") return known.archive;
    const reading = stored.arrayBuffer().then((b) => readArchive(new Uint8Array(b)));
    opened.set(ifid, { tag, archive: reading });
    reading.catch(() => opened.delete(ifid));
    return reading;
  }

  async function serveGame(request: Request, ifid: string, path: string): Promise<Response> {
    let found: Archive | undefined;
    try {
      found = await archive(ifid);
    } catch (e) {
      return page(
        500,
        "This game's archive is damaged",
        `<p>${escape(e instanceof Error ? e.message : String(e))}</p>`,
      );
    }
    if (!found) {
      return page(
        404,
        "This game isn't here",
        `<p>No game with the IFID ${ifid} has been opened in this browser. <a href="${scope}">Open its archive</a> to play it.</p>`,
      );
    }
    return archiveResponse(found, path, request);
  }

  async function fromNetwork(request: Request): Promise<Response> {
    const cache = await worker.caches.open(PLAYER_CACHE);
    try {
      const response = await worker.fetch(request);
      // Archives are kept by the loader, under their IFIDs, not twice.
      if (response.ok && !new URL(request.url).pathname.endsWith(".loom")) {
        await cache.put(request, response.clone());
      }
      return response;
    } catch (e) {
      // Offline: what was fetched last, and the loader page whatever its URL's query.
      const kept = await cache.match(request, { ignoreSearch: request.mode === "navigate" });
      if (kept) return kept;
      throw e;
    }
  }

  worker.addEventListener("install", (event) => {
    event.waitUntil(worker.skipWaiting());
  });
  worker.addEventListener("activate", (event) => {
    event.waitUntil(worker.clients.claim());
  });
  worker.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);
    if (url.origin !== games.origin || event.request.method === "POST") return;
    if (url.pathname.startsWith(games.pathname)) {
      const rest = url.pathname.slice(games.pathname.length);
      const slash = rest.indexOf("/");
      const ifid = (slash < 0 ? rest : rest.slice(0, slash)).toUpperCase();
      if (!isIfid(ifid)) {
        event.respondWith(
          Promise.resolve(
            page(
              404,
              "There's no game here",
              `<p><a href="${scope}">Open a game's archive</a> to play it.</p>`,
            ),
          ),
        );
        return;
      }
      if (slash < 0) {
        // The game's folder, so its relative paths resolve below it.
        event.respondWith(Promise.resolve(Response.redirect(gameUrl(scope, ifid), 301)));
        return;
      }
      event.respondWith(serveGame(event.request, ifid, rest.slice(slash + 1)));
      return;
    }
    if (event.request.method === "GET") event.respondWith(fromNetwork(event.request));
  });
}
