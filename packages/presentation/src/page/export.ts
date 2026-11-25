/**
 * Exporting the story log (#129, ADR 0105): Markdown, HTML, or EPUB, divided
 * into chapters by `{chapter "…"}` markers. The EPUB is EPUB 3, written as
 * a stored (uncompressed) zip, which EPUB allows, so no compression library
 * reaches the player.
 */
import type { RecordedEvent } from "@loominate-if/core";
import { storyLog, type LogEntry } from "./log.js";

/** The formats the story log exports to. */
export type ExportFormat = "markdown" | "html" | "epub";

/** What an export is about: its title and author, and for EPUB its language, identifier, and date. */
export type ExportOptions = {
  /** The book's title: the game's. */
  readonly title: string;
  /** Its author, if the game says. */
  readonly author?: string;
  /** Its language, as a BCP 47 tag, as `en`. Defaults to `en`. */
  readonly language?: string;
  /** A unique identifier, for EPUB. Defaults to one made from the title. */
  readonly identifier?: string;
  /** When it was made, for EPUB's modified date. Defaults to now. */
  readonly modified?: Date;
};

/** An exported file: its name, type, and contents. */
export type ExportedFile = {
  /** A file name, made from the title, with the format's extension. */
  readonly name: string;
  /** Its media type. */
  readonly type: string;
  /** Its contents: text for Markdown and HTML, bytes for EPUB. */
  readonly data: string | Uint8Array;
};

/** A chapter of the story log: its title, if it has one, and its entries. */
type Chapter = { readonly title?: string; readonly entries: LogEntry[] };

/** The story log's entries, divided at its chapter headings. What comes before the first is an untitled chapter. */
function chapters(entries: readonly LogEntry[]): Chapter[] {
  const out: Chapter[] = [];
  for (const e of entries) {
    if (e.chapter === true) out.push({ title: e.text, entries: [] });
    else {
      if (out.length === 0) out.push({ entries: [] });
      out.at(-1)?.entries.push(e);
    }
  }
  return out.filter((c) => c.title !== undefined || c.entries.length > 0);
}

/** A file name from a title: what file systems allow. */
const fileName = (title: string, extension: string): string =>
  `${title.replace(/[\\/:*?"<>|]+/g, "").trim() || "story"}.${extension}`;

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Markdown's special characters, escaped so prose reads as written. */
const escapeMarkdown = (s: string): string => s.replace(/([\\`*_[\]#<>|])/g, "\\$1");

function markdown(log: readonly LogEntry[], options: ExportOptions): string {
  const lines = [`# ${escapeMarkdown(options.title)}`, ""];
  if (options.author !== undefined) lines.push(`*${escapeMarkdown(options.author)}*`, "");
  for (const c of chapters(log)) {
    if (c.title !== undefined) lines.push(`## ${escapeMarkdown(c.title)}`, "");
    for (const e of c.entries) {
      const text = escapeMarkdown(e.text);
      lines.push(
        e.speaker !== undefined
          ? `**${escapeMarkdown(e.speaker)}:** ${text}`
          : e.player === true
            ? `*${text}*`
            : text,
        "",
      );
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/** A chapter's paragraphs as XHTML or HTML: the speaker in bold, the player's own lines in italics. */
const paragraphs = (c: Chapter): string =>
  c.entries
    .map((e) => {
      const text = escapeHtml(e.text);
      if (e.speaker !== undefined) return `<p><b>${escapeHtml(e.speaker)}:</b> ${text}</p>`;
      return e.player === true ? `<p><i>${text}</i></p>` : `<p>${text}</p>`;
    })
    .join("\n");

function html(log: readonly LogEntry[], options: ExportOptions): string {
  const language = options.language ?? "en";
  const body = chapters(log)
    .map(
      (c) =>
        `<section>\n${c.title !== undefined ? `<h2>${escapeHtml(c.title)}</h2>\n` : ""}${paragraphs(c)}\n</section>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="${escapeHtml(language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)}</title>
<style>body { max-width: 40rem; margin: 2rem auto; padding: 0 1rem; font-family: Georgia, serif; line-height: 1.5; }</style>
</head>
<body>
<h1>${escapeHtml(options.title)}</h1>
${options.author !== undefined ? `<p><i>${escapeHtml(options.author)}</i></p>\n` : ""}${body}
</body>
</html>
`;
}

// --- EPUB ---

const encoder = new TextEncoder();

/** CRC-32, as zip needs for each file. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A zip archive of `files`, in order, stored without compression, as EPUB allows. @internal */
export function _storedZip(
  files: readonly { readonly name: string; readonly data: Uint8Array }[],
): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const size = file.data.length;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // local file header
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, file.data);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true); // central directory header
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 0, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, size, true);
    entry.setUint32(24, size, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + size;
  }
  const centralSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); // end of central directory
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const xhtml = (
  title: string,
  language: string,
  body: string,
): string => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeHtml(language)}" xml:lang="${escapeHtml(language)}">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(title)}</title>
</head>
<body>
${body}
</body>
</html>
`;

function epub(log: readonly LogEntry[], options: ExportOptions): Uint8Array {
  const language = options.language ?? "en";
  const identifier =
    options.identifier ??
    `urn:loominate:${options.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  // The book's modified date is metadata, as a save's time is: wall-clock time is fine here.
  // eslint-disable-next-line no-restricted-syntax -- export metadata, not game logic
  const modified = (options.modified ?? new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
  const book = chapters(log);
  const parts = (book.length > 0 ? book : [{ entries: [] }]).map((c, i) => ({
    id: `chapter-${String(i + 1)}`,
    file: `chapter-${String(i + 1)}.xhtml`,
    title: c.title ?? (i === 0 ? options.title : `Part ${String(i + 1)}`),
    body: `${c.title !== undefined ? `<h2>${escapeHtml(c.title)}</h2>\n` : i === 0 ? `<h1>${escapeHtml(options.title)}</h1>\n` : ""}${paragraphs(c as Chapter)}`,
  }));
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${escapeHtml(language)}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="book-id">${escapeHtml(identifier)}</dc:identifier>
<dc:title>${escapeHtml(options.title)}</dc:title>
<dc:language>${escapeHtml(language)}</dc:language>
${options.author !== undefined ? `<dc:creator>${escapeHtml(options.author)}</dc:creator>\n` : ""}<meta property="dcterms:modified">${modified}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${parts.map((p) => `<item id="${p.id}" href="${p.file}" media-type="application/xhtml+xml"/>`).join("\n")}
</manifest>
<spine>
${parts.map((p) => `<itemref idref="${p.id}"/>`).join("\n")}
</spine>
</package>
`;
  const nav = xhtml(
    options.title,
    language,
    `<nav epub:type="toc" id="toc">
<h1>${escapeHtml(options.title)}</h1>
<ol>
${parts.map((p) => `<li><a href="${p.file}">${escapeHtml(p.title)}</a></li>`).join("\n")}
</ol>
</nav>`,
  );
  const container = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles>
<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
</rootfiles>
</container>
`;
  return _storedZip([
    // The mimetype comes first, stored, as EPUB requires.
    { name: "mimetype", data: encoder.encode("application/epub+zip") },
    { name: "META-INF/container.xml", data: encoder.encode(container) },
    { name: "OEBPS/content.opf", data: encoder.encode(opf) },
    { name: "OEBPS/nav.xhtml", data: encoder.encode(nav) },
    ...parts.map((p) => ({
      name: `OEBPS/${p.file}`,
      data: encoder.encode(xhtml(p.title, language, p.body)),
    })),
  ]);
}

/**
 * Exports the story log of `events` as Markdown, HTML, or EPUB 3, divided
 * into chapters at its chapter headings, each line by its speaker.
 *
 * @example
 * ```ts
 * const file = exportStoryLog(record.events(), "epub", { title: "Lantern Road", author: "A. Writer" });
 * ```
 */
export function exportStoryLog(
  events: readonly RecordedEvent[],
  format: ExportFormat,
  options: ExportOptions,
): ExportedFile {
  const log = storyLog(events);
  if (format === "markdown") {
    return {
      name: fileName(options.title, "md"),
      type: "text/markdown",
      data: markdown(log, options),
    };
  }
  if (format === "html") {
    return { name: fileName(options.title, "html"), type: "text/html", data: html(log, options) };
  }
  return {
    name: fileName(options.title, "epub"),
    type: "application/epub+zip",
    data: epub(log, options),
  };
}
