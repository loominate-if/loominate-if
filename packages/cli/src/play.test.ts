/** `loominate play` (#152, #153): the generic player for an archive, served on localhost. */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import os from "node:os";
import path from "node:path";
import { writeArchive } from "@loominate-if/archive";
import { afterAll, describe, expect, it } from "vitest";
import { play } from "./play.js";

const dir = mkdtempSync(path.join(os.tmpdir(), "loominate-play-"));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A GET to `url` with the host name `host`, as a browser at that name sends it. */
function get(
  url: string,
  host: string,
): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}> {
  const at = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port: at.port, path: at.pathname + at.search, headers: { Host: host } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("loominate play", () => {
  it("serves the player on localhost, and each game's host on its own origin", async () => {
    const ifid = "0B3A7F64-8E2C-4D1A-9F6B-2C5E8A1D3F70";
    const bytes = await writeArchive(
      {
        ifid,
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
      const port = new URL(server.url).port;
      const player = `localhost:${port}`;
      const game = `${ifid.toLowerCase()}.localhost:${port}`;

      const page = await get(server.url, player);
      expect(page.headers["content-type"]).toBe("text/html; charset=utf-8");
      const html = page.body.toString();
      expect(html).toContain("<title>Loominate IF player</title>");
      // Light or dark, and saying so, so a game that's only light gets its own light background.
      expect(html).toContain("color-scheme: light dark");
      // The script is inline, so the page is one file to keep offline, and its hash is the only script allowed.
      expect(html).not.toMatch(/<script[^>]+src=/);
      const policy = String(page.headers["content-security-policy"]);
      expect(policy).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'/);
      expect(policy).toContain(`frame-src http://*.localhost:${port}`);
      expect(policy).toContain("frame-ancestors 'none'");
      const worker = await get(`${server.url}`.replace(/\/\?.*$/, "/sw.js"), player);
      // A classic script, which every browser runs as a service worker.
      expect(worker.body.toString()).not.toMatch(/^\s*(import|export)\b/m);
      expect(
        (await get(server.url.replace(/\/\?.*$/, "/lantern%20road.loom"), player)).body,
      ).toEqual(Buffer.from(bytes));

      // The game's origin: its host page, framed only by the player, and its worker.
      const host = await get(server.url.replace(/\?.*$/, ""), game);
      expect(host.body.toString()).toContain("<title>Opening the game</title>");
      const hostPolicy = String(host.headers["content-security-policy"]);
      expect(hostPolicy).toContain(`frame-ancestors http://localhost:${port}`);
      // Its script is a file, which the game's policy, kept for offline, allows.
      expect(hostPolicy).toContain("script-src 'self'");
      expect(host.body.toString()).toContain('<script type="module" src="/host.js"></script>');
      const hostScript = await get(server.url.replace(/\/\?.*$/, "/host.js"), game);
      expect(hostScript.headers["content-type"]).toBe("text/javascript; charset=utf-8");
      expect(hostScript.body.toString()).toContain("loominate-ready");
      expect((await get(server.url.replace(/\/\?.*$/, "/host.js"), player)).status).toBe(404);
      const gameWorker = await get(server.url.replace(/\/\?.*$/, "/sw.js"), game);
      expect(gameWorker.body.toString()).toContain("frame-ancestors");
      // Its files come from its archive, through its worker; the server has none, nor the archive.
      expect((await get(server.url.replace(/\/\?.*$/, "/games/x/index.html"), game)).status).toBe(
        404,
      );
      expect((await get(server.url.replace(/\/\?.*$/, "/lantern%20road.loom"), game)).status).toBe(
        404,
      );

      // Other names are refused, and the loopback addresses go to localhost.
      expect((await get(server.url, `evil.example:${port}`)).status).toBe(421);
      expect((await get(server.url, `not-an-ifid.localhost:${port}`)).status).toBe(421);
      const moved = await get(server.url, `127.0.0.1:${port}`);
      expect(moved.status).toBe(307);
      expect(moved.headers.location).toBe(server.url);
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
