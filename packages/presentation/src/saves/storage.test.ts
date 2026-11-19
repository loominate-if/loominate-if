// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { createSaves, createStore } from "@loominate-if/core";
import { describe, expect, it } from "vitest";
import { createBrowserStorage } from "./storage.js";

describe("browser save storage", () => {
  it("keeps slots between page loads", async () => {
    const indexedDB = new IDBFactory();
    const first = createBrowserStorage("lantern-road", { indexedDB });
    await first.set("bridge", "one");
    await first.set("autosave", "two");
    // A new page load opens the same database afresh.
    const again = createBrowserStorage("lantern-road", { indexedDB });
    expect(await again.get("bridge")).toBe("one");
    expect([...(await again.slots())].sort()).toEqual(["autosave", "bridge"]);
    await again.delete("bridge");
    expect(await again.get("bridge")).toBeUndefined();
    expect(await again.slots()).toEqual(["autosave"]);
  });

  it("keeps each game's saves apart", async () => {
    const indexedDB = new IDBFactory();
    await createBrowserStorage("lantern-road", { indexedDB }).set("bridge", "ours");
    await createBrowserStorage("lantern-roadside", { indexedDB }).set("inn", "theirs");
    expect(await createBrowserStorage("lantern-road", { indexedDB }).slots()).toEqual(["bridge"]);
    expect(await createBrowserStorage("other", { indexedDB }).get("bridge")).toBeUndefined();
  });

  it("works with core's saves, using the browser's IndexedDB by default", async () => {
    const saves = createSaves({
      storage: createBrowserStorage("lantern-road"),
      game: { id: "lantern-road", version: "1.0.0" },
    });
    const store = createStore();
    store.set("player", "fear", 2);
    await saves.save("bridge", store, { label: "Bridge" });
    const loaded = await saves.load("bridge");
    expect(loaded?.state).toEqual(store.snapshot());
    expect(loaded?.summary.label).toBe("Bridge");
  });

  it("explains a browser without IndexedDB", () => {
    const saved = globalThis.indexedDB;
    Reflect.deleteProperty(globalThis, "indexedDB");
    try {
      expect(() => createBrowserStorage("x")).toThrow(
        "This browser has no IndexedDB, so saves can't be kept between visits.",
      );
    } finally {
      globalThis.indexedDB = saved;
    }
  });
});
