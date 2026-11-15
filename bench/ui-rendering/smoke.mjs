import { JSDOM } from "jsdom";
import { readFile } from "node:fs/promises";

// Plays one script through every variant; they must behave identically for the sizes to be comparable.
const tick = () => new Promise((r) => setTimeout(r, 20));
const results = new Map();
for (const name of ["vanilla", "preact", "solid"]) {
  const code = await readFile(`dist/${name}.js`, "utf8");
  const dom = new JSDOM(`<!doctype html><div id="app"></div>`, { runScripts: "outside-only" });
  dom.window.eval(code);
  const doc = dom.window.document;
  const text = () => [...doc.querySelectorAll("main p")].map((p) => p.textContent).join(" | ");
  const click = async (label) => {
    const b = [...doc.querySelectorAll("button")].find((x) => x.textContent === label);
    if (!b) throw new Error(`${name}: no button ${label}; page: ${text()}`);
    if (b.disabled) throw new Error(`${name}: ${label} is disabled`);
    b.click();
    await tick();
  };
  const log = [];
  await tick();
  log.push(text());
  await click("Go to the cellar stairs");
  const down = [...doc.querySelectorAll("button")].find((x) => x.textContent === "Go down");
  log.push(
    `down disabled=${down?.disabled} reason=${doc.querySelector("main small")?.textContent}`,
  );
  await click("Back up");
  log.push(text());
  await click("Take the lantern");
  await click("Continue");
  await click("Go to the cellar stairs");
  await click("Go down");
  log.push(text());
  await click("Undo");
  log.push(text());
  log.push(
    `focus=${doc.activeElement?.tagName} drawer=${doc.querySelectorAll("details p").length}`,
  );
  console.log(name.padEnd(8), JSON.stringify(log));
  results.set(name, JSON.stringify(log));
}
if (new Set(results.values()).size !== 1) {
  console.error("smoke: the variants behaved differently, so their sizes aren't comparable.");
  process.exitCode = 1;
}
