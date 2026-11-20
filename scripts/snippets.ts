// Code in the author guides that's taken from tested files. A fenced block
// right after a marker comment must match its source:
//
//   <!-- example: examples/branching-story/intro.weft#Cottage -->   a passage
//   <!-- example: examples/branching-story/story.ts#objects -->      a `// #region objects`
//   <!-- example: examples/branching-story/story.ts -->              a whole file
//
// `node scripts/snippets.ts --update` copies the sources into the guides,
// after an example changes.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** A marked code block in a guide. */
export type Snippet = {
  /** The source, as written in the marker: a file, with `#passage` or `#region` if given. */
  readonly source: string;
  /** The block's code, as the guide has it. */
  readonly code: string;
  /** Where the block's lines start and end in the guide's text, with the last newline. */
  readonly start: number;
  readonly end: number;
};

const MARKER = /<!-- example: (.+?) -->\n```[\w-]*\n([\s\S]*?)^```/gm;

/** The marked code blocks in a guide. */
export function snippets(markdown: string): Snippet[] {
  return [...markdown.matchAll(MARKER)].map((m) => {
    const body = m[2] ?? "";
    const start = (m.index ?? 0) + m[0].length - 3 - body.length;
    return { source: m[1] ?? "", code: body.replace(/\n$/, ""), start, end: start + body.length };
  });
}

/**
 * The code a marker names, read from the repository.
 * @throws Error if the file, passage, or region isn't there.
 */
export function extract(repo: string, source: string): string {
  const [file = "", part] = source.split("#");
  const text = readFileSync(join(repo, file), "utf8");
  if (part === undefined) return text.trimEnd();
  if (file.endsWith(".weft")) {
    const lines = text.split("\n");
    const header = (line: string) => /^::\s*(.+?)\s*(\[.*\])?\s*$/.exec(line)?.[1];
    const first = lines.findIndex((line) => header(line) === part);
    if (first === -1) throw new Error(`${file} has no passage named ${part}.`);
    const next = lines.findIndex((line, i) => i > first && line.startsWith("::"));
    return lines
      .slice(first, next === -1 ? undefined : next)
      .join("\n")
      .trimEnd();
  }
  const found = new RegExp(`// #region ${part}\\b.*\\n([\\s\\S]*?)\\n\\s*// #endregion`).exec(
    text,
  )?.[1];
  if (found === undefined) throw new Error(`${file} has no region named ${part}.`);
  const indent = /^ */.exec(found)?.[0].length ?? 0;
  return found.replace(new RegExp(`^ {${String(indent)}}`, "gm"), "");
}

/** The guides that hold snippets. */
export function guides(repo: string): string[] {
  return readdirSync(join(repo, "docs/guide"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => `docs/guide/${f}`);
}

/** A guide's text with every snippet copied from its source. */
export function updated(repo: string, markdown: string): string {
  let text = markdown;
  // Last first, so earlier positions stay put.
  for (const s of snippets(markdown).reverse()) {
    text = `${text.slice(0, s.start)}${extract(repo, s.source)}\n${text.slice(s.end)}`;
  }
  return text;
}

if (process.argv[1] === import.meta.filename && process.argv.includes("--update")) {
  const repo = join(import.meta.dirname, "..");
  for (const guide of guides(repo)) {
    const before = readFileSync(join(repo, guide), "utf8");
    const after = updated(repo, before);
    if (after !== before) {
      writeFileSync(join(repo, guide), after);
      console.log(`Updated ${guide}.`);
    }
  }
}
