/** The story map's Passages view (#149). */
import { describe, expect, it } from "vitest";
import { parsePassageFile } from "../passages/parse.js";
import { passageView } from "./story-map.js";

const DIRECTIVES = [
  { name: "when", guard: true },
  { name: "act", guard: true },
  { name: "continue" },
];

/** The view of passage files given by name and text. */
const view = (files: Record<string, string>, options: Parameters<typeof passageView>[1] = {}) =>
  passageView(
    Object.entries(files).map(([file, text]) => ({
      parsed: parsePassageFile(text, { file, directives: DIRECTIVES }),
      text,
    })),
    options,
  );

describe("the Passages view", () => {
  it("has a node for each passage, with where it is and its tags", () => {
    const v = view(
      { "a.weft": ":: Start [scene]\nHi.\n\n:: Hall [room: hall]\nHere.\n" },
      { start: "Start", unreachable: new Set(["Hall"]) },
    );
    expect(v.nodes).toEqual([
      {
        id: "Start",
        label: "Start",
        source: { file: "a.weft", line: 1, column: 4 },
        tags: ["scene"],
        start: true,
      },
      {
        id: "Hall",
        label: "Hall",
        source: { file: "a.weft", line: 4, column: 4 },
        tags: ["room: hall"],
        unreachable: true,
      },
    ]);
  });

  it("has an edge for each link and passage target, marking guards and conditions", () => {
    const v = view(
      {
        "a.weft": [
          ":: Start",
          "Go [[down the stairs -> Cellar]] or [[Hall]].",
          "[[Climb -> Tower]]{when lit}",
          "{if dark}[[Hide -> Cellar]]{/if}",
          "{continue -> Hall}",
          "[[Pull the lever -> Start]]{act pull}",
          "",
          ":: Cellar",
          "",
          ":: Hall",
          "",
        ].join("\n"),
      },
      { stays: new Set(["act"]) },
    );
    expect(v.edges.map(({ source, ...e }) => ({ ...e, line: source.line }))).toEqual([
      { from: "Start", to: "Cellar", kind: "link", label: "down the stairs", line: 2 },
      { from: "Start", to: "Hall", kind: "link", line: 2 },
      { from: "Start", to: "Tower", kind: "link", label: "Climb", guarded: true, line: 3 },
      { from: "Start", to: "Cellar", kind: "link", label: "Hide", conditional: true, line: 4 },
      { from: "Start", to: "Hall", kind: "continue", line: 5 },
    ]);
  });

  it("shows a link to a passage that doesn't exist, to a missing node", () => {
    const v = view({ "a.weft": ":: Start\n[[Up -> Attic]]\n" });
    expect(v.nodes.at(-1)).toEqual({ id: "Attic", label: "Attic", tags: [], missing: true });
  });

  it("orders places as a reader meets them: the start, then along its ways, then the rest", () => {
    const v = view(
      {
        "a.weft": ":: Ending\nDone.\n\n:: Lost\nNowhere.\n",
        "b.weft": ":: Start\n[[On -> Middle]]\n\n:: Middle\n[[End -> Ending]]\n",
      },
      { start: "Start" },
    );
    expect(v.nodes.map((n) => n.id)).toEqual(["Start", "Middle", "Ending", "Lost"]);
  });

  it("gives printed values in labels as …, and joins passages across files", () => {
    const v = view({
      "a.weft": ":: Start\n[[Ask about {topic.name} -> Hall]]\n",
      "b.weft": ":: Hall\n[[Back -> Start]]\n",
    });
    expect(v.nodes.map((n) => [n.id, n.source?.file])).toEqual([
      ["Start", "a.weft"],
      ["Hall", "b.weft"],
    ]);
    expect(v.edges.map((e) => e.label)).toEqual(["Ask about …", "Back"]);
  });
});
