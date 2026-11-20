# 0025. The static-site and single-file build targets

- **Status:** Accepted, 2026-11-19
- **Issues:** [#55](https://github.com/loominate-if/loominate-if/issues/55), [#56](https://github.com/loominate-if/loominate-if/issues/56)
- **Design:** [Build targets and distribution](../DESIGN.md#build-targets-and-distribution), [ADR 0023](0023-game-config-and-cli-commands.md)

## Context

The design lists four build targets. The static site, the default, must run from any static host. The single file must open by double-click, with no server. `loominate build` already wrote a static site (ADR 0023). A browser won't load module scripts, or anything else a page fetches, from a `file:` URL, so the single file must carry everything inline.

## Decision

- **Choosing a target.** `loominate build --target static|single`, or `build({ target })`. The default is `static`. Both write to `dist/`. The static build empties it first. The single build writes its one file without emptying it, so running both leaves the site and the single file side by side (#2).
- **The static site** is `index.html`, the bundled script, and assets as files. Every URL is relative (`base: "./"`), so the site works from a domain's root or any subfolder (GitHub Pages, itch.io, Netlify), and from any local static server.
- **The single file** is `dist/<game id>.html`. Vite builds the game as one script with no code splitting, inlines assets as data URLs, and keeps CSS in one file. A small plugin then moves the script into the page as an inline module script, and any stylesheet into a `<style>`. Inline module scripts run from `file:` URLs. Text that would end the element early, such as `</script>` in prose, is escaped. If anything is left that couldn't be inlined, such as a file in `public/`, the build fails and names it, rather than producing a page that's missing a file.
- **No new dependency.** The inlining is a few dozen lines over Vite's own options, not a plugin package.
- The scaffold's `package.json` has `build:single` alongside `build`.

## Consequences

- Inlined binary assets grow by about a third and load up front, as the design says.
- Browsers keep storage for files opened from disk in different ways. Some share it across every local file, and some keep it more narrowly, so moving the file or switching browsers can lose its saves. Saves are keyed by game ID, so sharing is safe, and the save menu's export and import carry saves across.
- The archive and app targets build on the static site's output.
