import { describe, expect, it } from "vitest";
import { matchBrace, splitTopLevel } from "./code-scan.js";

const close = (source: string): string | undefined => {
  const at = matchBrace(source, 0, source.length);
  return at === undefined ? undefined : source.slice(0, at + 1);
};

describe("matchBrace", () => {
  it("finds the closing brace past nested braces", () => {
    expect(close("{a { b } c} tail}")).toBe("{a { b } c}");
  });

  it("skips braces in strings, templates, comments, and regexes", () => {
    expect(close("{\"}\" '}' x} y}")).toBe("{\"}\" '}' x}");
    expect(close("{`${ {a: 1}.a } }` x} y}")).toBe("{`${ {a: 1}.a } }` x}");
    expect(close("{a /* } */ b} c}")).toBe("{a /* } */ b}");
    expect(close("{a // }\n b} c}")).toBe("{a // }\n b}");
    expect(close("{f(/}/) } c}")).toBe("{f(/}/) }");
  });

  it("treats a slash after an operand as division", () => {
    expect(close("{a / b} / c}")).toBe("{a / b}");
    expect(close("{(a) / 2} }")).toBe("{(a) / 2}");
  });

  it("returns undefined when the brace isn't closed within the limit", () => {
    expect(matchBrace("{a", 0, 2)).toBeUndefined();
    expect(matchBrace("{a}", 0, 2)).toBeUndefined();
  });
});

describe("splitTopLevel", () => {
  const split = (source: string): string[] =>
    splitTopLevel(source, 0, source.length).map(([s, e]) => source.slice(s, e));

  it("splits only at commas outside brackets, strings, and templates", () => {
    expect(split('a, f(b, c), [d, e], {f, g}, "h, i", `j, ${k, l}`')).toEqual([
      "a",
      " f(b, c)",
      " [d, e]",
      " {f, g}",
      ' "h, i"',
      " `j, ${k, l}`",
    ]);
  });

  it("returns one part when there are no commas, and empty parts for doubled ones", () => {
    expect(split("x")).toEqual(["x"]);
    expect(split("a,,b")).toEqual(["a", "", "b"]);
  });
});
