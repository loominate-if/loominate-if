// @vitest-environment jsdom
/** Playing games from their archives in a browser (#152): the service worker and the loader page. */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  archiveResponse,
  contentType,
  gameUrl,
  mountArchiveLoader,
  readArchive,
  serveArchives,
  storeArchive,
  writeArchive,
  type ArchiveDetails,
  type ArchiveWorkerScope,
  type WorkerFetchEvent,
} from "./index.js";
import { readZip } from "./zip.js";

const text = (s: string): Uint8Array => new TextEncoder().encode(s);
const IFID = "0B3A7F64-8E2C-4D1A-9F6B-2C5E8A1D3F70";
const details: ArchiveDetails = {
  ifid: IFID,
  title: "Lantern Road",
  game: { id: "lantern-road", version: "1.0.0" },
  engine: "0.1.0",
  entry: "index.html",
};
const song = new Uint8Array(100).map((_, i) => i);
const files = [
  { path: "index.html", data: text('<!doctype html><script src="./assets/game.js"></script>') },
  { path: "assets/game.js", data: text("console.log('go');") },
  { path: "assets/rain drops.mp3", data: song },
];

/** Cache Storage, in memory, as much of it as the worker and loader use. */
function memoryCaches(): CacheStorage {
  const stores = new Map<string, Map<string, Response>>();
  const url = (r: RequestInfo | URL): string =>
    typeof r === "string" ? r : r instanceof URL ? r.href : r.url;
  const bare = (u: string): string => u.replace(/[?#].*$/, "");
  return {
    open: async (name: string) => {
      const store = stores.get(name) ?? new Map<string, Response>();
      stores.set(name, store);
      return {
        match: async (r: RequestInfo | URL, options?: CacheQueryOptions) => {
          const want = options?.ignoreSearch === true ? bare(url(r)) : url(r);
          for (const [key, response] of store) {
            if ((options?.ignoreSearch === true ? bare(key) : key) === want)
              return response.clone();
          }
          return undefined;
        },
        put: async (r: RequestInfo | URL, response: Response) => {
          store.set(url(r), response);
        },
        add: async (r: RequestInfo | URL) => {
          store.set(url(r), new Response("kept"));
        },
      } as unknown as Cache;
    },
  } as unknown as CacheStorage;
}

const SCOPE = "http://localhost:4180/";

/** A service worker's scope, with `network` as its fetch. */
function worker(network: (r: Request) => Promise<Response>) {
  const listeners = new Map<string, (event: never) => void>();
  const caches = memoryCaches();
  const scope = {
    registration: { scope: SCOPE },
    caches,
    clients: { claim: async () => undefined },
    fetch: network,
    skipWaiting: async () => undefined,
    addEventListener: (type: string, listener: (event: never) => void) => {
      listeners.set(type, listener);
    },
  } as unknown as ArchiveWorkerScope;
  serveArchives(scope);
  /** What the worker answers, or `undefined` if it leaves the request to the browser. */
  const request = async (
    url: string,
    init: { mode?: string; method?: string; headers?: Record<string, string> } = {},
  ): Promise<Response | undefined> => {
    let answer: Promise<Response> | undefined;
    const event: WorkerFetchEvent = {
      request: {
        url,
        method: init.method ?? "GET",
        mode: init.mode ?? "cors",
        headers: new Headers(init.headers),
      } as unknown as Request,
      respondWith: (r) => {
        answer = r;
      },
    };
    (listeners.get("fetch") as (e: WorkerFetchEvent) => void)(event);
    return answer;
  };
  return { caches, request, listeners };
}

const offline = (): Promise<Response> => Promise.reject(new TypeError("NetworkError"));

describe("serving an archive's files", () => {
  it("gives each its media type, and the entry page for the game's folder", async () => {
    const archive = await readArchive(await writeArchive(details, files));
    const page = await archiveResponse(archive, "");
    expect(page.status).toBe(200);
    expect(page.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(await page.text()).toContain("<script");
    const script = await archiveResponse(archive, "assets/game.js");
    expect(script.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
    expect(script.headers.get("ETag")).toMatch(/^"[0-9a-f]{64}"$/);
    // Names are decoded, as the page's URLs encode them.
    const music = await archiveResponse(archive, "assets/rain%20drops.mp3");
    expect(music.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(new Uint8Array(await music.arrayBuffer())).toEqual(song);
    expect(contentType("fonts/a.WOFF2")).toBe("font/woff2");
    expect(contentType("data.bin")).toBe("application/octet-stream");
  });

  it("gives the part a range asks for", async () => {
    const archive = await readArchive(await writeArchive(details, files));
    const ask = async (range: string) =>
      archiveResponse(archive, "assets/rain drops.mp3", {
        method: "GET",
        headers: { get: (n) => (n === "Range" ? range : null) },
      });
    const part = await ask("bytes=10-19");
    expect(part.status).toBe(206);
    expect(part.headers.get("Content-Range")).toBe("bytes 10-19/100");
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(song.subarray(10, 20));
    expect((await ask("bytes=90-")).headers.get("Content-Range")).toBe("bytes 90-99/100");
    expect((await ask("bytes=-5")).headers.get("Content-Range")).toBe("bytes 95-99/100");
    expect((await ask("bytes=200-300")).status).toBe(416);
  });

  it("says what's missing, and that files can't be changed", async () => {
    const archive = await readArchive(await writeArchive(details, files));
    const missing = await archiveResponse(archive, "assets/gone.png");
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe("assets/gone.png isn't in the archive of Lantern Road.");
    const put = await archiveResponse(archive, "index.html", {
      method: "PUT",
      headers: { get: () => null },
    });
    expect(put.status).toBe(405);
    const head = await archiveResponse(archive, "index.html", {
      method: "HEAD",
      headers: { get: () => null },
    });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });
});

describe("the service worker", () => {
  it("plays a stored archive's game at games/<IFID>/", async () => {
    const w = worker(offline);
    await storeArchive(await writeArchive(details, files), SCOPE, w.caches);
    const url = gameUrl(SCOPE, IFID.toLowerCase());
    expect(url).toBe(`${SCOPE}games/${IFID}/`);
    const page = await w.request(url, { mode: "navigate" });
    expect(page?.status).toBe(200);
    expect(await page?.text()).toContain('src="./assets/game.js"');
    expect(await (await w.request(`${url}assets/game.js`))?.text()).toBe("console.log('go');");
    // The game's folder without its slash would put its relative paths a folder up.
    const bare = await w.request(`${SCOPE}games/${IFID}`);
    expect(bare?.status).toBe(301);
    expect(bare?.headers.get("Location")).toBe(url);
  });

  it("plays the newest version stored", async () => {
    const w = worker(offline);
    await storeArchive(await writeArchive(details, files), SCOPE, w.caches);
    const script = `${gameUrl(SCOPE, IFID)}assets/game.js`;
    expect(await (await w.request(script))?.text()).toBe("console.log('go');");
    const changed = files.map((f) =>
      f.path === "assets/game.js" ? { ...f, data: text("console.log('again');") } : f,
    );
    await storeArchive(
      await writeArchive({ ...details, game: { id: "lantern-road", version: "1.1.0" } }, changed),
      SCOPE,
      w.caches,
    );
    expect(await (await w.request(script))?.text()).toBe("console.log('again');");
  });

  it("says when a game hasn't been opened, or isn't a game", async () => {
    const w = worker(offline);
    const missing = await w.request(gameUrl(SCOPE, IFID), { mode: "navigate" });
    expect(missing?.status).toBe(404);
    expect(await missing?.text()).toContain(`No game with the IFID ${IFID} has been opened`);
    const nonsense = await w.request(`${SCOPE}games/%3Cscript%3E/`);
    expect(nonsense?.status).toBe(404);
    expect(await nonsense?.text()).not.toContain("script");
  });

  it("keeps the loader page and what it fetched, for playing offline", async () => {
    let online = true;
    const w = worker(async (r) => {
      if (!online) throw new TypeError("NetworkError");
      return new Response(`fetched ${r.url}`);
    });
    expect(
      await (await w.request(`${SCOPE}?archive=road.loom`, { mode: "navigate" }))?.text(),
    ).toBe(`fetched ${SCOPE}?archive=road.loom`);
    await w.request(`${SCOPE}icon.png`);
    await w.request(`${SCOPE}road.loom`);
    online = false;
    // The page, whatever archive its URL names, and what it fetched.
    expect(
      await (await w.request(`${SCOPE}?archive=other.loom`, { mode: "navigate" }))?.text(),
    ).toBe(`fetched ${SCOPE}?archive=road.loom`);
    expect(await (await w.request(`${SCOPE}icon.png`))?.text()).toBe(`fetched ${SCOPE}icon.png`);
    // Not an archive, which the loader keeps under its IFID.
    await expect(w.request(`${SCOPE}road.loom`)).rejects.toThrow("NetworkError");
  });

  it("leaves other sites and changes to the browser", async () => {
    const w = worker(offline);
    expect(await w.request("https://example.com/font.woff2")).toBeUndefined();
    expect(await w.request(`${SCOPE}save`, { method: "POST" })).toBeUndefined();
  });

  it("takes over at once", async () => {
    const w = worker(offline);
    const waited: Promise<unknown>[] = [];
    for (const type of ["install", "activate"]) {
      (w.listeners.get(type) as (e: { waitUntil(p: Promise<unknown>): void }) => void)({
        waitUntil: (p) => waited.push(p),
      });
    }
    expect(waited).toHaveLength(2);
  });
});

describe("storing an archive", () => {
  it("refuses one that doesn't play, listing why", async () => {
    await expect(storeArchive(text("not a zip"), SCOPE, memoryCaches())).rejects.toMatchObject({
      problems: [
        "The archive is damaged: it isn't a zip file: there's no end of central directory.",
      ],
    });
  });
});

describe("the loader page", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    history.replaceState(null, "", "/");
  });

  /** A browser with service workers, Cache Storage, and `network` as its fetch. */
  function browser(network: (url: URL) => Promise<Response>): CacheStorage {
    const caches = memoryCaches();
    vi.stubGlobal("caches", caches);
    vi.stubGlobal("fetch", (url: URL) => network(url));
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register: async () => undefined, ready: Promise.resolve({ scope: SCOPE }) },
    });
    return caches;
  }
  afterEach(() => {
    Reflect.deleteProperty(navigator, "serviceWorker");
  });

  const alertText = (): string[] =>
    [...document.querySelectorAll('[role="alert"] h2, [role="alert"] p, [role="alert"] li')].map(
      (e) => e.textContent ?? "",
    );

  it("offers to open an archive", async () => {
    browser(offline);
    await mountArchiveLoader(document.body);
    expect(document.querySelector("h1")?.textContent).toBe("Play a game from its archive");
    const input = document.querySelector("input");
    expect(input?.labels?.[0]?.textContent).toBe("Open an archive");
    expect(input?.accept).toBe(".loom");
    expect(input?.disabled).toBe(false);
  });

  it("says why an archive its URL names can't be played", async () => {
    browser(async () => new Response("not a zip"));
    history.replaceState(null, "", "/?archive=road.loom");
    await mountArchiveLoader(document.body);
    expect(alertText()).toEqual([
      "road.loom can't be played",
      "The archive is damaged: it isn't a zip file: there's no end of central directory.",
    ]);
    expect(document.querySelector('[role="status"]')?.textContent).toBe("");
    // One problem is a paragraph, not a list of one.
    expect(document.querySelector('[role="alert"] ul')).toBeNull();
    // Focus goes to the problem, so a screen reader reads it.
    expect(document.activeElement).toBe(document.querySelector('[role="alert"] h2'));
  });

  it("lists several problems", async () => {
    const bytes = await writeArchive(details, files);
    const zip = readZip(bytes);
    const script = zip.find((e) => e.path === "assets/game.js");
    const music = zip.find((e) => e.path === "assets/rain drops.mp3");
    const damaged = new Uint8Array(bytes);
    for (const e of [script, music]) {
      const at = (e?.dataOffset ?? 0) + 2;
      damaged[at] = (damaged[at] ?? 0) ^ 0xff;
    }
    browser(async () => new Response(damaged));
    history.replaceState(null, "", "/?archive=road.loom");
    await mountArchiveLoader(document.body);
    expect(document.querySelectorAll('[role="alert"] li')).toHaveLength(2);
  });

  it("puts each new problem in an alert of its own", async () => {
    browser(async () => new Response("not a zip"));
    await mountArchiveLoader(document.body);
    const input = document.querySelector("input") as HTMLInputElement;
    const pick = async (name: string): Promise<Element | null> => {
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [new File(["not a zip"], name)],
      });
      input.dispatchEvent(new Event("change"));
      await vi.waitFor(() => {
        expect(alertText()[0]).toBe(`${name} can't be played`);
      });
      return document.querySelector('[role="alert"]');
    };
    const first = await pick("story.ts");
    const second = await pick("inn.weft");
    expect(second).not.toBe(first);
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(document.activeElement?.textContent).toBe("inn.weft can't be played");
  });

  it("says when an archive can't be fetched", async () => {
    browser(offline);
    history.replaceState(null, "", "/?archive=road.loom");
    await mountArchiveLoader(document.body);
    expect(alertText()[1]).toBe(
      "It couldn't be fetched from http://localhost:3000/road.loom: the network can't be reached, and it hasn't been opened here before.",
    );
    browser(async () => new Response("", { status: 404, statusText: "Not Found" }));
    await mountArchiveLoader(document.body);
    expect(alertText()[1]).toBe(
      "It couldn't be fetched from http://localhost:3000/road.loom: 404 Not Found.",
    );
  });

  it("keeps the archive for the worker and starts the game", async () => {
    const bytes = await writeArchive(details, files);
    const caches = browser(async () => new Response(new Uint8Array(bytes)));
    history.replaceState(null, "", "/?archive=road.loom");
    await mountArchiveLoader(document.body);
    expect(document.querySelector('[role="status"]')?.textContent).toBe("Starting Lantern Road…");
    const w = worker(offline);
    Object.assign(w.caches, { open: caches.open.bind(caches) });
    expect((await w.request(`${gameUrl(SCOPE, IFID)}assets/game.js`))?.status).toBe(200);
    // Offline, the same URL opens the copy kept, with no message.
    browser(offline);
    Object.assign(globalThis.caches, { open: caches.open.bind(caches) });
    document.body.replaceChildren();
    await mountArchiveLoader(document.body);
    expect(alertText()).toEqual([]);
    expect(document.querySelector('[role="status"]')?.textContent).toBe("Opening road.loom…");
  });

  it("says when the browser can't play archives", async () => {
    vi.stubGlobal("caches", undefined);
    await mountArchiveLoader(document.body);
    expect(document.querySelector("input")?.disabled).toBe(true);
    expect(alertText()).toEqual([
      "This browser can't play archives here",
      "Playing an archive needs service workers, which browsers allow only on https:// pages and on localhost.",
    ]);
  });
});
