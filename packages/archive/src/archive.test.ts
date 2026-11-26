import { describe, expect, it } from "vitest";
import {
  ArchiveError,
  ifictionRecord,
  isIfid,
  readArchive,
  validateArchive,
  writeArchive,
  type ArchiveDetails,
} from "./index.js";
import { readZip, writeZip } from "./zip.js";

const text = (s: string): Uint8Array => new TextEncoder().encode(s);
const IFID = "0b3a7f64-8e2c-4d1a-9f6b-2c5e8a1d3f70";
const details: ArchiveDetails = {
  ifid: IFID,
  title: "Lantern Road",
  author: "A. Writer & Co.",
  game: { id: "lantern-road", version: "1.2.0" },
  engine: "0.1.0",
  entry: "index.html",
};
const page = text(`<!doctype html><title>Lantern Road</title>${"<p>Road.</p>".repeat(50)}`);
const png = new Uint8Array(200).map((_, i) => (i * 37) % 256);
const files = [
  { path: "index.html", data: page },
  { path: "assets/key-abc.png", data: png },
  { path: "assets/index-xyz.js", data: text("console.log('go');\n".repeat(40)) },
];

/** A zip made by hand, for archives this package wouldn't write. */
async function handMade(
  manifest: unknown,
  rest: readonly { path: string; data: Uint8Array }[] = [],
  ifid = IFID,
): Promise<Uint8Array> {
  return writeZip([
    { path: "manifest.json", data: text(JSON.stringify(manifest)), compress: false },
    { path: "ifiction.xml", data: text(`<ifid>${ifid}</ifid>`), compress: false },
    ...rest.map((f) => ({ ...f, compress: false })),
  ]);
}
const goodManifest = async () => (await readArchive(await writeArchive(details, files))).manifest;

describe("archives", () => {
  it("hold the game's files, with a manifest first and its iFiction record second", async () => {
    const bytes = await writeArchive(details, files);
    const entries = readZip(bytes);
    expect(entries.map((e) => e.path)).toEqual([
      "manifest.json",
      "ifiction.xml",
      "assets/index-xyz.js",
      "assets/key-abc.png",
      "index.html",
    ]);
    // The manifest is stored; text is deflated, and media stored.
    expect(entries.map((e) => e.method)).toEqual([0, 8, 8, 0, 8]);
    const archive = await readArchive(bytes);
    expect(archive.manifest).toMatchObject({
      format: "loominate-archive",
      formatVersion: 1,
      ifid: IFID.toUpperCase(),
      title: "Lantern Road",
      game: { id: "lantern-road", version: "1.2.0" },
      entry: "index.html",
    });
    expect(archive.manifest.files.find((f) => f.path === "assets/key-abc.png")).toEqual({
      path: "assets/key-abc.png",
      size: 200,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown as string,
    });
    expect(await archive.read("index.html")).toEqual(page);
    expect(await archive.read("assets/key-abc.png")).toEqual(png);
    expect(await archive.read("missing.txt")).toBeUndefined();
    // The archive's own entries aren't the game's files.
    expect(await archive.read("manifest.json")).toBeUndefined();
    expect(await validateArchive(bytes)).toEqual([]);
  });

  it("are the same bytes for the same files, in any order", async () => {
    const once = await writeArchive(details, files);
    const again = await writeArchive(details, [...files].reverse());
    expect(again).toEqual(once);
  });

  it("carry a Treaty of Babel record, escaped", () => {
    const xml = ifictionRecord(details);
    expect(xml).toContain(`<ifid>${IFID.toUpperCase()}</ifid>`);
    expect(xml).toContain("<format>html</format>");
    expect(xml).toContain("<author>A. Writer &amp; Co.</author>");
    expect(xml).toContain('xmlns="http://babel.ifarchive.org/protocol/iFiction/"');
  });

  it("take an IFID that's a UUID", () => {
    expect(isIfid(IFID)).toBe(true);
    expect(isIfid(IFID.toUpperCase())).toBe(true);
    expect(isIfid("lantern-road")).toBe(false);
  });

  it("aren't written with a bad IFID, path, or entry", async () => {
    await expect(writeArchive({ ...details, ifid: "road" }, files)).rejects.toThrow(
      'The IFID "road" isn\'t a UUID.',
    );
    await expect(writeArchive(details, [...files, { path: "../x", data: page }])).rejects.toThrow(
      'The path "../x" has an empty, `.`, or `..` folder.',
    );
    await expect(
      writeArchive(details, [...files, { path: "manifest.json", data: page }]),
    ).rejects.toThrow("is the archive's own");
    await expect(
      writeArchive(details, [...files, { path: "index.html", data: page }]),
    ).rejects.toThrow("Two files have the path index.html.");
    await expect(writeArchive({ ...details, entry: "play.html" }, files)).rejects.toThrow(
      "The entry page, play.html, isn't among the files.",
    );
  });
});

describe("validating an archive", () => {
  it("finds a damaged file", async () => {
    const bytes = await writeArchive(details, files);
    const png = readZip(bytes).find((e) => e.path === "assets/key-abc.png");
    const at = (png?.dataOffset ?? 0) + 5;
    bytes[at] = (bytes[at] ?? 0) ^ 0xff;
    expect(await validateArchive(bytes)).toEqual([
      "assets/key-abc.png is damaged: its contents don't match its checksum.",
    ]);
  });

  it("says why something isn't an archive", async () => {
    expect(await validateArchive(text("not a zip"))).toEqual([
      "The archive is damaged: it isn't a zip file: there's no end of central directory.",
    ]);
    const noManifest = await writeZip([{ path: "index.html", data: page, compress: false }]);
    expect(await validateArchive(noManifest)).toEqual([
      "The archive's first entry isn't manifest.json.",
    ]);
    expect(await validateArchive(await handMade({ format: "epub" }))).toEqual([
      "The manifest's format isn't \"loominate-archive\": it isn't a Loominate IF archive.",
    ]);
    expect(
      await validateArchive(await handMade({ format: "loominate-archive", formatVersion: 2 })),
    ).toEqual([
      "The archive is format version 2, and this version of Loominate IF reads version 1.",
    ]);
    await expect(readArchive(noManifest)).rejects.toBeInstanceOf(ArchiveError);
  });

  it("lists every problem with a manifest", async () => {
    expect(
      await validateArchive(
        await handMade({ format: "loominate-archive", formatVersion: 1, ifid: "x", files: [{}] }),
      ),
    ).toEqual([
      "The manifest's ifid isn't a UUID.",
      "The manifest has no title.",
      "The manifest's game needs an id and a version.",
      "The manifest doesn't say which engine version built it.",
      "The manifest has no entry page.",
      "The manifest's files must each have a path, a size, and a SHA-256.",
    ]);
  });

  it("checks the files against the manifest, and the iFiction record's IFID", async () => {
    const manifest = await goodManifest();
    const listed = manifest.files.filter((f) => f.path !== "assets/key-abc.png");
    const bytes = await handMade(
      { ...manifest, files: [...listed, { path: "gone.txt", size: 1, sha256: "0".repeat(64) }] },
      [
        ...files.filter((f) => f.path !== "assets/index-xyz.js"),
        { path: "assets/index-xyz.js", data: text("changed") },
      ],
      "11111111-2222-3333-4444-555555555555",
    );
    expect(await validateArchive(bytes)).toEqual([
      `ifiction.xml's IFID isn't the manifest's, ${IFID.toUpperCase()}.`,
      "assets/index-xyz.js doesn't match the manifest's size and SHA-256.",
      "gone.txt is in the manifest but not in the archive.",
      "assets/key-abc.png is in the archive but not in the manifest.",
    ]);
  });
});
