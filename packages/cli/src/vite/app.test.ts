// @vitest-environment jsdom
/** The generated entry point's error handling (#274). */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedConfig } from "../config/config.js";
import { loominateApp, MAIN } from "./app.js";

/** The few browser globals the test uses: the CLI's types have no DOM. */
type El = {
  id: string;
  textContent: string | null;
  append(...nodes: unknown[]): void;
  querySelector(selector: string): El | null;
  getAttribute(name: string): string | null;
};
const dom = globalThis as unknown as {
  document: { body: El & { replaceChildren(): void }; createElement(tag: string): El };
  window: { dispatchEvent(event: unknown): boolean };
  ErrorEvent: new (type: string, init: { error: unknown }) => unknown;
};
const { document, window, ErrorEvent } = dom;

const root = mkdtempSync(path.join(tmpdir(), "loominate-app-"));
afterEach(() => {
  document.body.replaceChildren();
});
process.on("exit", () => {
  rmSync(root, { recursive: true, force: true });
});

const config = {
  root,
  start: "Start",
  game: { id: "test-game", version: "1.0.0" },
  loaded: [],
  inspectorModules: [],
} as unknown as ResolvedConfig;

/** A plugin hook's code, for a module ID. */
async function code(source: string): Promise<string> {
  const plugin = loominateApp(config);
  const resolveId = plugin.resolveId as (s: string, i?: string) => Promise<string | undefined>;
  const id = await resolveId.call({}, source);
  const load = plugin.load as (id: string) => string | undefined;
  return load.call({}, id ?? "") ?? "";
}

describe("the generated entry point", () => {
  it("loads the error handler before anything else, and reports the page's errors", async () => {
    const main = await code(MAIN);
    expect(main.split("\n")[0]).toBe('import { markStarted, report } from "/@loominate/errors";');
    expect(main).toContain("page: { onError: report }");
    expect(main.indexOf("markStarted();")).toBeGreaterThan(main.indexOf("await playGame"));
  });

  it("shows an error that stops the game, instead of a blank page, and tells the dev server", async () => {
    const errors = await code("/@loominate/errors");
    const hot = { send: vi.fn() };
    // The module's code, run as a script: its exports and import.meta stood in for.
    const run = new Function(
      "hot",
      `${errors.replace(/export function/g, "function").replace(/import\.meta\.hot/g, "hot")}\nreturn { markStarted, report };`,
    ) as (hot: unknown) => { markStarted: () => void; report: (e: unknown) => void };
    const exported = run(hot);
    const app = document.createElement("div");
    app.id = "app";
    document.body.append(app);

    window.dispatchEvent(new ErrorEvent("error", { error: new Error("story.ts: boom") }));
    const box = app.querySelector(".loominate-fatal");
    expect(box?.getAttribute("role")).toBe("alert");
    expect(box?.textContent).toContain("The game couldn't start.");
    expect(box?.textContent).toContain("story.ts: boom");
    // The dev server prints uncaught errors itself.
    expect(hot.send).not.toHaveBeenCalled();

    // An error the page caught during play goes to the terminal through report.
    exported.report(new Error("caught in play"));
    expect(hot.send).toHaveBeenCalledWith(
      "loominate:error",
      expect.objectContaining({ message: "caught in play" }),
    );

    exported.markStarted();
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("later") }));
    expect(app.querySelector(".loominate-fatal")?.textContent).toContain("Something went wrong.");
  });
});
