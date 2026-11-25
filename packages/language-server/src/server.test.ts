/** The language server (#148), headless: a client talking to it in this process. */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProtocolConnection, type ProtocolConnection } from "vscode-languageserver/node.js";
import { startLanguageServer } from "./server.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const packages = path.resolve(here, "../..");
const temp = mkdtempSync(path.join(packages, "language-server/__run-"));
const root = path.join(temp, "game");

const STORY = `import { object } from "@loominate-if/core";
/** The hall's lamp. */
export const lamp = object("lamp", { lit: false, oil: 3 });
`;
const HALL = `:: Hall
The lamp is {lamp.lit ? "lit" : "dark"}.
It has {lamp.oil} measures of oil, and {lamp.wick}.
[[Upstairs -> Landing]]
`;

let client: ProtocolConnection;
const logged: string[] = [];
const uri = pathToFileURL(path.join(root, "hall.weft")).href;

beforeAll(async () => {
  const files: Record<string, string> = {
    "package.json": '{"type":"module"}',
    "loominate.config.ts": `import { defineConfig } from "@loominate-if/cli";
export default defineConfig({ game: { id: "ls-game", version: "0.1.0" }, start: "Hall" });
`,
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "ES2023",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        customConditions: ["source"],
      },
      include: ["*.ts", "*.weft"],
    }),
    "story.ts": STORY,
    "hall.weft": HALL,
  };
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(root, name), text);
  mkdirSync(path.join(root, "node_modules/@loominate-if"), { recursive: true });
  for (const pkg of ["core", "presentation", "cli"]) {
    symlinkSync(
      path.join(packages, pkg),
      path.join(root, `node_modules/@loominate-if/${pkg}`),
      "dir",
    );
  }
  const toServer = new PassThrough();
  const toClient = new PassThrough();
  startLanguageServer({ conditions: ["source"], streams: { input: toServer, output: toClient } });
  client = createProtocolConnection(toClient, toServer);
  // What the server logs, as a failure to load the game, to show if a test fails.
  client.onNotification("window/logMessage", (m: { message: string }) => {
    logged.push(m.message);
  });
  client.listen();
  await client.sendRequest("initialize", {
    processId: null,
    rootUri: pathToFileURL(root).href,
    workspaceFolders: [{ uri: pathToFileURL(root).href, name: "game" }],
    capabilities: {},
  });
  await client.sendNotification("initialized", {});
  await client.sendNotification("textDocument/didOpen", {
    textDocument: { uri, languageId: "weft", version: 1, text: HALL },
  });
}, 60_000);

afterAll(() => {
  client.dispose();
  rmSync(temp, { recursive: true, force: true });
});
mkdirSync(root, { recursive: true });

/** The position of the first `needle` in the hall's text, plus `offset` characters. */
const at = (needle: string, offset = 0) => {
  const i = HALL.indexOf(needle) + offset;
  const before = HALL.slice(0, i).split("\n");
  return { line: before.length - 1, character: (before.at(-1) ?? "").length };
};

describe("the language server (#148)", () => {
  it("reports the compiler's diagnostics for a passage file, at the author's line", async () => {
    const report = (await client.sendRequest("textDocument/diagnostic", {
      textDocument: { uri },
    })) as { items: { message: string; range: { start: { line: number } } }[] };
    const messages = report.items.map((d) => [d.range.start.line, d.message]);
    // What the server logged, as a game it couldn't load, says why if this fails.
    expect(logged.filter((m) => m.includes("couldn't load"))).toEqual([]);
    expect(messages).toEqual(
      expect.arrayContaining([
        [2, expect.stringContaining("wick")],
        [3, expect.stringContaining("There's no passage named `Landing`")],
      ]),
    );
  }, 60_000);

  it("completes inside inline code, from the game's TypeScript", async () => {
    const list = (await client.sendRequest("textDocument/completion", {
      textDocument: { uri },
      position: at("lamp.oil", "lamp.".length),
    })) as { items: { label: string }[] } | { label: string }[] | null;
    const items = Array.isArray(list) ? list : (list?.items ?? []);
    expect(items.map((i) => i.label)).toEqual(expect.arrayContaining(["lit", "oil"]));
  }, 60_000);

  it("hovers with TypeScript's types and docs", async () => {
    const hover = (await client.sendRequest("textDocument/hover", {
      textDocument: { uri },
      position: at("lamp.lit", 1),
    })) as { contents: unknown } | null;
    expect(JSON.stringify(hover?.contents)).toContain("lamp");
    expect(JSON.stringify(hover?.contents)).toContain("The hall's lamp.");
  }, 60_000);

  it("goes to the definition in story.ts", async () => {
    const found = (await client.sendRequest("textDocument/definition", {
      textDocument: { uri },
      position: at("lamp.lit", 1),
    })) as ({ uri?: string; targetUri?: string } | undefined)[] | null;
    const targets = (found ?? []).map((l) => l?.targetUri ?? l?.uri);
    expect(targets).toEqual(
      expect.arrayContaining([pathToFileURL(path.join(root, "story.ts")).href]),
    );
  }, 60_000);
});
