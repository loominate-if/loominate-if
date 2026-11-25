/** Paths as the language server keys games and files by (#413). */
import { describe, expect, it } from "vitest";
import { canonicalPath } from "./game.js";

describe("canonicalPath", () => {
  it("gives Windows paths as Node writes them, whatever the editor sent", () => {
    expect(canonicalPath("c:/Users/me/game/hall.weft", "win32")).toBe(
      "C:\\Users\\me\\game\\hall.weft",
    );
    expect(canonicalPath("C:\\Users\\me\\game\\", "win32")).toBe("C:\\Users\\me\\game");
  });

  it("resolves other paths and leaves their case alone", () => {
    expect(canonicalPath("/Users/Me/game/./hall.weft", "darwin")).toBe("/Users/Me/game/hall.weft");
  });
});
