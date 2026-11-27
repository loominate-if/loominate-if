// @vitest-environment jsdom
// @vitest-environment-options {"url": "http://0b3a7f64-8e2c-4d1a-9f6b-2c5e8a1d3f70.localhost:4180/"}
/** The game host page (#153): on a game's own origin, taking its archive from the player alone. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { archiveKey, ARCHIVES_CACHE, mountGameHost, writeArchive } from "./index.js";
import { memoryCaches } from "./memory-caches.test.helper.js";

const IFID = "0B3A7F64-8E2C-4D1A-9F6B-2C5E8A1D3F70";
const PLAYER = "http://localhost:4180";
const SCOPE = `${location.origin}/`;
const archive = (ifid = IFID) =>
  writeArchive(
    {
      ifid,
      title: "Lantern Road",
      game: { id: "lantern-road", version: "1.0.0" },
      engine: "0.1.0",
      entry: "index.html",
    },
    [{ path: "index.html", data: new TextEncoder().encode("<p>Road.") }],
  );

const realParent = Object.getOwnPropertyDescriptor(window, "parent");
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
  if (realParent) Object.defineProperty(window, "parent", realParent);
  document.body.replaceChildren();
});

/** The host, in a frame of the player's, with what it tells the player. */
async function hosted(workers: Partial<ServiceWorkerContainer> = {}) {
  const caches = memoryCaches();
  vi.stubGlobal("caches", caches);
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      register: async () => undefined,
      ready: Promise.resolve({ scope: SCOPE }),
      controller: null,
      ...workers,
    },
  });
  const told: [unknown, string][] = [];
  const parent = {
    postMessage: (m: unknown, to: string) => told.push([m, to]),
  } as unknown as Window;
  Object.defineProperty(window, "parent", { configurable: true, value: parent });
  await mountGameHost(document.body, { player: PLAYER });
  const say = (data: unknown, from: { origin?: string; source?: unknown } = {}) => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data,
        origin: from.origin ?? PLAYER,
        source: (from.source ?? parent) as Window,
      }),
    );
  };
  const kept = async () => (await caches.open(ARCHIVES_CACHE)).match(archiveKey(SCOPE, IFID));
  return { told, say, kept, caches };
}

describe("the game host page", () => {
  it("tells the player it's ready, and no one else", async () => {
    const { told } = await hosted();
    expect(told).toEqual([[{ type: "loominate-ready" }, PLAYER]]);
  });

  it("keeps itself and its script for offline, which loaded before its worker", async () => {
    const script = document.createElement("script");
    script.src = "/host.js";
    // In the body the host draws over, as `loominate play` has it.
    document.body.append(script);
    const elsewhere = document.createElement("script");
    elsewhere.src = "https://example.com/x.js";
    document.body.append(elsewhere);
    try {
      const { caches } = await hosted();
      const kept = await caches.open("loominate-player");
      await vi.waitFor(async () => {
        expect(await kept.match(`${SCOPE}host.js`)).toBeDefined();
      });
      expect(await kept.match(SCOPE)).toBeDefined();
      expect(await kept.match("https://example.com/x.js")).toBeUndefined();
    } finally {
      script.remove();
      elsewhere.remove();
    }
  });

  it("keeps the archive the player hands it", async () => {
    const { say, kept, told } = await hosted();
    say({ type: "loominate-open", archive: (await archive()).buffer });
    await vi.waitFor(async () => {
      expect(await kept()).toBeDefined();
    });
    expect(told).toHaveLength(1);
  });

  it("takes archives from the player alone", async () => {
    const { say, kept } = await hosted();
    const bytes = (await archive()).buffer;
    say({ type: "loominate-open", archive: bytes }, { origin: "https://example.com" });
    say({ type: "loominate-open", archive: bytes }, { source: window });
    await new Promise((r) => setTimeout(r, 50));
    expect(await kept()).toBeUndefined();
  });

  it("refuses an archive for another game's origin", async () => {
    const { say, kept, told } = await hosted();
    const other = "11111111-2222-3333-4444-555555555555";
    say({ type: "loominate-open", archive: (await archive(other)).buffer });
    // Hosts mounted by earlier tests share this window, so look for this one's answer.
    await vi.waitFor(() => {
      expect(told.length).toBeGreaterThan(1);
    });
    expect(told).toContainEqual([
      {
        type: "loominate-failed",
        problems: [`Its IFID is ${other.toUpperCase()}, and this game's origin is for ${IFID}.`],
      },
      PLAYER,
    ]);
    expect(await kept()).toBeUndefined();
  });

  it("says when there's no kept copy to play offline", async () => {
    const { say, told } = await hosted();
    say({ type: "loominate-resume" });
    await vi.waitFor(() => {
      expect(told).toContainEqual([
        {
          type: "loominate-failed",
          problems: ["The network can't be reached, and it hasn't been opened here before."],
        },
        PLAYER,
      ]);
    });
  });

  it("plays offline under the game's policy, which refuses to register its worker again", async () => {
    const refused = () => Promise.reject(new DOMException("worker-src 'none'", "SecurityError"));
    const { told } = await hosted({
      register: refused,
      controller: {} as ServiceWorker,
    });
    expect(told).toEqual([[{ type: "loominate-ready" }, PLAYER]]);
    // With no worker yet, that's a failure.
    await expect(hosted({ register: refused })).rejects.toThrow("worker-src 'none'");
  });

  it("only points to the player when it isn't in a frame", async () => {
    await mountGameHost(document.body, { player: PLAYER });
    expect(document.body.textContent).toBe("This page opens a game for the Loominate IF player.");
    expect(document.querySelector("a")?.getAttribute("href")).toBe(PLAYER);
  });
});
