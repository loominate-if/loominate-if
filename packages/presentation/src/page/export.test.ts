// @vitest-environment jsdom
/** Exporting the story log (#129): Markdown, HTML, and EPUB, divided by chapter markers. */
import {
  chapter,
  createEventRecord,
  createStore,
  createStory,
  emit,
  markChapter,
  type Passage,
} from "@loominate-if/core";
import { describe, expect, it } from "vitest";
import { _storedZip, exportStoryLog, type ExportedFile } from "./export.js";
import { createLogDialog, storyLog } from "./log.js";

const passages: Passage[] = [
  {
    id: "Gate",
    tags: [],
    effects: {
      enter: (c) => {
        markChapter({ title: "The House on the Hill" }, c);
      },
    },
    body: () => [
      { type: "text", text: "The gate creaks <open> & shut." },
      { type: "link", label: "In", target: "Hall" },
      { type: "link", label: "Gate", target: "Gate" },
    ],
  },
  {
    id: "Hall",
    tags: [],
    effects: {
      enter: () => {
        chapter("Inside");
        emit("dialogue", { text: "“Welcome.”", speaker: "butler" });
      },
    },
    body: () => [{ type: "text", text: "A dark hall." }],
  },
];

function played() {
  const store = createStore();
  const record = createEventRecord(store);
  const story = createStory(store, record, passages, { start: "Gate" });
  story.begin();
  const go = (label: string) => {
    const c = story.render().choices.find((x) => x.label === label);
    if (!c) throw new Error(`no ${label}`);
    story.follow(c);
  };
  go("Gate"); // the same marker again: no second chapter
  go("In");
  return record.events();
}

/** CRC-32 bit by bit, apart from the writer's table, to check its sums. */
function crc(data: Uint8Array): number {
  let c = ~0;
  for (const byte of data) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/** Reads a stored zip by its central directory, checking each entry against its local header and sum. */
function unzip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decode = (from: number, length: number) =>
    new TextDecoder().decode(bytes.subarray(from, from + length));
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const method = view.getUint16(at + 10, true);
    const sum = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true);
    const comment = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decode(at + 46, nameLength);
    expect([view.getUint32(local, true), method]).toEqual([0x04034b50, 0]);
    expect(decode(local + 30, view.getUint16(local + 26, true))).toBe(name);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    expect(crc(data), name).toBe(sum);
    files.set(name, new TextDecoder().decode(data));
    at += 46 + nameLength + extra + comment;
  }
  return files;
}

const text = (f: ExportedFile) => (typeof f.data === "string" ? f.data : "");

describe("exporting the story log (#129)", () => {
  it("shows chapter headings in the story log, once for a marker reached again", () => {
    expect(
      storyLog(played())
        .filter((e) => e.chapter === true)
        .map((e) => e.text),
    ).toEqual(["The House on the Hill", "Inside"]);
  });

  it("exports Markdown with the title, author, chapters, and speakers, escaped", () => {
    const file = exportStoryLog(played(), "markdown", {
      title: "Lantern: Road",
      author: "A. Writer",
    });
    expect([file.name, file.type]).toEqual(["Lantern Road.md", "text/markdown"]);
    expect(text(file)).toContain(
      "# Lantern: Road\n\n*A. Writer*\n\n## The House on the Hill\n\nThe gate creaks \\<open\\> & shut.",
    );
    expect(text(file)).toContain("## Inside");
    expect(text(file)).toContain("**butler:** “Welcome.”");
    expect(text(file).match(/## The House/g)).toHaveLength(1);
  });

  it("exports HTML, a section per chapter, with markup escaped", () => {
    const html = text(
      exportStoryLog(played(), "html", { title: "Lantern Road", language: "en-GB" }),
    );
    expect(html).toContain('<html lang="en-GB">');
    expect(html).toContain("<h2>The House on the Hill</h2>");
    expect(html).toContain("<p>The gate creaks &lt;open&gt; &amp; shut.</p>");
    expect(html).toContain("<p><b>butler:</b> “Welcome.”</p>");
    const parsed = new DOMParser().parseFromString(html, "text/html");
    expect(parsed.querySelectorAll("section")).toHaveLength(2);
  });

  it("exports a valid EPUB 3: the mimetype first and stored, a package, a navigation document, and a file per chapter", () => {
    const file = exportStoryLog(played(), "epub", {
      title: "Lantern Road",
      author: "A. Writer",
      modified: new Date("2026-11-24T10:00:00.000Z"),
    });
    expect([file.name, file.type]).toEqual(["Lantern Road.epub", "application/epub+zip"]);
    const bytes = file.data as Uint8Array;
    // The mimetype is the first entry, uncompressed, with no extra field, as EPUB requires.
    expect(new TextDecoder().decode(bytes.slice(30, 38))).toBe("mimetype");
    expect(new TextDecoder().decode(bytes.slice(38, 58))).toBe("application/epub+zip");
    const files = unzip(bytes);
    const read = (name: string) => files.get(name) ?? "";
    expect([...files.keys()]).toEqual([
      "mimetype",
      "META-INF/container.xml",
      "OEBPS/content.opf",
      "OEBPS/nav.xhtml",
      "OEBPS/chapter-1.xhtml",
      "OEBPS/chapter-2.xhtml",
    ]);
    const xml = (s: string) => new DOMParser().parseFromString(s, "application/xml");
    for (const name of [
      "META-INF/container.xml",
      "OEBPS/content.opf",
      "OEBPS/nav.xhtml",
      "OEBPS/chapter-1.xhtml",
      "OEBPS/chapter-2.xhtml",
    ]) {
      expect(xml(read(name)).querySelector("parsererror"), name).toBeNull();
    }
    const opf = xml(read("OEBPS/content.opf"));
    expect(opf.querySelector("title")?.textContent).toBe("Lantern Road");
    expect(opf.querySelector("creator")?.textContent).toBe("A. Writer");
    expect(opf.querySelector('meta[property="dcterms:modified"]')?.textContent).toBe(
      "2026-11-24T10:00:00Z",
    );
    expect(
      [...xml(read("OEBPS/nav.xhtml")).querySelectorAll("li a")].map((a) => a.textContent),
    ).toEqual(["The House on the Hill", "Inside"]);
    expect(read("OEBPS/chapter-1.xhtml")).toContain("The gate creaks &lt;open&gt; &amp; shut.");
  });

  it("puts what comes before the first chapter in an opening part, under the book's title", () => {
    const store = createStore();
    const record = createEventRecord(store);
    createStory(
      store,
      record,
      [{ id: "Start", tags: [], body: () => [{ type: "text", text: "Once." }] }],
      {
        start: "Start",
      },
    ).begin();
    const md = text(exportStoryLog(record.events(), "markdown", { title: "Tale" }));
    expect(md).toBe("# Tale\n\nOnce.\n");
  });

  it("writes zips that read back exactly", () => {
    const data = new TextEncoder().encode("héllo");
    expect(unzip(_storedZip([{ name: "a.txt", data }])).get("a.txt")).toBe("héllo");
  });

  it("exports from the story log dialog in the chosen format, named after the game", () => {
    const events = played();
    const saved: ExportedFile[] = [];
    document.body.replaceChildren();
    const dialog = createLogDialog(document.body, () => events, {
      title: "Lantern Road",
      save: (f) => saved.push(f),
    });
    dialog.open("log");
    const format = dialog.element.querySelector<HTMLSelectElement>('select[id$="-format"]');
    if (!format) throw new Error("no format");
    format.value = "markdown";
    format.dispatchEvent(new Event("change", { bubbles: true }));
    [...dialog.element.querySelectorAll("button")].find((b) => b.textContent === "Export")?.click();
    expect(saved.map((f) => f.name)).toEqual(["Lantern Road.md"]);
    expect(dialog.element.querySelector('[role="status"]')?.textContent).toBe(
      "Saved Lantern Road.md.",
    );
    expect(
      [...dialog.element.querySelectorAll("h3.loominate-log-chapter")].map((h) => h.textContent),
    ).toEqual(["The House on the Hill", "Inside"]);
  });
});
