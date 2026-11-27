# 0132. The .loom archive format

- **Status:** Accepted, 2026-11-26
- **Issue:** [#151](https://github.com/loominate-if/loominate-if/issues/151), part of [#150](https://github.com/loominate-if/loominate-if/issues/150)
- **Design:** [Build targets and distribution](../DESIGN.md#build-targets-and-distribution), [ADR 0025](0025-build-targets.md), [ADR 0131](0131-asset-imports.md)

## Context

The design calls for a portable archive: a zip with a `.loom` extension whose manifest is a predictable first entry, following EPUB, with media stored uncompressed and Treaty of Babel metadata, including an IFID, for IF archives, offline sharing, and player apps. Later work reads it: a service worker serving a game from its archive (#152), the generic player (#153), and the desktop and mobile wrappers. Changing the format later breaks archives already shared, so it's fixed here, with a version.

## Decision

- **Layout.** A zip, version 2.0 features only: no zip64, encryption, or multiple disks. Entries, in order:
  1. `manifest.json`, always stored, so a reader finds it at a known place without inflating anything.
  2. `ifiction.xml`, the Treaty of Babel iFiction record.
  3. The game's files, as the static build writes them, sorted by path, with `index.html` the entry page.
- **The manifest** is JSON: `format: "loominate-archive"`, `formatVersion: 1`, `ifid`, `title`, `author` if given, `game: { id, version }`, `engine` (the Loominate IF version that built it), `entry`, and `files`, each `{ path, size, sha256 }`. A `format` field rather than an EPUB-style `mimetype` entry: the manifest is first either way, and one fewer file.
- **Compression.** Text (HTML, JavaScript, CSS, JSON, SVG, XML, source maps) is deflated when that makes it smaller; everything else, images, sound, and fonts, is stored, for fast random access. Entries are written with the web platform's `CompressionStream`, and read with `DecompressionStream`, so a browser reads archives with no library.
- **Reproducible.** Every entry has the same date, 1980-01-01, and files are sorted, so the same game makes the same bytes.
- **The IFID** is `game.ifid` in `loominate.config.ts`, a UUID, written in capitals as the treaty asks. The scaffold gives each new game one. Building an archive without one fails, and the message gives a new UUID to add. Every build target also puts it in the page, as the treaty says an HTML game does: `<meta prefix="ifiction: http://babel.ifarchive.org/protocol/iFiction/" property="ifiction:ifid" content="…">`.
- **The iFiction record** gives the IFID, the format `html`, and the title and author, "Anonymous" if there's none, as the treaty says. It has no colophon: the treaty requires its `originated` date, which would make each day's build differ, and the manifest already says which engine built it.
- **Building and validating.** `loominate build --target archive` builds the static site in a folder of its own and writes `dist/<game id>.loom`, leaving the rest of `dist/` alone. `loominate validate <file>` checks an archive's layout, manifest, iFiction record, and every file against the manifest's size and SHA-256, listing each problem.
- **`@loominate-if/archive`** writes, reads, and validates archives: `writeArchive`, `readArchive`, `validateArchive`, `ifictionRecord`, and `isIfid`. It has no dependencies, and is tooling: games never import it.

## Consequences

- A game made before `game.ifid` existed adds one to build an archive; nothing else changes for it.
- Playing a game from its archive, including files it imports (ADR 0131), comes with the service worker (#152); the archive already holds them.
- A later change to the layout or manifest raises `formatVersion`; readers report an archive of a version they don't read.
- Cover art isn't in the iFiction record yet: the treaty wants a JPEG or PNG within size limits, which a later change can check and add.
