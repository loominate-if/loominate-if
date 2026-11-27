# 0133. Playing a game from its archive with a service worker

- **Status:** Accepted, 2026-11-26
- **Issue:** [#152](https://github.com/loominate-if/loominate-if/issues/152), part of [#150](https://github.com/loominate-if/loominate-if/issues/150)
- **Design:** [Build targets and distribution](../DESIGN.md#build-targets-and-distribution), [ADR 0132](0132-loom-archives.md), [ADR 0131](0131-asset-imports.md)

## Context

The design says that in browsers a service worker serves a game's files straight from its `.loom` archive, so game code uses ordinary paths, and that the archive is the one target that needs a loader page. The static build an archive holds names its files by relative paths (`./assets/…`), and files a game imports in `story.ts` are among them. Playing must work offline once the archive is open. The generic player (#153) will open third-party archives in a sandbox, on top of the same pieces.

## Decision

- **`@loominate-if/archive` has both halves.** `serveArchives(self)` is the whole service worker; `mountArchiveLoader(root)` draws the loader page and registers the worker (`sw.js` beside the page unless told otherwise). Also public: `storeArchive`, `archiveResponse`, `contentType`, `gameUrl`, and `archiveKey`, with the cache names and `GAMES_PATH`, for the generic player and wrappers to build on. The worker's scope is typed structurally (`ArchiveWorkerScope`), so the package type-checks with DOM types and no WebWorker types.
- **Opening.** The loader opens the archive its URL's `?archive=` names, fetched without the HTTP cache, or one the player picks with **Open an archive**, a labelled file input. It validates the archive fully (ADR 0132's checks, every file's SHA-256) and lists every problem in an alert, or keeps it and goes to the game. From a URL it replaces the loader in history, so Back doesn't open the game again.
- **Kept under the IFID.** The archive is stored whole in Cache Storage (`loominate-archives`), keyed by its IFID, with its SHA-256 as the ETag. Opening a new version of a game replaces the old; saves, keyed by game ID, carry on.
- **Served at `games/<IFID>/`,** below the worker's scope, so relative paths resolve inside the game. The folder without its slash redirects to it, `""` is the manifest's entry page, names are percent-decoded, and files get a media type from their extension, an ETag from the manifest's SHA-256, and `Range` support for media elements. Only GET and HEAD are answered. The worker reads each archive once and keeps it while its stored ETag is unchanged. A game that hasn't been opened, or a path that isn't an IFID, gets a page saying so, never echoing the path.
- **Offline.** The worker takes over at once (`skipWaiting`, `clients.claim`). Everything else on its origin is network-first, kept in `loominate-player` for when the network's gone, with the loader page matched whatever its query. The loader keeps itself there too, since it loaded before the worker ran, and remembers which IFID each archive URL opened, so offline the same link goes straight to the kept game. `.loom` files aren't kept twice.
- **`loominate play <file>`** validates the archive, bundles the loader (inline in one page) and the worker (a classic script, which every browser runs as a service worker) with Vite, and serves them and the archive, read afresh each request, on `localhost:4180` or `--port`. It's for authors to try an archive as players will.

## Consequences

- An archive plays in any browser with service workers, which need https or localhost; the loader says so where they're missing.
- Games opened in one loader share its origin, so they can reach each other's storage. That's fine for an author's own games, and the reason the generic player (#153) sandboxes third-party ones.
- Each archive is held in memory by the worker while it plays, and whole in Cache Storage; very large media may later want entries kept separately.
- Tauri and Capacitor serve archives through their own protocol handlers (#154, #155), using `archiveResponse`.
