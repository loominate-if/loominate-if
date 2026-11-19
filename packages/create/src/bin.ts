#!/usr/bin/env node
/** `npm create @loominate-if [folder]`: scaffolds a new game. */
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { scaffold } from "./scaffold.js";

async function folder(): Promise<string | undefined> {
  const given = process.argv[2];
  if (given !== undefined) return given;
  if (!process.stdin.isTTY) return undefined;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question("Folder for the new game (my-game): ")).trim();
    return answer === "" ? "my-game" : answer;
  } finally {
    rl.close();
  }
}

try {
  const dir = await folder();
  if (dir === undefined) {
    throw new Error("Name a folder for the game: `npm create @loominate-if my-game`.");
  }
  const files = scaffold(dir);
  const shown = path.relative(process.cwd(), path.resolve(dir)) || ".";
  console.log(`Created a game in ${shown}: ${files.join(", ")}.

Next:
  cd ${shown}
  npm install
  npm run dev`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
