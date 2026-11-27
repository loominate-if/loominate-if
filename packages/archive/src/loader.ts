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
  await keepArchive(bytes, manifest, scope, storage);
  return manifest;
}

/**
 * Keeps an archive already checked, with its manifest, for the worker whose
 * scope is `scope`, its SHA-256 as its ETag so the worker sees a new version.
 * @internal
 */
export async function keepArchive(
  bytes: Uint8Array,
  manifest: ArchiveManifest,
  scope: string,
  storage: CacheStorage,
): Promise<void> {
  const cache = await storage.open(ARCHIVES_CACHE);
  await cache.put(
    archiveKey(scope, manifest.ifid),
    new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": "application/zip", ETag: `"${await sha256(bytes)}"` },
    }),
  );
}

/** Options for {@link mountArchiveLoader}. */
export type LoaderOptions = {
  /** The service worker's script, relative to the page. Defaults to `sw.js`. */
  readonly worker?: string;
};

const FILE_ID = "loominate-archive-file";

/** How an opener plays what it opens: the loader here, or the generic player. */
export type Opening = {
  /** Plays a checked archive; `fromUrl` if its page's `?archive=` named it. */
  play(bytes: Uint8Array, manifest: ArchiveManifest, fromUrl: boolean): Promise<void>;
  /** Plays the game with this IFID, kept from before, when its archive's URL can't be reached. */
  resume(ifid: string): Promise<void> | void;
};

/** What an opener's page shows, for its plays to use. */
export type OpenerView = {
  readonly main: HTMLElement;
  readonly status: HTMLElement;
  /** Shows what went wrong, in a new alert, with focus on its heading. */
  fail(title: string, problems: readonly string[]): void;
};

/**
 * Draws the page that opens archives, registers its service worker, and
 * opens the archive its `?archive=` names, or the one the player picks,
 * checked, for `opening` to play.
 * @internal
 */
export async function mountOpener(
  root: HTMLElement,
  worker: string,
  opening: (scope: string, view: OpenerView) => Opening,
): Promise<void> {
  const doc = root.ownerDocument;
  root.innerHTML = `<main>
<h1>Play a game from its archive</h1>
<p>Open a game's <code>.loom</code> archive to play it in this browser. Once it's open, it plays offline too.</p>
<p><label for="${FILE_ID}">Open an archive</label> <input type="file" id="${FILE_ID}" accept=".loom"></p>
<p role="status"></p>
</main>`;
  const input = root.querySelector("input") as HTMLInputElement;
  const status = root.querySelector('[role="status"]') as HTMLElement;
  const main = root.querySelector("main") as HTMLElement;
  let alert: HTMLElement | undefined;
  const clear = (): void => {
    alert?.remove();
    alert = undefined;
  };
  const fail = (title: string, problems: readonly string[]): void => {
    status.textContent = "";
    clear();
    // A new alert each time, since screen readers announce one as it's added
    // more reliably than a change inside one already there; and focus on its
    // heading, so it's read even if the announcement is lost, as when the
    // file picker closes and focus comes back to its button.
    alert = doc.createElement("div");
    alert.setAttribute("role", "alert");
    const heading = doc.createElement("h2");
    heading.textContent = title;
    heading.tabIndex = -1;
    // One problem, the usual case, is a paragraph: a list of one is an extra
    // stop for a screen reader.
    let details: HTMLElement;
    if (problems.length === 1) {
      details = Object.assign(doc.createElement("p"), { textContent: problems[0] });
    } else {
      details = doc.createElement("ul");
      for (const p of problems)
        details.append(Object.assign(doc.createElement("li"), { textContent: p }));
    }
    alert.append(heading, details);
    main.append(alert);
    heading.focus();
  };

  const workers = (navigator as Partial<Navigator>).serviceWorker;
  if (!workers || typeof caches === "undefined") {
    input.disabled = true;
    fail("This browser can't play archives here", [
      "Playing an archive needs service workers, which browsers allow only on https:// pages and on localhost.",
    ]);
    return;
  }
  await workers.register(worker);
  const registration = await workers.ready;
  keepPage();
  const plays = opening(registration.scope, { main, status, fail });

  // Which game an archive's URL opened, so it opens offline from the copy kept.
  const opened = (from: URL): string =>
    new URL(`opened?archive=${encodeURIComponent(from.href)}`, registration.scope).href;

  const open = async (
    name: string,
    bytes: () => Promise<Uint8Array | undefined>,
    from?: URL,
  ): Promise<void> => {
    clear();
    status.textContent = `Opening ${name}…`;
    try {
      const data = await bytes();
      if (!data) return;
      const problems = await validateArchive(data);
      if (problems.length > 0) throw new ArchiveError(problems);
      const { manifest } = await readArchive(data);
      if (from) {
        const player = await caches.open(PLAYER_CACHE);
        await player.put(opened(from), new Response(manifest.ifid));
      }
      await plays.play(data, manifest, from !== undefined);
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
            await plays.resume(await kept.text());
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

/**
 * Keeps this page for playing offline: it loaded before its service worker
 * was running, so the worker didn't see it.
 * @internal
 */
export function keepPage(): void {
  const here = new URL(location.href);
  here.search = "";
  here.hash = "";
  caches
    .open(PLAYER_CACHE)
    .then((c) => c.add(here.href))
    .catch(() => undefined);
}

/**
 * Draws the loader page in `root`, registers the service worker, and opens
 * the archive the page's `?archive=` names, if any, or the one the player
 * picks, playing it on this page's own origin. The worker's script must call
 * {@link serveArchives}. To play games someone else made, use the generic
 * player, {@link mountPlayer}, which keeps each apart.
 */
export async function mountArchiveLoader(
  root: HTMLElement,
  options: LoaderOptions = {},
): Promise<void> {
  await mountOpener(root, options.worker ?? "sw.js", (scope, view) => {
    const go = (ifid: string, replace: boolean): void => {
      const url = gameUrl(scope, ifid);
      if (replace) location.replace(url);
      else location.assign(url);
    };
    return {
      async play(bytes, manifest, fromUrl) {
        await keepArchive(bytes, manifest, scope, caches);
        view.status.textContent = `Starting ${manifest.title}…`;
        // From a URL, Back from the game leaves the loader rather than opening the game again.
        go(manifest.ifid, fromUrl);
      },
      resume: (ifid) => {
        go(ifid, true);
      },
    };
  });
}
