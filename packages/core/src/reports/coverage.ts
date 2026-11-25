/**
 * Coverage reports (#133, ADR 0109): what a game's structure rules out, and
 * what its walkthroughs never reach. `loominate coverage` loads the game,
 * begins it, and runs every check in {@link coverageChecks}; core checks
 * passages and actions, and the world model and kits add their own.
 */
import { _actionsOnThings } from "../actions/actions.js";
import type { Passage, Story } from "../passages/story.js";
import { registry, type Registry } from "../rules/registry.js";

/** The game a coverage check looks at: begun, or played through by a walkthrough. */
export type CoverageGame = {
  /** The story. */
  readonly story: Story;
  /** The passages a player can visit: every passage but those a package reads sections from, as an actor's topics. */
  readonly passages: readonly Passage[];
};

/** Something a walkthrough should reach: a passage, a topic, a fact. */
export type CoverageItem = {
  /** Its key, the same in every run, such as `passage:Cellar`. */
  readonly key: string;
  /** How the report names it: `Cellar`, `Ask the maid about the weather`. */
  readonly label: string;
};

/** Something that can't be reached, and why. */
export type CoverageFinding = {
  /**
   * Its item's key, if it has one: a walkthrough that reaches it shows that
   * code does what the structure couldn't, and the finding is dropped.
   */
  readonly key?: string;
  /** How the report names it. */
  readonly label: string;
  /** Why it can't be reached, and how to fix it. */
  readonly why: string;
};

/** A coverage check: what can't be reached, and what walkthroughs should reach. */
export type CoverageCheck = {
  /** Its heading in the report: "Passages", "Facts". */
  readonly title: string;
  /** What the game's structure rules out, read from the begun game. */
  readonly unreachable?: (game: CoverageGame) => readonly CoverageFinding[];
  /** Everything a walkthrough should reach. */
  readonly items?: (game: CoverageGame) => readonly CoverageItem[];
  /** The keys of the items a walkthrough reached, read from its game at the end. */
  readonly reached?: (game: CoverageGame) => Iterable<string>;
};

/**
 * The checks a coverage report runs, by name. Core's are `passages` and
 * `actions`; packages add theirs as they load.
 *
 * @example
 * ```ts
 * coverageChecks.register("spells", {
 *   title: "Spells",
 *   items: () => spells.map((s) => ({ key: `spell:${s.id}`, label: s.name })),
 *   reached: () => spells.filter((s) => s.cast).map((s) => `spell:${s.id}`),
 * });
 * ```
 */
export const coverageChecks: Registry<CoverageCheck> = registry<CoverageCheck>("coverageChecks");

const SOURCE = "@loominate-if/core";

coverageChecks.register(
  "passages",
  {
    title: "Passages",
    items: ({ passages }) => passages.map((p) => ({ key: `passage:${p.id}`, label: p.id })),
    reached: ({ story, passages }) =>
      passages.filter((p) => story.totalVisits(p.id) > 0).map((p) => `passage:${p.id}`),
  },
  { source: SOURCE },
);

coverageChecks.register(
  "actions",
  {
    title: "Actions",
    items: () => _actionsOnThings().map((a) => ({ key: `action:${a.name}`, label: a.label })),
    reached: ({ story }) =>
      story.actions.flatMap((a) => (a.type === "act" ? [`action:${a.action}`] : [])),
  },
  { source: SOURCE },
);
