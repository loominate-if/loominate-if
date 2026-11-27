/** `loominate play` (#152): the player for an archive, served on localhost. */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeArchive } from "@loominate-if/archive";
import { afterAll, describe, expect, it } from "vitest";
import { play } from "./play.js";

const dir = mkdtempSync(path.join(os.tmpdir(), "loominate-play-"));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("loominate play", () => {
  it("serves the loader page, the service worker, and the archive", async () => {
    const bytes = await writeArchive(
      {
        ifid: "0B3A7F64-8E2C-4D1A-9F6B-2C5E8A1D3F70",
        title: "Lantern Road",
        game: { id: "lantern-road", version: "1.0.0" },
        engine: "0.1.0",
        entry: "index.html",
      },
      [{ path: "index.html", data: new TextEncoder().encode("<!doctype html><p>Road.") }],
    );
    const file = path.join(dir, "lantern road.loom");
    writeFileSync(file, bytes);
    const server = await play(file, { port: 0, conditions: ["source"] });
    try {
      expect(server.url).toMatch(/^http:\/\/localhost:\d+\/\?archive=lantern%20road\.loom$/);
      const page = await fetch(server.url);
      expect(page.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
      const html = await page.text();
      expect(html).toContain("<title>Loominate IF player</title>");
      // The loader's script is inline, so the page is one file to keep offline.
      expect(html).toContain("Play a game from its archive");
      expect(html).not.toMatch(/<script[^>]+src=/);
      const worker = await fetch(new URL("/sw.js", server.url));
      expect(worker.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
      // A classic script, which every browser runs as a service worker.
      const code = await worker.text();
      expect(code).toContain("loominate-archives");
      expect(code).not.toMatch(/^\s*(import|export)\b/m);
      const archive = await fetch(new URL("/lantern%20road.loom", server.url));
      expect(new Uint8Array(await archive.arrayBuffer())).toEqual(bytes);
      expect((await fetch(new URL("/other.loom", server.url))).status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("won't play something that isn't an archive", async () => {
    const file = path.join(dir, "broken.loom");
    writeFileSync(file, "not a zip");
    await expect(play(file, { port: 0 })).rejects.toThrow(
      `${file} can't be played:\n  The archive is damaged: it isn't a zip file: there's no end of central directory.`,
    );
  });
});
