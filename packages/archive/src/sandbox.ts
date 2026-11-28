/**
 * The generic player (#153, ADR 0134): opens archives anyone made, and plays
 * each in a sandboxed iframe on an origin of its own, under a strict content
 * security policy, so a game can't reach the player, other games, or the
 * network. The player page hands the archive to the game's host page, on
 * the game's origin, which keeps it for that origin's service worker.
 */
import { ArchiveError, isIfid, readArchive, type ArchiveManifest } from "./archive.js";
import { keepArchive, keepPage, mountOpener, pageScripts } from "./loader.js";
import { archiveKey, ARCHIVES_CACHE, gameUrl } from "./worker.js";

/**
 * What a game's iframe may do: run scripts, on its own origin (never the
 * player's), submit forms to its own handlers, and download files, as save
 * export does. No top navigation, popups, modal dialogs, or pointer lock.
 */
export const PLAYER_SANDBOX = "allow-scripts allow-same-origin allow-forms allow-downloads";

/** Options for {@link mountPlayer}. */
export type PlayerOptions = {
  /**
   * The origin each game plays on, from its IFID: one per game, and never
   * the player's own, such as `https://<ifid>.games.example`. Its `/` must
   * serve the game host page ({@link mountGameHost}), and `/sw.js` a
   * service worker that calls {@link serveArchives} with
   * {@link sandboxPolicy}.
   */
  gameOrigin(ifid: string): string;
  /** The player's own service worker, relative to the page, calling {@link keepOffline}. Defaults to `sw.js`. */
  readonly worker?: string;
};

/** Options for {@link mountGameHost}. */
export type GameHostOptions = {
  /** The player's origin: the only page this host takes archives from. */
  readonly player: string;
  /** The game origin's service worker, relative to the page. Defaults to `sw.js`. */
  readonly worker?: string;
};

/** A message between the player page and a game's host page. */
type HostMessage =
  | { readonly type: "loominate-ready" }
  | { readonly type: "loominate-failed"; readonly problems: readonly string[] }
  | { readonly type: "loominate-open"; readonly archive: ArrayBuffer }
  | { readonly type: "loominate-resume" };

const isMessage = (data: unknown): data is HostMessage =>
  typeof data === "object" &&
  data !== null &&
  typeof (data as { type?: unknown }).type === "string";

/** What the player remembers of each game it opened, by IFID, to notice one claiming another's. */
const KNOWN = "loominate-player-games";
type Known = Record<string, { readonly id: string; readonly title: string }>;

function known(): Known {
  try {
    return JSON.parse(localStorage.getItem(KNOWN) ?? "{}") as Known;
  } catch {
    return {};
  }
}

function remember(manifest: ArchiveManifest): void {
  try {
    localStorage.setItem(
      KNOWN,
      JSON.stringify({
        ...known(),
        [manifest.ifid]: { id: manifest.game.id, title: manifest.title },
      }),
    );
  } catch {
    // Without storage, only the check of the next one is lost.
  }
}

const STYLE = `.loominate-player { position: fixed; inset: 0; display: flex; flex-direction: column; }
.loominate-player-bar { display: flex; gap: 1rem; align-items: baseline; justify-content: space-between; padding: 0.25rem 1rem; font-size: 0.9rem; border-bottom: 1px solid color-mix(in srgb, currentColor 25%, transparent); }
.loominate-player-bar p { margin: 0; }
.loominate-player > iframe { flex: 1; border: 0; width: 100%; }`;

/**
 * Draws the generic player in `root`: the loader page, opening an archive
 * from the page's `?archive=` or the player's pick, then the game in a
 * sandboxed iframe on its own origin, under a bar naming it, with a link to
 * open another. A game that says it's one the player opened before, by its
 * IFID, but is a different game, is opened only if the player agrees.
 */
export async function mountPlayer(root: HTMLElement, options: PlayerOptions): Promise<void> {
  const doc = root.ownerDocument;
  await mountOpener(root, options.worker ?? "sw.js", (_scope, view) => {
    /** Shows the game, handing its host the archive, or asking it to play the one kept. */
    const show = (ifid: string, title: string, archive?: Uint8Array): void => {
      const origin = new URL(options.gameOrigin(ifid)).origin;
      if (origin === location.origin) {
        view.fail(`${title} can't be played`, [
          "The player's games must each have an origin of their own, not the player's.",
        ]);
        return;
      }
      const frame = doc.createElement("iframe");
      frame.title = title;
      frame.setAttribute("sandbox", PLAYER_SANDBOX);
      frame.allow = "autoplay";
      frame.referrerPolicy = "no-referrer";
      frame.src = `${origin}/`;
      let sent = false;
      const listen = (event: MessageEvent): void => {
        if (event.source !== frame.contentWindow || event.origin !== origin) return;
        if (!isMessage(event.data)) return;
        if (event.data.type === "loominate-ready" && !sent) {
          sent = true;
          const message: HostMessage = archive
            ? { type: "loominate-open", archive: archive.slice().buffer }
            : { type: "loominate-resume" };
          frame.contentWindow?.postMessage(
            message,
            origin,
            message.type === "loominate-open" ? [message.archive] : [],
          );
        } else if (event.data.type === "loominate-failed") {
          removeEventListener("message", listen);
          root.replaceChildren(...kept);
          view.fail(`${title} can't be played`, event.data.problems.map(String));
        }
      };
      addEventListener("message", listen);
      // Each time the frame loads, the host and then the game, the player is in it.
      frame.addEventListener("load", () => {
        frame.focus();
      });
      const kept = [...root.childNodes];
      const style = doc.createElement("style");
      style.textContent = STYLE;
      const shell = doc.createElement("div");
      shell.className = "loominate-player";
      // Not a <header>: as a banner landmark, VoiceOver names it and reads
      // nothing more until the player interacts with it.
      const bar = doc.createElement("div");
      bar.className = "loominate-player-bar";
      const playing = doc.createElement("p");
      playing.append(
        "Playing ",
        Object.assign(doc.createElement("strong"), { textContent: title }),
      );
      const another = Object.assign(doc.createElement("a"), {
        href: location.pathname,
        textContent: "Open another archive",
      });
      bar.append(playing, another);
      shell.append(bar, frame);
      root.replaceChildren(style, shell);
    };

    return {
      async play(bytes, manifest) {
        const before = known()[manifest.ifid];
        if (
          before &&
          before.id !== manifest.game.id &&
          !confirm(
            `${manifest.title} says it's the same game as ${before.title}, which you've played here: they have the same IFID. Opening it replaces ${before.title}, and lets it read ${before.title}'s saves. Open it anyway?`,
          )
        ) {
          view.status.textContent = `${manifest.title} wasn't opened.`;
          return;
        }
        remember(manifest);
        show(manifest.ifid, manifest.title, bytes);
      },
      resume(ifid) {
        show(ifid, known()[ifid]?.title ?? "The game");
      },
    };
  });
}

/**
 * The host page on a game's own origin, which the player's iframe opens
 * first: it registers the origin's service worker, takes the archive from
 * the player at `options.player`, and nowhere else, keeps it if its IFID is
 * the one this origin is for (the first part of its host name), and goes to
 * the game.
 */
export async function mountGameHost(root: HTMLElement, options: GameHostOptions): Promise<void> {
  const scripts = pageScripts();
  root.innerHTML = `<main><p role="status">Opening the game…</p></main>`;
  const status = root.querySelector('[role="status"]') as HTMLElement;
  const ifid = (location.hostname.split(".")[0] ?? "").toUpperCase();
  const player = new URL(options.player).origin;
  if (window.parent === window || !isIfid(ifid)) {
    status.textContent = "";
    const p = root.ownerDocument.createElement("p");
    p.append("This page opens a game for the ");
    p.append(
      Object.assign(root.ownerDocument.createElement("a"), {
        href: player,
        textContent: "Loominate IF player",
      }),
    );
    p.append(".");
    root.querySelector("main")?.append(p);
    return;
  }
  const tell = (message: HostMessage): void => {
    window.parent.postMessage(message, player);
  };
  const fail = (problems: readonly string[]): void => {
    status.textContent = "";
    tell({ type: "loominate-failed", problems });
  };
  const workers = (navigator as Partial<Navigator>).serviceWorker;
  if (!workers || typeof caches === "undefined") {
    fail([
      "Playing an archive needs service workers, which browsers allow only on https:// pages and on localhost.",
    ]);
    return;
  }
  // Offline, this page is kept under the game's policy, which allows no
  // workers: the one already here is enough.
  await workers.register(options.worker ?? "sw.js").catch((e: unknown) => {
    if (!workers.controller) throw e;
  });
  const registration = await workers.ready;
  // Kept before going to the game, which would stop it halfway.
  const keeping = keepPage(scripts);
  const go = (): void => {
    void keeping.then(() => {
      location.replace(gameUrl(registration.scope, ifid));
    });
  };
  let done = false;
  addEventListener("message", (event: MessageEvent) => {
    if (done || event.source !== window.parent || event.origin !== player) return;
    if (!isMessage(event.data)) return;
    const message = event.data;
    if (message.type === "loominate-open") {
      done = true;
      void (async () => {
        try {
          const bytes = new Uint8Array(message.archive);
          const { manifest } = await readArchive(bytes);
          if (manifest.ifid !== ifid) {
            throw new ArchiveError(
              `Its IFID is ${manifest.ifid}, and this game's origin is for ${ifid}.`,
            );
          }
          await keepArchive(bytes, manifest, registration.scope, caches);
          go();
        } catch (e) {
          fail(e instanceof ArchiveError ? e.problems : [String(e)]);
        }
      })();
    } else if (message.type === "loominate-resume") {
      done = true;
      void (async () => {
        const kept = await (
          await caches.open(ARCHIVES_CACHE)
        ).match(archiveKey(registration.scope, ifid));
        if (kept) go();
        else fail(["The network can't be reached, and it hasn't been opened here before."]);
      })();
    }
  });
  tell({ type: "loominate-ready" });
}
