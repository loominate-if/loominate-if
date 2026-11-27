/**
 * The loader page (#152, ADR 0133): opens a `.loom` archive, from its URL's
 * `?archive=` or a file the player picks, keeps it for the service worker,
 * and goes to the game.
 */
import {
  ArchiveError,
  readArchive,
  sha256,
  validateArchive,
  type ArchiveManifest,
} from "./archive.js";
import { ARCHIVES_CACHE, archiveKey, gameUrl, PLAYER_CACHE } from "./worker.js";

/**
 * Checks an archive and keeps it in Cache Storage for the service worker
 * whose scope is `scope`, replacing any earlier version of the game.
 * @returns Its manifest.
 * @throws ArchiveError listing every problem, if it isn't an archive that plays.
 */
export async function storeArchive(
  bytes: Uint8Array,
  scope: string,
  storage: CacheStorage,
): Promise<ArchiveManifest> {
  const problems = await validateArchive(bytes);
  if (problems.length > 0) throw new ArchiveError(problems);
  const { manifest } = await readArchive(bytes);
  const cache = await storage.open(ARCHIVES_CACHE);
  await cache.put(
    archiveKey(scope, manifest.ifid),
    new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": "application/zip", ETag: `"${await sha256(bytes)}"` },
    }),
  );
  return manifest;
}

/** Options for {@link mountArchiveLoader}. */
export type LoaderOptions = {
  /** The service worker's script, relative to the page. Defaults to `sw.js`. */
  readonly worker?: string;
};

const FILE_ID = "loominate-archive-file";

/**
 * Draws the loader page in `root`, registers the service worker, and opens
 * the archive the page's `?archive=` names, if any, or the one the player
 * picks. The worker's script must call {@link serveArchives}.
 */
export async function mountArchiveLoader(
  root: HTMLElement,
  options: LoaderOptions = {},
): Promise<void> {
  const doc = root.ownerDocument;
  root.innerHTML = `<main>
<h1>Play a game from its archive</h1>
<p>Open a game's <code>.loom</code> archive to play it in this browser. Once it's open, it plays offline too.</p>
<p><label for="${FILE_ID}">Open an archive</label> <input type="file" id="${FILE_ID}" accept=".loom"></p>
<p role="status"></p>
<div role="alert"></div>
</main>`;
  const input = root.querySelector("input") as HTMLInputElement;
  const status = root.querySelector('[role="status"]') as HTMLElement;
  const alert = root.querySelector('[role="alert"]') as HTMLElement;
  const fail = (title: string, problems: readonly string[]): void => {
    status.textContent = "";
    alert.replaceChildren();
    const heading = doc.createElement("h2");
    heading.textContent = title;
    const list = doc.createElement("ul");
    for (const p of problems)
      list.append(Object.assign(doc.createElement("li"), { textContent: p }));
    alert.append(heading, list);
  };

  const workers = (navigator as Partial<Navigator>).serviceWorker;
  if (!workers || typeof caches === "undefined") {
    input.disabled = true;
    fail("This browser can't play archives here", [
      "Playing an archive needs service workers, which browsers allow only on https:// pages and on localhost.",
    ]);
    return;
  }
  await workers.register(options.worker ?? "sw.js");
  const registration = await workers.ready;
  // Kept for playing offline: the worker only sees what's fetched once it's running.
  const here = new URL(location.href);
  here.search = "";
  here.hash = "";
  caches
    .open(PLAYER_CACHE)
    .then((c) => c.add(here.href))
    .catch(() => undefined);

  const go = (ifid: string, replace: boolean): void => {
    const url = gameUrl(registration.scope, ifid);
    if (replace) location.replace(url);
    else location.assign(url);
  };
  // Which game an archive's URL opened, so it opens offline from the copy kept.
  const opened = (from: URL): string =>
    new URL(`opened?archive=${encodeURIComponent(from.href)}`, registration.scope).href;

  const open = async (
    name: string,
    bytes: () => Promise<Uint8Array | undefined>,
    from?: URL,
  ): Promise<void> => {
    alert.replaceChildren();
    status.textContent = `Opening ${name}…`;
    try {
      const data = await bytes();
      if (!data) return;
      const manifest = await storeArchive(data, registration.scope, caches);
      if (from) {
        const player = await caches.open(PLAYER_CACHE);
        await player.put(opened(from), new Response(manifest.ifid));
      }
      status.textContent = `Starting ${manifest.title}…`;
      // From a URL, Back from the game leaves the loader rather than opening the game again.
      go(manifest.ifid, from !== undefined);
    } catch (e) {
      fail(`${name} can't be played`, e instanceof ArchiveError ? e.problems : [String(e)]);
    }
  };

  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) void open(file.name, async () => new Uint8Array(await file.arrayBuffer()));
  });
  const named = new URLSearchParams(location.search).get("archive");
  if (named !== null && named !== "") {
    const url = new URL(named, location.href);
    const name = decodeURIComponent(url.pathname.split("/").pop() ?? named);
    await open(
      name,
      async () => {
        let response: Response;
        try {
          response = await fetch(url, { cache: "no-cache" });
        } catch {
          const kept = await (await caches.open(PLAYER_CACHE)).match(opened(url));
          if (kept) {
            go(await kept.text(), true);
            return undefined;
          }
          throw new ArchiveError(
            `It couldn't be fetched from ${url.href}: the network can't be reached, and it hasn't been opened here before.`,
          );
        }
        if (!response.ok) {
          throw new ArchiveError(
            `It couldn't be fetched from ${url.href}: ${String(response.status)} ${response.statusText}.`,
          );
        }
        return new Uint8Array(await response.arrayBuffer());
      },
      url,
    );
  }
}
