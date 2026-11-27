# 0134. The generic player: a sandboxed frame on an origin per game

- **Status:** Accepted, 2026-11-27
- **Issue:** [#153](https://github.com/loominate-if/loominate-if/issues/153), part of [#150](https://github.com/loominate-if/loominate-if/issues/150)
- **Design:** [Build targets and distribution](../DESIGN.md#build-targets-and-distribution), [ADR 0133](0133-archive-service-worker.md), [ADR 0132](0132-loom-archives.md)

## Context

The design says a generic player that opens third-party archives runs each game in a sandboxed iframe under a strict content security policy. The #152 loader plays games on its own origin, which is fine for an author's own games but lets any game read the loader's storage and every other game's saves.

A sandboxed iframe can't both be safe and work on the player's origin. Without `allow-same-origin` it has an opaque origin, with no IndexedDB for saves and no service worker to serve its files; with it, on the player's origin, a script can reach into the parent and remove its own sandbox.

## Decision

- **An origin per game.** Each game plays on its own origin, named by its IFID: `http://<ifid>.localhost:<port>` for `loominate play`, or a wildcard subdomain when hosted. Its saves, caches, and service worker are its own, and `allow-same-origin` gives it that origin, never the player's.
- **The iframe** has `sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"` (`PLAYER_SANDBOX`):
  - forms, because the game's menus submit to their own handlers;
  - downloads, for save and story-log export;
  - no top navigation, popups, modal dialogs, pointer lock, or presentation.

  It also has `allow="autoplay"`, `referrerpolicy="no-referrer"`, and the game's title.
- **Handing over the archive.**
  1. The player page checks the archive fully and shows the frame at the game origin's `/`, a host page (`mountGameHost`) that registers that origin's worker.
  2. The host tells the player it's ready.
  3. The player sends the archive, or asks it to play its kept copy when offline.

  Each side checks the other's origin and window, and the host acts on one message only. The host keeps the archive only if its IFID is the one its origin is for, then replaces itself with the game.
- **The game's policy.** Every response from a game's archive carries `sandboxPolicy(player)`:
  - only the game's own origin for scripts, styles, connections, and the like;
  - inline styles, which presentation writes;
  - `data:` and `blob:` media and fonts;
  - no workers, frames, plugins, form targets, or `<base>`;
  - framing by the player alone.

  Files are also served with `X-Content-Type-Options: nosniff`.
- **The player's policy.** The player page allows only its own inline script (by hash) and frames only from game origins, and can't be framed itself. Its frame can't be navigated to any other site, which also covers the game navigating itself away, something its own policy can't express.
- **The same IFID, another game.** The player remembers, in its own storage, each IFID's game ID and title. An archive claiming a known IFID with a different game ID is opened only if the player agrees, since it would take over that game's origin and saves.
- **`loominate play`** serves this player:
  - On `localhost`: the player page, its offline worker (`keepOffline`), and the archive.
  - On `<ifid>.localhost`: the host page and the game's worker.
  - From both loopback addresses. `127.0.0.1` redirects to `localhost`, and any other host name is refused, which also stops DNS rebinding.

  Authors test under the restrictions players get. `mountArchiveLoader` stays for an author hosting their own games on one origin.
- **Public pieces** for hosting the player elsewhere: `mountPlayer` with a `gameOrigin(ifid)`, `mountGameHost`, `keepOffline`, `serveArchives` with a `policy`, `sandboxPolicy`, and `PLAYER_SANDBOX`.

## Threat model

The attacker writes an archive the player opens. They want to read or change the player, other games' saves, or the player's machine, or to send what they learn elsewhere.

| Attempt | Stopped by | Checked |
| --- | --- | --- |
| Read the player page or its storage | Different origin | Chrome, Firefox |
| Read other games' saves and caches | An origin per game | Chrome, Firefox |
| Navigate the player's tab, open popups or dialogs | Sandbox | Chrome, Firefox |
| `document.domain` to join the player's origin | Sandbox | Chrome, Firefox |
| Fetch, beacon, or WebSocket to another site, or the player | `connect-src 'self'` | Chrome, Firefox |
| Scripts, images, or frames from another site | `script-src`, `img-src`, `frame-src` | Chrome, Firefox |
| Inline scripts, `eval`, `new Function` | `script-src 'self'` | Chrome, Firefox |
| Workers or its own service worker | `worker-src 'none'` | Chrome, Firefox |
| Navigating its own frame or posting a form elsewhere | The player's `frame-src` | Chrome; by hand in Firefox |
| Handing the host a different game's archive | Host checks the player's origin and the IFID | Unit tests |
| Spoofing the host's messages to the player | Player checks the frame's origin and window | Unit tests |
| Claiming a game's IFID to take over its saves | The player asks first | Unit tests |
| Markup in titles or problems | Shown as text only | Unit tests |
| Another site reaching `loominate play` by DNS | Host names other than ours refused | Unit tests |

`scratch/43-sandbox-escape` is an archive whose script tries each of these and lists what happened. All 19 automatic attempts were blocked in headless Chrome and Firefox.

**What's left:**

- **WebRTC.** No shipped policy stops `RTCPeerConnection`, so a game could send data to a server through it. It can only send what it already has: its own saves and what the player types into it.
- **Same site, locally.** `<ifid>.localhost` and `localhost` are the same site, so browsers may put a game and the player in one process: a busy game can slow the player, and Spectre-class attacks aren't ruled out. Cookies set for `localhost` would be shared, though neither side sets any. A hosted player should put games on a separate registrable domain, as code hosts do for user content.
- **Resources.** A game can fill its own storage quota, use the CPU, or start downloads, which browsers show.
- **Hostile zips.** The player and host inflate entries fully before checking sizes, so a compression bomb can exhaust the player tab's memory ([#441](https://github.com/loominate-if/loominate-if/issues/441)).

## Consequences

- A game that loads anything from another site, such as a hosted font, is blocked in the player. The browser's console says what, and the fix is to import the file in `story.ts`.
- A game with inline scripts in its own `index.html` doesn't run in the player; Loominate's builds have none.
- Hosting the player needs wildcard DNS and TLS for the games' domain.
- Saves made in the #152 loader, on the player's origin, don't carry over to a game's own origin; players move them with save export and import.
